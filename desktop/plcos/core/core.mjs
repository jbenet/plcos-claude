#!/usr/bin/env node
// PLC OS desktop core (docs/31-desktop-app.md).
//
// The app's window loads http://127.0.0.1:<port>/ and every request comes here. This program:
//   - holds the person's session (from pairing, docs/31 §2) and their other cookies, so the window holds none;
//   - forwards every write to the live server, as them;
//   - answers reads from the local copy (docs/31 §3) when it runs the server's own build and has caught up,
//     and from the server otherwise;
//   - keeps the build's static files on disk, so a window opens without the network.
//
// No dependencies beyond Node (20 or later). The Tauri shell starts it with PLCOS_DESKTOP_KEY, a secret for this
// launch: only a request carrying that key's cookie is served, so another site in another browser cannot reach the
// person's session through this port. It exits when its stdin closes (the shell quit).
import { spawn, execFile } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync, chmodSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

// ---- configuration ------------------------------------------------------------------------------------------------

const DEFAULT_SERVER = 'https://plcos-production.up.railway.app';
const DATA_DIR = env.PLCOS_DESKTOP_DIR
  || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/PLC OS') : path.join(os.homedir(), '.local/share/plcos-desktop'));
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
// Spotlight would index the copy's build, dependencies and database files (hundreds of MB) and slow the Mac while
// it does: these markers ask it not to.
for (const sub of ['', 'builds', 'deps', 'cache']) { // pg/ is marked after initdb, which wants an empty folder
  try { mkdirSync(path.join(DATA_DIR, sub), { recursive: true, mode: 0o700 }); writeFileSync(path.join(DATA_DIR, sub, '.metadata_never_index'), ''); } catch { /* best effort */ }
}
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } };
const settings = readJson(SETTINGS_FILE, {});
const SERVER = new URL((env.PLCOS_SERVER || settings.server || DEFAULT_SERVER).replace(/\/+$/, ''));
if (!(SERVER.protocol === 'https:' || (SERVER.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(SERVER.hostname)))) {
  throw new Error(`PLCOS_SERVER must be https:// (http only on this machine): ${SERVER.href}`);
}
const PORT = Number(env.PLCOS_DESKTOP_PORT || settings.port || 47100);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const KEY = env.PLCOS_DESKTOP_KEY || '';
const KEY_COOKIE = 'plcos_desktop';
const LOG_FILE = env.PLCOS_DESKTOP_LOG || path.join(DATA_DIR, 'core.log');
const VERSION = '0.1.0';

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  try { appendFileSync(LOG_FILE, line); } catch { /* the log is best effort */ }
  if (env.PLCOS_DESKTOP_VERBOSE) process.stderr.write(line);
}

// ---- secrets: the session, in the macOS Keychain (a 0600 file elsewhere, for tests) -------------------------------

const KEYCHAIN_SERVICE = 'PLC OS desktop';
const account = () => SERVER.host;
const useKeychain = process.platform === 'darwin' && !env.PLCOS_DESKTOP_SECRET_FILE;
const secretFile = env.PLCOS_DESKTOP_SECRET_FILE || path.join(DATA_DIR, 'session.secret');

function run(cmd, args, input) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: 15_000 }, (err, stdout) => resolve(err ? null : String(stdout)));
    if (input !== undefined) { child.stdin.end(input); }
  });
}

const secrets = {
  async get() {
    if (!useKeychain) { try { return readFileSync(secretFile, 'utf8').trim() || null; } catch { return null; } }
    const out = await run('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account(), '-w']);
    return out ? out.trim() || null : null;
  },
  async set(value) {
    if (!/^[\x21-\x7e]+$/.test(value) || value.includes('"')) throw new Error('refusing to store an unexpected secret');
    if (!useKeychain) { writeFileSync(secretFile, value, { mode: 0o600 }); chmodSync(secretFile, 0o600); return; }
    // Through security's own prompt on stdin, so the value is never on a command line.
    await run('/usr/bin/security', ['-i'], `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${account()}" -w "${value}"\n`);
  },
  async clear() {
    if (!useKeychain) { rmSync(secretFile, { force: true }); return; }
    await run('/usr/bin/security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account()]);
  },
};

// ---- the cookie jar -----------------------------------------------------------------------------------------------
// Cookies are kept by their logical name (the server's prefix and __Host- taken off), so the live server and the
// local copy, which name cookies differently, share one vehicle choice. The session goes only to the live server;
// the local copy is told who you are by its own user cookie.

const JAR_FILE = path.join(DATA_DIR, 'cookies.json');
const state = {
  session: null,            // { name, value } — the live server's session cookie, raw name
  user: null,               // { id, handle, name, access }
  remote: null,             // /api/desktop/info of the live server
  jar: readJson(JAR_FILE, {}), // logical name → value (never the session)
  pairing: null,            // { verifier, userCode, url, started, expires, state }
  lastWriteAt: 0,
  local: null,              // set by the local copy manager (docs/31 §3)
  stats: { remote: 0, local: 0, static: 0, fallback: 0, writes: 0 },
};
const saveJar = () => { try { writeFileSync(JAR_FILE, JSON.stringify(state.jar), { mode: 0o600 }); } catch { /* best effort */ } };

function logicalName(raw, prefix) {
  let n = raw.startsWith('__Host-') ? raw.slice(7) : raw.startsWith('__Secure-') ? raw.slice(9) : raw;
  if (prefix && n.startsWith(prefix)) n = n.slice(prefix.length);
  return n;
}

function parseSetCookie(line) {
  const [pair, ...attrs] = line.split(';');
  const eq = pair.indexOf('=');
  if (eq < 1) return null;
  const name = pair.slice(0, eq).trim();
  let value = pair.slice(eq + 1).trim();
  try { value = decodeURIComponent(value); } catch { /* keep as is */ }
  let gone = false;
  for (const a of attrs) {
    const [k, v = ''] = a.trim().split('=');
    if (/^max-age$/i.test(k) && Number(v) <= 0) gone = true;
    if (/^expires$/i.test(k) && Date.parse(v) < Date.now()) gone = true;
  }
  return { name, value, gone: gone || value === '' };
}

/** Take a response's Set-Cookie lines into the jar. `upstream` names whose prefix applies. */
function absorbCookies(setCookies, upstream) {
  if (!setCookies) return;
  const prefix = upstream === 'remote' ? state.remote?.cookiePrefix : state.local?.cookiePrefix;
  let changed = false;
  for (const line of [].concat(setCookies)) {
    const c = parseSetCookie(line);
    if (!c) continue;
    const logical = logicalName(c.name, prefix);
    if (upstream === 'remote' && state.session && c.name === state.session.name) {
      // The live server refreshed or cleared the session.
      if (c.gone) { void signOutLocally('the server cleared the session'); } else { state.session.value = c.value; void secrets.set(`${c.name}=${c.value}`); }
      continue;
    }
    if (logical === 'session' || logical === 'oauth' || logical === 'user') continue; // never shared across upstreams
    if (c.gone) { if (logical in state.jar) { delete state.jar[logical]; changed = true; } }
    else if (state.jar[logical] !== c.value) { state.jar[logical] = c.value; changed = true; }
  }
  if (changed) saveJar();
}

function cookieHeader(upstream) {
  const parts = [];
  if (upstream === 'remote') {
    const prefix = state.remote?.cookiePrefix ?? '';
    if (state.session) parts.push(`${state.session.name}=${encodeURIComponent(state.session.value)}`);
    for (const [k, v] of Object.entries(state.jar)) parts.push(`${prefix}${k}=${encodeURIComponent(v)}`);
  } else {
    const prefix = state.local?.cookiePrefix ?? '';
    if (state.user) parts.push(`${prefix}user=${encodeURIComponent(state.user.handle)}`);
    for (const [k, v] of Object.entries(state.jar)) parts.push(`${prefix}${k}=${encodeURIComponent(v)}`);
  }
  return parts.join('; ');
}

// ---- talking to the live server directly (pairing, info) -----------------------------------------------------------

const agents = {
  'https:': new https.Agent({ keepAlive: true, maxSockets: 16, keepAliveMsecs: 30_000 }),
  'http:': new http.Agent({ keepAlive: true, maxSockets: 16, keepAliveMsecs: 30_000 }),
};

async function serverJson(pathname, { method = 'GET', body } = {}) {
  const headers = { accept: 'application/json', origin: SERVER.origin, 'user-agent': `PLC-OS-desktop/${VERSION}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const cookie = cookieHeader('remote');
  if (cookie) headers.cookie = cookie;
  const res = await fetch(new URL(pathname, SERVER), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, location: res.headers.get('location') };
}

/** A GET to the live server as the person, for the local copy (its build and its rows). */
function remoteFetch(pathname) {
  const headers = { origin: SERVER.origin, 'user-agent': `PLC-OS-desktop/${VERSION}` };
  const cookie = cookieHeader('remote');
  if (cookie) headers.cookie = cookie;
  return fetch(new URL(pathname, SERVER), { headers, redirect: 'manual', signal: AbortSignal.timeout(30 * 60_000) });
}

async function refreshInfo() {
  if (!state.session) return null;
  const r = await serverJson('/api/desktop/info');
  if (r.status === 200 && r.json?.ok) {
    state.remote = r.json;
    state.user = r.json.user;
    return r.json;
  }
  if (r.status === 307 || r.status === 303 || r.status === 401 || r.status === 403) {
    // Signed out on the server (expired, or "sign out everywhere"): pair again.
    if (r.status !== 403 || !r.json) await signOutLocally(`info answered ${r.status}`);
  }
  return null;
}

async function signOutLocally(why) {
  log('signed out:', why);
  state.session = null; state.user = null;
  await secrets.clear();
  state.local?.onSignedOut?.();
}

async function startPairing() {
  // PKCE: only this process holds the verifier, so a grant carried to any other app is useless (docs/31 §2).
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const r = await serverJson('/api/desktop/pair', { method: 'POST', body: { op: 'start', device: os.hostname().replace(/\.local$/, ''), challenge, port: PORT } });
  if (!r.json?.ok) throw new Error(r.json?.error || `the server answered ${r.status}`);
  state.pairing = { verifier, userCode: r.json.userCode, url: r.json.url, started: Date.now(), expires: Date.now() + r.json.expiresIn * 1000, state: 'pending' };
  openInBrowser(r.json.url);
  return state.pairing;
}

/** The browser arrives at /__desktop/callback with the grant once the person pressed Allow. */
async function finishPairing(grant, code) {
  const p = state.pairing;
  if (!p || p.state !== 'pending' || code !== p.userCode || Date.now() > p.expires) return 'This sign-in was not started by this app, or it expired. Start again from the app.';
  const r = await serverJson('/api/desktop/pair', { method: 'POST', body: { op: 'claim', grant, verifier: p.verifier } });
  if (!r.json?.ok) { p.state = 'failed'; p.error = r.json?.error || `the server answered ${r.status}`; return p.error; }
  state.session = { name: r.json.cookie.name, value: r.json.cookie.value };
  await secrets.set(`${r.json.cookie.name}=${r.json.cookie.value}`);
  p.state = 'approved';
  delete p.verifier;
  await refreshInfo();
  log('paired as', state.user?.handle);
  state.local?.onSignedIn?.();
  return null;
}

function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  if (env.PLCOS_DESKTOP_NO_BROWSER) { log('would open', url); return; }
  try { spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref(); } catch (e) { log('could not open the browser', String(e)); }
}

// ---- the static cache ---------------------------------------------------------------------------------------------
// /_next/static/* is content-hashed and immutable: kept on disk, it never needs the network again.

const STATIC_DIR = path.join(DATA_DIR, 'cache/static');
const TYPES = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.map': 'application/json', '.txt': 'text/plain' };
function staticFile(pathname) {
  if (!pathname.startsWith('/_next/static/') || pathname.includes('..') || pathname.length > 300) return null;
  return path.join(STATIC_DIR, pathname.slice('/_next/static/'.length));
}
function serveStatic(file, res) {
  const st = statSync(file);
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'content-length': st.size, 'cache-control': 'public, max-age=31536000, immutable' });
  createReadStream(file).pipe(res);
  state.stats.static++;
}

// ---- the proxy ----------------------------------------------------------------------------------------------------

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'cookie']);
const DROP_RES = new Set(['set-cookie', 'strict-transport-security', 'alt-svc', 'connection', 'keep-alive', 'transfer-encoding']);

/** Where a request goes: the local copy when it can answer, else the live server. */
function chooseUpstream(req, url) {
  const write = !(req.method === 'GET' || req.method === 'HEAD');
  if (write) return 'remote';
  const local = state.local;
  if (!local?.ready?.()) return 'remote';
  if (!local.canServe(url, req)) return 'remote';
  return 'local';
}

function upstreamBase(which) { return which === 'remote' ? SERVER : new URL(state.local.origin); }

function forward(req, res, url, which, body, { retryRemoteOnError = false } = {}) {
  const base = upstreamBase(which);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && k !== KEY_COOKIE) headers[k] = v;
  headers.host = base.host;
  if (headers.origin) headers.origin = base.origin;
  if (headers.referer) { try { const r = new URL(headers.referer); headers.referer = new URL(r.pathname + r.search, base).href; } catch { delete headers.referer; } }
  const cookie = cookieHeader(which);
  if (cookie) headers.cookie = cookie;
  if (which === 'local') headers['x-plcos-desktop'] = state.local.secret;
  const isStatic = req.method === 'GET' && staticFile(url.pathname);
  if (isStatic) headers['accept-encoding'] = 'identity';
  const mod = base.protocol === 'https:' ? https : http;
  const started = Date.now();
  const up = mod.request({ protocol: base.protocol, hostname: base.hostname, port: base.port || undefined, method: req.method, path: url.pathname + url.search, headers, agent: agents[base.protocol] }, (upRes) => {
    // A local copy that fails on a read hands the read to the live server instead (docs/31 §1).
    if (which === 'local' && upRes.statusCode >= 500 && retryRemoteOnError) {
      upRes.resume();
      state.stats.fallback++;
      log('local answered', upRes.statusCode, 'for', url.pathname, '→ live server');
      return forward(req, res, url, 'remote', body);
    }
    absorbCookies(upRes.headers['set-cookie'], which);
    const out = {};
    for (const [k, v] of Object.entries(upRes.headers)) if (!DROP_RES.has(k)) out[k] = v;
    if (out.location) {
      try {
        const loc = new URL(out.location, base);
        if (loc.origin === base.origin || loc.origin === SERVER.origin) out.location = `${ORIGIN}${loc.pathname}${loc.search}${loc.hash}`;
      } catch { /* leave it */ }
    }
    // The live server sends a person without a valid session to /signin: the pairing has lapsed.
    if (which === 'remote' && state.session && upRes.statusCode >= 300 && upRes.statusCode < 400 && /^\/signin(\?|$)/.test(new URL(out.location ?? '/', ORIGIN).pathname)) {
      void refreshInfo();
    }
    out['x-plcos-upstream'] = which;
    if (which === 'remote' && !(req.method === 'GET' || req.method === 'HEAD') && upRes.statusCode < 400) {
      state.lastWriteAt = Date.now();
      state.stats.writes++;
      state.local?.onWrite?.(url);
    }
    state.stats[which]++;
    res.writeHead(upRes.statusCode, upRes.statusMessage, out);
    if (isStatic && upRes.statusCode === 200 && !upRes.headers['content-encoding']) {
      const file = staticFile(url.pathname);
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      const w = createWriteStream(tmp);
      upRes.on('data', (d) => w.write(d));
      upRes.on('end', () => w.end(() => { try { renameSync(tmp, file); } catch { /* another wrote it */ } }));
      upRes.on('error', () => { w.destroy(); rmSync(tmp, { force: true }); });
    }
    upRes.pipe(res);
    if (env.PLCOS_DESKTOP_VERBOSE) upRes.on('end', () => log(which, req.method, url.pathname, upRes.statusCode, `${Date.now() - started}ms`));
  });
  up.on('error', (e) => {
    if (which === 'local' && retryRemoteOnError && !res.headersSent) {
      state.stats.fallback++;
      log('local failed for', url.pathname, String(e.message), '→ live server');
      return forward(req, res, url, 'remote', body);
    }
    log(which, 'error', req.method, url.pathname, String(e.message));
    if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' }); res.end(offlinePage(e.message)); }
    else res.destroy();
  });
  if (body) up.end(body); else up.end();
}

/** A write's body is read whole first, so a failed local attempt can never have consumed it (writes go remote anyway). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > 200 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---- pages the core serves itself ---------------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#f6f5f1;--card:#fff;--ink:#1d1d1b;--mute:#6b6a64;--line:#e4e2da;--accent:#1f4f8a}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--card:#1f1f1c;--ink:#ecebe6;--mute:#9b9a93;--line:#33322e;--accent:#8db7f0}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"IBM Plex Sans",system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px 32px;max-width:560px;width:calc(100% - 32px);box-sizing:border-box}
h1{font-size:20px;margin:0 0 8px}p{margin:8px 0;color:var(--mute)}b{color:var(--ink)}
.code{font:600 30px/1.2 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:4px;color:var(--ink);margin:16px 0}
a.btn,button{display:inline-block;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:9px 16px;font:inherit;text-decoration:none;cursor:pointer}
a.link{color:var(--accent)}
</style></head><body><div class="card">${body}</div></body></html>`;

function pairPage() {
  const p = state.pairing;
  const waiting = p && p.state === 'pending';
  const body = waiting
    ? `<h1>Allow this Mac in your browser</h1>
       <p>Your browser opened PLC OS. Check it shows this code, then press <b>Allow</b>. The browser comes back to this Mac to finish.</p>
       <div class="code">${esc(p.userCode)}</div>
       <p>Browser didn't open? <a class="link" href="${esc(p.url)}" target="_blank" rel="noopener">Open the page</a>. If it asked you to sign in first, open it again after signing in.</p>
       <script>setInterval(async()=>{try{const r=await fetch('/__desktop/status');const s=await r.json();if(s.paired)location.href='/';else if(s.pairing!=='pending')location.reload()}catch{}},1500)</script>`
    : `<h1>Sign in to PLC OS</h1>
       <p>${p?.state === 'denied' ? 'The request was refused. ' : p?.state === 'expired' ? 'The code expired. ' : p?.state === 'failed' ? `Could not reach the server (${esc(p.error)}). ` : ''}This app acts as you on <b>${esc(SERVER.host)}</b>. You allow it once, in your browser, where you're already signed in.</p>
       <form method="post" action="/__desktop/pair"><button type="submit">Sign in with your browser</button></form>`;
  return page('Sign in · PLC OS', body);
}

function offlinePage(why) {
  return page('Offline · PLC OS', `<h1>Can't reach PLC OS</h1><p>The server at <b>${esc(SERVER.host)}</b> did not answer (${esc(why)}).</p><p><a class="btn" href="javascript:location.reload()">Try again</a></p>`);
}

function aboutPage() {
  const s = statusJson();
  const l = s.local;
  const row = (k, v) => `<tr><td style="color:var(--mute);padding:3px 16px 3px 0;vertical-align:top">${esc(k)}</td><td>${v}</td></tr>`;
  const when = (iso) => (iso ? esc(new Date(iso).toLocaleString()) : '—');
  return page('PLC OS · this Mac', `<h1>PLC OS on this Mac</h1>
    <table style="border-collapse:collapse;margin:12px 0">
      ${row('Signed in as', s.user ? `<b>${esc(s.user.name)}</b> (${esc(s.user.access)})` : 'nobody')}
      ${row('Live server', `${esc(SERVER.host)} · build ${esc(s.remoteCommit ?? '?')}`)}
      ${row('Local copy', l ? `<b>${esc(l.phase)}</b> · ${esc(l.detail)}` : 'off')}
      ${l ? row('Local build', esc(l.build ?? '—')) : ''}
      ${l?.lastSync ? row('Last sync', `${when(l.lastSync.at)} · ${l.lastSync.tables} table(s), ${l.lastSync.rows} row(s) in ${l.lastSync.ms} ms`) : ''}
      ${row('Requests', `${s.stats.local} from this Mac · ${s.stats.remote} from the server · ${s.stats.static} cached files · ${s.stats.writes} changes sent`)}
    </table>
    <p>Reads come from this Mac when its copy is current; every change goes to the live server, as you.</p>
    <p><button onclick="fetch('/__desktop/sync',{method:'POST'}).then(()=>setTimeout(()=>location.reload(),1500))">Sync now</button>
       <a class="link" href="/today" style="margin-left:12px">Back to PLC OS</a></p>
    <script>setTimeout(()=>location.reload(),5000)</script>`);
}

function statusJson() {
  return {
    ok: true, version: VERSION, server: SERVER.origin, paired: Boolean(state.session), user: state.user,
    pairing: state.pairing?.state ?? null, remoteCommit: state.remote?.commit ?? null,
    local: state.local?.status?.() ?? null, lastWriteAt: state.lastWriteAt || null, stats: state.stats,
  };
}

// ---- the server ---------------------------------------------------------------------------------------------------

function keyOk(req) {
  if (!KEY) return true;
  const got = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${KEY_COOKIE}=`))?.slice(KEY_COOKIE.length + 1) ?? '';
  const a = createHash('sha256').update(got).digest(), b = createHash('sha256').update(KEY).digest();
  return timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  try {
    // Only this address: a page elsewhere cannot rebind a name of its own onto this port.
    if (req.headers.host !== `127.0.0.1:${PORT}` && req.headers.host !== `localhost:${PORT}`) { res.writeHead(421).end(); return; }
    const url = new URL(req.url ?? '/', ORIGIN);
    if (url.pathname === '/__desktop/enter') {
      const k = url.searchParams.get('k') ?? '';
      if (!KEY || k !== KEY) { res.writeHead(403).end('wrong key'); return; }
      const to = url.searchParams.get('to') ?? '/';
      res.writeHead(303, { location: to.startsWith('/') && !to.startsWith('//') ? to : '/', 'set-cookie': `${KEY_COOKIE}=${KEY}; Path=/; HttpOnly; SameSite=Strict` }).end();
      return;
    }
    // The browser, sent here by the server after you press Allow: no launch key (it is another browser), but it
    // carries a one-time grant that only this process's verifier can exchange.
    if (url.pathname === '/__desktop/callback' && req.method === 'GET') {
      const why = await finishPairing(url.searchParams.get('grant') ?? '', url.searchParams.get('code') ?? '').catch((e) => String(e?.message ?? e));
      res.writeHead(why ? 400 : 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        .end(why ? page('Not signed in · PLC OS', `<h1>Not signed in</h1><p>${esc(why)}</p>`)
          : page('Signed in · PLC OS', `<h1>PLC OS is signed in</h1><p>The app on this Mac now acts as <b>${esc(state.user?.name ?? 'you')}</b>. You can close this tab and go back to the app.</p>`));
      return;
    }
    if (!keyOk(req)) { res.writeHead(403, { 'content-type': 'text/plain' }).end('Open PLC OS from the app.'); return; }
    // A write must come from this window's own page.
    const write = !(req.method === 'GET' || req.method === 'HEAD');
    if (write && req.headers.origin && req.headers.origin !== ORIGIN && req.headers.origin !== `http://localhost:${PORT}`) { res.writeHead(403).end('cross-origin'); return; }

    if (url.pathname === '/__desktop/about') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(aboutPage()); return; }
    if (url.pathname === '/__desktop/status') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(statusJson())); return; }
    if (url.pathname === '/__desktop/pair') {
      if (req.method === 'POST') { await readBody(req); try { await startPairing(); } catch (e) { state.pairing = { state: 'failed', error: String(e?.message ?? e) }; } res.writeHead(303, { location: '/__desktop/pair' }).end(); return; }
      if (state.session) { res.writeHead(303, { location: '/' }).end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(pairPage()); return;
    }
    if (url.pathname === '/__desktop/signout' && req.method === 'POST') {
      await readBody(req);
      await signOutLocally('signed out from the app menu');
      state.pairing = null;
      res.writeHead(303, { location: '/__desktop/pair' }).end(); return;
    }
    if (url.pathname === '/__desktop/sync' && req.method === 'POST') {
      await readBody(req);
      state.local?.syncNow?.();
      res.writeHead(202, { 'content-type': 'application/json' }).end('{"ok":true}'); return;
    }
    if (url.pathname.startsWith('/__desktop/')) { res.writeHead(404).end(); return; }

    if (!state.session) {
      if (req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')) { res.writeHead(303, { location: '/__desktop/pair' }).end(); return; }
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"Sign in to PLC OS from the app."}'); return;
    }

    if (req.method === 'GET') {
      const file = staticFile(url.pathname);
      if (file && existsSync(file)) { serveStatic(file, res); return; }
    }
    const which = chooseUpstream(req, url);
    const body = write ? await readBody(req) : null;
    forward(req, res, url, which, body, { retryRemoteOnError: which === 'local' });
  } catch (e) {
    log('error', String(e?.stack ?? e));
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end('PLC OS desktop error');
  }
});

// ---- start --------------------------------------------------------------------------------------------------------

async function boot() {
  const saved = await secrets.get();
  if (saved && saved.includes('=')) {
    const i = saved.indexOf('=');
    state.session = { name: saved.slice(0, i), value: saved.slice(i + 1) };
    try { await refreshInfo(); } catch (e) { log('could not reach the server at start:', String(e?.message ?? e)); }
  }
  if (!env.PLCOS_DESKTOP_NO_LOCAL) {
    try {
      if (!existsSync(path.join(HERE, 'local.mjs'))) throw new Error('no local.mjs');
      const { startLocal } = await import(path.join(HERE, 'local.mjs'));
      state.local = await startLocal({ state, log, refreshInfo, remoteFetch, DATA_DIR });
    } catch (e) { log('the local copy did not start:', String(e?.stack ?? e)); }
  }
  // Learn when the live server deploys a new build (the local copy follows it).
  setInterval(() => { if (state.session) refreshInfo().catch(() => undefined); }, 60_000).unref();
}

server.on('error', (e) => { log('cannot listen:', String(e.message)); process.exit(e.code === 'EADDRINUSE' ? 3 : 1); });
server.listen(PORT, '127.0.0.1', () => {
  log(`core ${VERSION} on ${ORIGIN}, server ${SERVER.origin}, data ${DATA_DIR}`);
  process.stdout.write(`PLCOS_DESKTOP_READY ${ORIGIN}\n`);
  boot().catch((e) => log('boot failed', String(e?.stack ?? e)));
});
// The shell holds our stdin: when it quits, so do we (and the local copy with us).
if (env.PLCOS_DESKTOP_STDIN_EXIT !== '0' && !process.stdin.isTTY) {
  process.stdin.on('end', () => shutdown('stdin closed'));
  process.stdin.on('error', () => shutdown('stdin error'));
  process.stdin.resume();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
let stopping = false;
async function shutdown(why) {
  if (stopping) return;
  stopping = true;
  log('stopping:', why);
  try { await state.local?.stop?.(); } catch { /* exiting anyway */ }
  process.exit(0);
}

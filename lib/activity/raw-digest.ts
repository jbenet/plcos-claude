import { Worker } from 'node:worker_threads';

export interface RawDigest {
  at: string;
  queries: { requests: number; bytes: number } | null;
  hosts: Array<{ origin: string; requests: number }>;
}

// Plain JS intentionally: Next and tsx can both run this worker without a second
// build artifact or a TS loader. Large JSON parsing and URL enumeration never run
// on the server event loop. Only counts, timestamps and sanitized hosts return.
const source = String.raw`
const {parentPort} = require('node:worker_threads');
const {readFile} = require('node:fs/promises');
function host(v) {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v.includes('://') ? v : 'https://' + v);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    const h = u.hostname.toLowerCase().replace(/\.$/, '');
    return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(h) ? h : null;
  } catch { return null; }
}
parentPort.on('message', async path => {
  try {
    let r;
    try { r = JSON.parse(await readFile(path, 'utf8')); }
    catch (e) { if (e instanceof SyntaxError || e.code === 'ENOENT') { parentPort.postMessage({value:null}); return; } throw e; }
    const at = r?.researched?.at;
    if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}(T|$)/.test(at) || !Number.isFinite(Date.parse(at))) {
      parentPort.postMessage({value:null}); return;
    }
    const urls = new Set();
    const take = v => { if (typeof v === 'string' && host(v)) { try { const u = new URL(v); u.hash = ''; urls.add(u.href); } catch {} } };
    for (const f of Array.isArray(r.facts) ? r.facts : []) take(f?.source?.url);
    for (const l of Array.isArray(r.identity?.links) ? r.identity.links : []) take(l?.url);
    for (const c of Array.isArray(r.connections) ? r.connections : []) take(c?.source);
    for (const s of Array.isArray(r.profile?.signals) ? r.profile.signals : []) take(s?.source);
    const hosts = new Map();
    for (const url of urls) { const h = host(url); hosts.set(h, (hosts.get(h) ?? 0) + 1); }
    parentPort.postMessage({value:{at,
      queries:Array.isArray(r.queries) ? {requests:r.queries.length, bytes:Buffer.byteLength(JSON.stringify(r.queries), 'utf8')} : null,
      hosts:[...hosts].map(([origin,requests]) => ({origin,requests}))}});
  } catch { parentPort.postMessage({error:true}); }
});
`;

/** One worker per refresh, started lazily only if a research file changed. */
export class RawDigester {
  private worker?: Worker;
  async read(path: string): Promise<RawDigest | null> {
    const worker = this.worker ??= new Worker(source, { eval: true });
    return new Promise((resolve, reject) => {
      const cleanup = () => { worker.off('message', message); worker.off('error', error); worker.off('exit', exited); };
      const error = () => { cleanup(); reject(new Error('Activity research digest failed')); };
      const exited = () => error();
      const message = (result: { value: RawDigest | null; error?: boolean }) => {
        cleanup();
        if (result.error) reject(new Error('Activity research file could not be read'));
        else resolve(result.value);
      };
      worker.once('message', message); worker.once('error', error); worker.once('exit', exited);
      worker.postMessage(path);
    });
  }
  async close() { await this.worker?.terminate(); this.worker = undefined; }
}

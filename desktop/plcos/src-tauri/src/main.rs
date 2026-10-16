// PLC OS: the desktop app (docs/31-desktop-app.md).
//
// A window onto PLC OS's own pages, served through the local core (core/core.mjs, bundled as a resource): the core
// holds your session, sends every change to the live server as you, and answers reads from the local copy when it
// can. This shell only starts the core, shows its window and gives it a Mac menu. The pages get no Tauri commands.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const PORT: u16 = 47100;
const DEFAULT_SERVER: &str = "https://plcos-production.up.railway.app";
const FALLBACK_PATH: &str = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

fn home() -> PathBuf { PathBuf::from(std::env::var("HOME").unwrap_or_default()) }

fn data_dir() -> PathBuf {
    let d = std::env::var("PLCOS_DESKTOP_DIR").map(PathBuf::from).unwrap_or_else(|_| {
        if cfg!(target_os = "macos") { home().join("Library/Application Support/PLC OS") } else { home().join(".local/share/plcos-desktop") }
    });
    let _ = std::fs::create_dir_all(&d);
    d
}

fn local_origin() -> String { format!("http://127.0.0.1:{PORT}") }

/// The live server: the core's settings file, else the default.
fn server_url() -> String {
    std::env::var("PLCOS_SERVER").ok()
        .or_else(|| {
            let text = std::fs::read_to_string(data_dir().join("settings.json")).ok()?;
            let at = text.find("\"server\"")?;
            let rest = &text[at + 8..];
            let start = rest.find('"')? + 1;
            let end = rest[start..].find('"')? + start;
            Some(rest[start..end].to_string())
        })
        .unwrap_or_else(|| DEFAULT_SERVER.into())
        .trim_end_matches('/').to_string()
}

/// A Finder-launched app has almost no PATH; ask the login shell once per launch (JuanMail learned this).
fn login_path() -> String {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let out = Command::new(shell).args(["-lc", "printf '%s' \"$PATH\""]).stdin(Stdio::null()).stderr(Stdio::null()).output();
        let _ = tx.send(out.ok().and_then(|o| String::from_utf8(o.stdout).ok()).unwrap_or_default());
    });
    let found = rx.recv_timeout(Duration::from_secs(8)).unwrap_or_default();
    let cache = data_dir().join("path.txt");
    if !found.trim().is_empty() {
        let p = format!("{}:{}", found.trim(), FALLBACK_PATH);
        let _ = std::fs::write(&cache, &p);
        return p;
    }
    std::fs::read_to_string(&cache).unwrap_or_else(|_| FALLBACK_PATH.into())
}

fn find_node(path: &str) -> Option<PathBuf> {
    if let Ok(n) = std::env::var("PLCOS_NODE") { return Some(PathBuf::from(n)); }
    path.split(':').map(|d| PathBuf::from(d).join("node")).find(|p| p.is_file())
}

fn core_script(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PLCOS_DESKTOP_CORE") { return Some(PathBuf::from(p)); }
    let bundled = app.path().resource_dir().ok().map(|d| d.join("core/core.mjs"));
    if let Some(b) = bundled.filter(|p| p.is_file()) { return Some(b); }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../core/core.mjs");
    dev.is_file().then_some(dev)
}

fn random_key() -> String {
    let mut buf = [0u8; 32];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") { let _ = f.read_exact(&mut buf); }
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    buf[0] ^= (nanos & 0xff) as u8;
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Default)]
struct Core { child: Option<Child>, key: String }
type Shared = Arc<Mutex<Core>>;

/// Start the core and wait for it to say it is listening. Its stdin stays ours: when this app quits, it quits.
fn start_core(app: &AppHandle) -> Result<(Child, String), String> {
    let path = login_path();
    let node = find_node(&path).ok_or("Node is not installed (looked on your login shell's PATH). Install it with Homebrew: brew install node")?;
    let script = core_script(app).ok_or("The app's core is missing from the bundle.")?;
    let key = random_key();
    let log = std::fs::OpenOptions::new().create(true).append(true).open(data_dir().join("core-stderr.log")).map_err(|e| e.to_string())?;
    let mut child = Command::new(node)
        .arg(&script)
        .env("PATH", &path)
        .env("PLCOS_DESKTOP_KEY", &key)
        .env("PLCOS_DESKTOP_PORT", PORT.to_string())
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(log)
        .spawn().map_err(|e| format!("Could not start the core: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.starts_with("PLCOS_DESKTOP_READY") { let _ = tx.send(()); }
        }
    });
    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(()) => Ok((child, key)),
        Err(_) => {
            let _ = child.kill();
            Err("The core did not start; see PLC OS → Open Logs.".into())
        }
    }
}

fn error_page(why: &str) -> String {
    let safe = why.replace('&', "&amp;").replace('<', "&lt;").replace('"', "&quot;");
    format!("document.body.innerHTML = '<div style=\"max-width:460px;padding:24px\"><h2 style=\"margin:0 0 8px\">PLC OS could not start</h2><p>' + {:?} + '</p></div>'", safe)
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> { app.get_webview_window("main") }

fn open_external(url: &str) {
    let opener = if cfg!(target_os = "macos") { "/usr/bin/open" } else { "xdg-open" };
    let _ = Command::new(opener).arg(url).spawn();
}

/// Links into the live server open here, through the core; anything else opens in the default browser.
fn navigation_allowed(app: &AppHandle, url: &Url) -> bool {
    let host = url.host_str().unwrap_or("");
    if (host == "127.0.0.1" || host == "localhost") && url.port() == Some(PORT) { return true; }
    if url.scheme() == "tauri" || (url.scheme() == "http" && host == "tauri.localhost") || url.scheme() == "about" || url.scheme() == "data" { return true; }
    if let Ok(server) = Url::parse(&server_url()) {
        if url.host_str() == server.host_str() && url.scheme() == server.scheme() {
            let local = format!("{}{}{}", local_origin(), url.path(), url.query().map(|q| format!("?{q}")).unwrap_or_default());
            let app = app.clone();
            std::thread::spawn(move || {
                if let (Some(w), Ok(u)) = (main_window(&app), Url::parse(&local)) { let _ = w.navigate(u); }
            });
            return false;
        }
    }
    if matches!(url.scheme(), "http" | "https" | "mailto" | "tel") { open_external(url.as_str()); }
    false
}

/// Pages open links in a new tab with target=_blank; this window has no tabs, so they open in place (or, off the
/// server, in the browser by way of navigation_allowed).
const INIT_SCRIPT: &str = r#"
(() => {
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || e.defaultPrevented) return;
    if (a.target === '_blank' || e.metaKey) { e.preventDefault(); location.href = new URL(a.getAttribute('href'), location.href).href; }
  }, true);
  window.open = (u) => { if (u) location.href = new URL(String(u), location.href).href; return null; };

  // How long clicks take in this window (15 Oct 2026): from a click to the page standing still, with the page data's
  // fetch and any long pauses in the window's own work, sent to the core's perf.log. Paths only, no page text.
  if (location.port !== '47100') return;

  // A plain link to one of the app's own pages opens in place, as the app's own links do (16 Oct 2026). A page that
  // still used <a> for an LP reloaded the whole window, 1-2 s here, against 4 ms for the page from the local copy.
  // Bubbling, so the app's links (which handle their own clicks first) are left alone; modified clicks, downloads,
  // files, the API, sign-in and in-page anchors keep the browser's way.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    const u = new URL(a.getAttribute('href'), location.href);
    if (u.origin !== location.origin || /^\/(api|auth|__desktop|signin|setup|_next)(\/|$)/.test(u.pathname) || /\.[a-z0-9]+$/i.test(u.pathname)) return;
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return;
    const router = window.next && window.next.router;
    if (!router || typeof router.push !== 'function') return;
    e.preventDefault();
    router.push(u.pathname + u.search + u.hash);
  });

  const send = (o) => { try { fetch('/__desktop/perf', { method: 'POST', body: JSON.stringify(o), keepalive: true, headers: { 'content-type': 'application/json' } }); } catch (_) {} };
  addEventListener('load', () => setTimeout(() => {
    const n = performance.getEntriesByType('navigation')[0];
    if (n) send({ kind: 'load', path: location.pathname, ttfb: Math.round(n.responseStart), html: Math.round(n.responseEnd), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), bytes: n.transferSize || n.decodedBodySize || 0 });
  }, 0));
  let run = 0, exploring = false;
  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('a[href],tr[data-lp],button,[role=button],summary,label') : null;
    if (!el) return;
    const tab = (el.getAttribute('href') || '').match(/[?&]tab=/) ? '?tab' : '';
    timeStep(el.tagName.toLowerCase() + (el.getAttribute('href') ? ' ' + el.getAttribute('href').split('?')[0] + tab : ''), e.timeStamp);
  }, true);
  function timeStep(what, t0) {
    const id = ++run, from = location.pathname + location.search;
    let last = performance.now(), changed = false, stall = 0, prev = performance.now();
    const mo = new MutationObserver(() => { last = performance.now(); changed = true; });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    const frame = () => { const t = performance.now(); if (t - prev > 50) stall += t - prev; prev = t; if (run === id) requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    const check = setInterval(() => {
      const now = performance.now(), url = location.pathname + location.search;
      if (run !== id || now - t0 > 8000 || ((changed || url !== from) && now - last > 150)) {
        clearInterval(check); mo.disconnect();
        if (!changed && url === from) return;
        const rsc = performance.getEntriesByType('resource').filter((r) => r.startTime >= t0 - 5 && r.name.includes('_rsc'));
        send({ kind: 'click', what, from: from.split('?')[0], to: location.pathname, total: Math.round(last - t0),
          fetch: Math.round(rsc.reduce((m, r) => Math.max(m, r.responseEnd - t0), 0)), bytes: rsc.reduce((b, r) => b + (r.transferSize || r.decodedBodySize || 0), 0),
          requests: rsc.length, stall: Math.round(stall), superseded: run !== id, ...(exploring ? { explore: true } : {}) });
      }
    }, 25);
  }

  // Explore mode (16 Oct 2026; the core's /__desktop/explore, on while DATA_DIR/explore.json exists): walks the app the
  // way it is used most (the rail's Pipeline, an LP, its tabs, back, the next LP; sometimes another module), by links
  // only, with a pointer's pause before half the clicks, timing each step above. The core refuses every change meanwhile.
  // Any real key, click or scroll stops it for good.
  fetch('/__desktop/explore', { cache: 'no-store' }).then((r) => r.json()).then((cfg) => { if (cfg && cfg.on) explore(cfg); }).catch(() => {});
  function explore(cfg) {
    exploring = true;
    let stopped = false;
    const stop = () => { if (stopped) return; stopped = true; exploring = false; fetch('/__desktop/explore', { method: 'POST' }).catch(() => {}); };
    for (const t of ['mousedown', 'keydown', 'wheel', 'touchstart']) addEventListener(t, (e) => { if (e.isTrusted) stop(); }, true);
    let st;
    try { st = JSON.parse(sessionStorage.getItem('plcos-explore') || 'null'); } catch (_) { st = null; }
    if (!st) st = { n: 0, seed: cfg.seed * 9301 + 49297 };
    const rand = () => (st.seed = (st.seed * 9301 + 49297) % 233280) / 233280;
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const shown = (sel) => [...document.querySelectorAll(sel)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('details:not([open])'); });
    const ok = (a) => { const h = a.getAttribute('href') || ''; return h.startsWith('/') && !/^\/(api|auth|__desktop|signin|setup|settings|preferences|developer|dev|desktop)(\/|$)/.test(h) && !a.hasAttribute('download') && !a.target; };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const quiet = async () => { const end = performance.now() + 8000; let last = performance.now(); const mo = new MutationObserver(() => { last = performance.now(); }); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); while (performance.now() - last < 400 && performance.now() < end) await sleep(50); mo.disconnect(); };
    (async () => {
      await sleep(2500);
      while (!stopped && st.n < cfg.steps) {
        st.n++; try { sessionStorage.setItem('plcos-explore', JSON.stringify(st)); } catch (_) {}
        const x = rand();
        const rows = shown('div.work tbody a[href^="/"]').filter(ok), tabs = shown('div.work nav[class*=lp-header] a[href^="/"]').filter(ok);
        let el = null;
        if (x < 0.14 && history.length > 1) { timeStep('back', performance.now()); history.back(); }
        else if (x < 0.40 && tabs.length) el = pick(tabs);
        else if (x < 0.78 && rows.length) el = rand() < 0.6 ? pick(rows.slice(0, 6)) : pick(rows);
        else {
          const rail = shown('nav.rail a[href^="/"]').filter(ok);
          const pipe = rail.filter((a) => /\/pipeline$/.test(a.getAttribute('href')));
          el = pick(rand() < 0.6 && pipe.length ? pipe : rail);
        }
        if (el) {
          el.scrollIntoView({ block: 'center' });
          if (rand() < 0.5) { for (const t of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: !t.endsWith('enter') })); await sleep(250); }
          el.click();
        }
        await sleep(300); await quiet(); await sleep(400 + rand() * 1000);
      }
      if (!stopped && st.n >= cfg.steps) stop();
    })();
  }
})();
"#;

fn show_main(app: &AppHandle) {
    if let Some(w) = main_window(app) { let _ = w.show(); let _ = w.unminimize(); let _ = w.set_focus(); }
}

fn build_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let nav_app = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("PLC OS")
        .inner_size(1440.0, 920.0)
        .min_inner_size(760.0, 520.0)
        .initialization_script(INIT_SCRIPT)
        .on_navigation(move |url| navigation_allowed(&nav_app, url))
        .on_download(|_webview, event| {
            if let DownloadEvent::Requested { url, destination } = event {
                let name = destination.file_name().map(|n| n.to_owned())
                    .or_else(|| url.path_segments().and_then(|mut s| s.next_back().map(|x| x.into())))
                    .unwrap_or_else(|| "download".into());
                *destination = home().join("Downloads").join(name);
            }
            true
        })
        .build()
}

fn eval(app: &AppHandle, js: &str) { if let Some(w) = main_window(app) { let _ = w.eval(js); } }

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = PredefinedMenuItem::about(app, Some("About PLC OS"), Some(AboutMetadata { name: Some("PLC OS".into()), version: Some(env!("CARGO_PKG_VERSION").into()), ..Default::default() }))?;
    let sep = || PredefinedMenuItem::separator(app);
    let app_menu = Submenu::with_items(app, "PLC OS", true, &[
        &about, &sep()?,
        &MenuItem::with_id(app, "signout", "Sign Out of This Mac…", true, None::<&str>)?,
        &MenuItem::with_id(app, "logs", "Open Logs", true, None::<&str>)?,
        &sep()?, &PredefinedMenuItem::services(app, None)?, &sep()?,
        &PredefinedMenuItem::hide(app, None)?, &PredefinedMenuItem::hide_others(app, None)?, &PredefinedMenuItem::show_all(app, None)?,
        &sep()?, &PredefinedMenuItem::quit(app, None)?,
    ])?;
    let edit = Submenu::with_items(app, "Edit", true, &[
        &PredefinedMenuItem::undo(app, None)?, &PredefinedMenuItem::redo(app, None)?, &sep()?,
        &PredefinedMenuItem::cut(app, None)?, &PredefinedMenuItem::copy(app, None)?, &PredefinedMenuItem::paste(app, None)?,
        &PredefinedMenuItem::select_all(app, None)?,
    ])?;
    let view = Submenu::with_items(app, "View", true, &[
        &MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
        &MenuItem::with_id(app, "back", "Back", true, Some("CmdOrCtrl+["))?,
        &MenuItem::with_id(app, "forward", "Forward", true, Some("CmdOrCtrl+]"))?,
        &sep()?,
        &MenuItem::with_id(app, "today", "Today", true, Some("CmdOrCtrl+Shift+H"))?,
        &MenuItem::with_id(app, "sync", "Sync Now", true, Some("CmdOrCtrl+Shift+S"))?,
        &MenuItem::with_id(app, "status", "Sync Status", true, None::<&str>)?,
        &MenuItem::with_id(app, "browser", "Open This Page in Browser", true, Some("CmdOrCtrl+Shift+O"))?,
        &sep()?, &PredefinedMenuItem::fullscreen(app, None)?,
    ])?;
    let window = Submenu::with_items(app, "Window", true, &[
        &PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::maximize(app, None)?, &sep()?,
        &PredefinedMenuItem::close_window(app, None)?,
    ])?;
    Menu::with_items(app, &[&app_menu, &edit, &view, &window])
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "reload" => eval(app, "location.reload()"),
        "back" => eval(app, "history.back()"),
        "forward" => eval(app, "history.forward()"),
        "today" => eval(app, "location.href = '/today'"),
        "status" => eval(app, "location.href = '/__desktop/about'"),
        "sync" => eval(app, "fetch('/__desktop/sync', { method: 'POST' })"),
        "signout" => eval(app, "if (confirm('Sign PLC OS out on this Mac? You can sign in again from your browser.')) fetch('/__desktop/signout', { method: 'POST' }).then(() => { location.href = '/__desktop/pair'; })"),
        "logs" => open_external(&data_dir().join("core.log").to_string_lossy()),
        "browser" => {
            let path = main_window(app).and_then(|w| w.url().ok())
                .filter(|u| u.port() == Some(PORT) && !u.path().starts_with("/__desktop"))
                .map(|u| format!("{}{}", u.path(), u.query().map(|q| format!("?{q}")).unwrap_or_default()))
                .unwrap_or_else(|| "/".into());
            open_external(&format!("{}{}", server_url(), path));
        }
        _ => {}
    }
}

fn main() {
    let core: Shared = Arc::new(Mutex::new(Core::default()));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .manage(core.clone())
        .setup({
            let core = core.clone();
            move |app| {
                let handle = app.handle().clone();
                app.set_menu(build_menu(&handle)?)?;
                app.on_menu_event(|app, event| on_menu(app, event.id().as_ref()));
                let window = build_window(&handle)?;
                // Closing the window hides it; the Dock icon brings it back. Quitting stops the core.
                {
                    let w = window.clone();
                    window.on_window_event(move |e| {
                        if let WindowEvent::CloseRequested { api, .. } = e {
                            if cfg!(target_os = "macos") { api.prevent_close(); let _ = w.hide(); }
                        }
                    });
                }
                std::thread::spawn(move || match start_core(&handle) {
                    Ok((child, key)) => {
                        { let mut c = core.lock().unwrap(); c.child = Some(child); c.key = key.clone(); }
                        let url = format!("{}/__desktop/enter?k={}&to=/today", local_origin(), key);
                        if let (Some(w), Ok(u)) = (main_window(&handle), Url::parse(&url)) { let _ = w.navigate(u); }
                    }
                    Err(why) => eval(&handle, &error_page(&why)),
                });
                Ok(())
            }
        })
        .build(tauri::generate_context!())
        .expect("PLC OS failed to start");

    app.run(move |_app, event| match event {
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(_app),
        RunEvent::Exit => {
            if let Some(mut c) = core.lock().unwrap().child.take() {
                drop(c.stdin.take());
                for _ in 0..30 { if matches!(c.try_wait(), Ok(Some(_))) { break; } std::thread::sleep(Duration::from_millis(100)); }
                let _ = c.kill();
            }
        }
        _ => {}
    });
}

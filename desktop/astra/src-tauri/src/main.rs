// Astra: a menu-bar app that keeps the Astra runner going on this Mac and shows Developer → Astra.
//
// The runner (`npm run astra` in the live checkout, docs/30-astra-runner.md) does the work: it polls
// POST /api/sync/astra on the server, cuts batches and runs codex. This app only supervises it and
// opens the server's page. If the runner is already installed as a login item (launchd label
// com.plcos.astra-runner), the app leaves it alone and only shows its state.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const LAUNCHD_LABEL: &str = "com.plcos.astra-runner";
const PATH: &str = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

fn home() -> PathBuf { PathBuf::from(std::env::var("HOME").unwrap_or_default()) }
fn live() -> PathBuf {
    std::env::var("PLCOS_LIVE").map(PathBuf::from).unwrap_or_else(|_| home().join("git/plc-os/plcos-claude-live"))
}
fn log_dir() -> PathBuf { home().join("git/plc-os/plcos-data/real/workflows/astra") }

fn keychain(account: &str) -> Option<String> {
    let out = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", "plcos-railway", "-a", account, "-w"])
        .output().ok()?;
    let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if out.status.success() && !s.is_empty() { Some(s) } else { None }
}

/// The server's base URL: the Keychain item the runner uses, else ~/.plcos-helpers/cloud-url.
fn app_url() -> String {
    keychain("app-url")
        .or_else(|| std::fs::read_to_string(home().join(".plcos-helpers/cloud-url")).ok().map(|s| s.trim().to_string()))
        .unwrap_or_else(|| "https://plcos-production.up.railway.app".into())
        .trim_end_matches('/').to_string()
}
fn page_url() -> String { format!("{}/dev/astra", app_url()) }

fn launchd_runner() -> bool {
    let uid = Command::new("/usr/bin/id").arg("-u").output().ok()
        .and_then(|o| String::from_utf8(o.stdout).ok()).unwrap_or_default();
    Command::new("/bin/launchctl").args(["print", &format!("gui/{}/{}", uid.trim(), LAUNCHD_LABEL)])
        .stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

#[derive(Default)]
struct Runner { child: Option<Child>, wanted: bool, restarts: u32 }

impl Runner {
    fn alive(&mut self) -> bool {
        match self.child.as_mut().map(|c| c.try_wait()) {
            Some(Ok(None)) => true,
            _ => { self.child = None; false }
        }
    }
    fn start(&mut self) -> Result<(), String> {
        if self.alive() { return Ok(()); }
        std::fs::create_dir_all(log_dir()).map_err(|e| e.to_string())?;
        let log = OpenOptions::new().create(true).append(true).open(log_dir().join("runner-app.log"))
            .map_err(|e| e.to_string())?;
        let child = Command::new("/bin/bash")
            .args(["-lc", "exec npm run astra"])
            .current_dir(live())
            .env("PATH", PATH)
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log)
            .spawn().map_err(|e| e.to_string())?;
        self.child = Some(child);
        Ok(())
    }
    fn stop(&mut self) {
        if let Some(mut c) = self.child.take() {
            // SIGTERM first so the runner can hand back claimed work; then make sure it is gone.
            let _ = Command::new("/bin/kill").arg(c.id().to_string()).status();
            for _ in 0..50 { if matches!(c.try_wait(), Ok(Some(_))) { return; } std::thread::sleep(Duration::from_millis(100)); }
            let _ = c.kill();
        }
    }
}

type Shared = Arc<Mutex<Runner>>;

fn status_text(r: &Shared) -> String {
    if launchd_runner() { return "Runner: running as login item".into(); }
    let mut r = r.lock().unwrap();
    if r.alive() { "Runner: running".into() } else if r.wanted { "Runner: restarting…".into() } else { "Runner: stopped".into() }
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show(); let _ = w.set_focus(); return;
    }
    let url = page_url().parse().expect("valid app URL");
    let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Astra").inner_size(1100.0, 800.0).build();
}

fn main() {
    let runner: Shared = Arc::new(Mutex::new(Runner::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .setup({
            let runner = runner.clone();
            move |app| {
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);

                let status = MenuItem::with_id(app, "status", status_text(&runner), false, None::<&str>)?;
                let open = MenuItem::with_id(app, "open", "Open Developer → Astra", true, Some("CmdOrCtrl+O"))?;
                let browser = MenuItem::with_id(app, "browser", "Open in Browser", true, None::<&str>)?;
                let toggle = MenuItem::with_id(app, "toggle", "Start Runner", true, None::<&str>)?;
                let logs = MenuItem::with_id(app, "logs", "Open Runner Logs", true, None::<&str>)?;
                let login = CheckMenuItem::with_id(app, "login", "Open at Login",
                    true, app.autolaunch().is_enabled().unwrap_or(false), None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Quit Astra", true, Some("CmdOrCtrl+Q"))?;
                let sep = || PredefinedMenuItem::separator(app);
                let menu = Menu::with_items(app, &[&status, &sep()?, &open, &browser, &sep()?, &toggle, &logs, &login, &sep()?, &quit])?;

                // Start the runner unless launchd already runs it.
                if !launchd_runner() {
                    let mut r = runner.lock().unwrap();
                    r.wanted = true;
                    if let Err(e) = r.start() { eprintln!("runner start failed: {e}"); }
                }

                let refresh = {
                    let (runner, status, toggle) = (runner.clone(), status.clone(), toggle.clone());
                    move || {
                        let _ = status.set_text(status_text(&runner));
                        let external = launchd_runner();
                        let on = runner.lock().unwrap().wanted;
                        let _ = toggle.set_enabled(!external);
                        let _ = toggle.set_text(if on { "Stop Runner" } else { "Start Runner" });
                    }
                };
                refresh();

                // Supervisor: restart the runner if it exits while wanted (30 s apart, like launchd's KeepAlive).
                {
                    let (runner, refresh) = (runner.clone(), refresh.clone());
                    std::thread::spawn(move || loop {
                        std::thread::sleep(Duration::from_secs(30));
                        if !launchd_runner() {
                            let mut r = runner.lock().unwrap();
                            if r.wanted && !r.alive() {
                                r.restarts += 1;
                                if let Err(e) = r.start() { eprintln!("runner restart failed: {e}"); }
                            }
                        }
                        refresh();
                    });
                }

                TrayIconBuilder::with_id("astra")
                    .icon(tauri::image::Image::from_bytes(include_bytes!("../tray.png"))?)
                    .icon_as_template(true)
                    .tooltip("Astra")
                    .menu(&menu)
                    .on_menu_event({
                        let (runner, refresh) = (runner.clone(), refresh.clone());
                        move |app, e| match e.id().as_ref() {
                            "open" => show_window(app),
                            "browser" => { let _ = Command::new("/usr/bin/open").arg(page_url()).status(); }
                            "logs" => { let _ = Command::new("/usr/bin/open").arg(log_dir()).status(); }
                            "toggle" => {
                                let mut r = runner.lock().unwrap();
                                if r.wanted { r.wanted = false; r.stop(); } else { r.wanted = true; let _ = r.start(); }
                                drop(r); refresh();
                            }
                            "login" => {
                                let a = app.autolaunch();
                                let _ = if a.is_enabled().unwrap_or(false) { a.disable() } else { a.enable() };
                            }
                            "quit" => { runner.lock().unwrap().stop(); app.exit(0); }
                            _ => {}
                        }
                    })
                    .build(app)?;
                Ok(())
            }
        })
        .on_window_event(|w, e| {
            // Closing the window hides it; the app keeps running in the menu bar.
            if let WindowEvent::CloseRequested { api, .. } = e { api.prevent_close(); let _ = w.hide(); }
        })
        .build(tauri::generate_context!())
        .expect("error building Astra")
        .run({
            let runner = runner.clone();
            move |_, e| if let tauri::RunEvent::Exit = e { runner.lock().unwrap().stop(); }
        });
}

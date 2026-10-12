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
use base64::Engine;
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
            .env("ASTRA_SUPERVISED", "1")
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

/// The app lives in the menu bar, but shows in the Dock and Cmd-Tab while one of its windows is open.
fn in_dock(app: &AppHandle, on: bool) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(if on { tauri::ActivationPolicy::Regular } else { tauri::ActivationPolicy::Accessory });
    #[cfg(not(target_os = "macos"))]
    let _ = (app, on);
}

fn show_window(app: &AppHandle) {
    in_dock(app, true);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show(); let _ = w.set_focus(); return;
    }
    let url = page_url().parse().expect("valid app URL");
    let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Astra").inner_size(1100.0, 800.0).build();
}

fn show_feedback(app: &AppHandle) {
    in_dock(app, true);
    if let Some(w) = app.get_webview_window("feedback") {
        let _ = w.show(); let _ = w.set_focus(); return;
    }
    let _ = WebviewWindowBuilder::new(app, "feedback", WebviewUrl::App("feedback.html".into()))
        .title("Astra Feedback").inner_size(520.0, 520.0).build();
}

/// Lets the person drag over a part of the screen (macOS screencapture), and returns it as a PNG data URL.
#[tauri::command]
async fn capture_region() -> Result<Option<String>, String> {
    let path = std::env::temp_dir().join(format!("astra-feedback-{}.png", std::process::id()));
    let _ = std::fs::remove_file(&path);
    Command::new("/usr/sbin/screencapture").args(["-i", "-x"]).arg(&path).status().map_err(|e| e.to_string())?;
    let Ok(bytes) = std::fs::read(&path) else { return Ok(None) };
    let _ = std::fs::remove_file(&path);
    Ok(Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))))
}

fn log_tail(lines: usize) -> String {
    let text = std::fs::read_to_string(log_dir().join("runner-app.log")).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

/// POST <app-url>/api/sync/<path> with the Admin token from the Keychain. The token stays out of argv:
/// curl reads its header from stdin. Returns the JSON answer, or the server's error.
fn sync_post(path: &str, body: &serde_json::Value) -> Result<serde_json::Value, String> {
    let token = keychain("push-token").ok_or("No Admin token in the Keychain item plcos-railway / push-token.")?;
    let file = std::env::temp_dir().join(format!("astra-sync-{}-{}.json", std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
    std::fs::write(&file, body.to_string()).map_err(|e| e.to_string())?;
    let mut child = Command::new("/usr/bin/curl")
        .args(["-sS", "-m", "60", "-K", "-", "-X", "POST", "-H", "Content-Type: application/json", "--data-binary"])
        .arg(format!("@{}", file.display()))
        .arg(format!("{}/api/sync/{}", app_url(), path))
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| e.to_string())?;
    {
        use std::io::Write;
        let mut stdin = child.stdin.take().unwrap();
        writeln!(stdin, "header = \"Authorization: Bearer {}\"", token).map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&file);
    let answer: serde_json::Value = serde_json::from_slice(&out.stdout)
        .map_err(|_| format!("The server did not answer: {}", String::from_utf8_lossy(&out.stderr).trim()))?;
    if answer["ok"].as_bool() != Some(true) {
        return Err(answer["error"].as_str().unwrap_or("The server refused the call.").to_string());
    }
    Ok(answer)
}

/// One line for the menu from the server's view: is the runner polling, and how many runs are where.
fn server_line() -> String {
    match sync_post("astra", &serde_json::json!({ "op": "status" })) {
        Err(e) => format!("Server: {}", e.chars().take(60).collect::<String>()),
        Ok(a) => {
            let jobs = a["jobs"].as_array().cloned().unwrap_or_default();
            let n = |s: &str| jobs.iter().filter(|j| j["status"] == s).count();
            format!("Server: runner {} · {} running · {} queued · {} done", if a["up"].as_bool() == Some(true) { "up" } else { "not polling" },
                n("running") + n("claimed"), n("queued"), n("done"))
        }
    }
}

fn queue(workflow: &str, size: u32, count: u32, run_now: bool) -> String {
    match sync_post("astra", &serde_json::json!({ "op": "queue", "workflow": workflow, "size": size, "count": count, "runNow": run_now })) {
        Ok(a) => format!("Queued {} run(s){}", a["queued"], if run_now { "; starting on the next poll" } else { " for tonight" }),
        Err(e) => format!("Not queued: {e}"),
    }
}

fn notify(text: &str) {
    let script = format!("display notification {:?} with title \"Astra\"", text);
    let _ = Command::new("/usr/bin/osascript").args(["-e", &script]).status();
}

/// Files an issue on the server as the Admin token's holder: POST /api/sync/feedback?op=file.
/// The token stays out of argv: curl reads its header from stdin.
#[tauri::command]
async fn file_feedback(state: tauri::State<'_, Shared>, body: String, kind: String, priority: String,
                       screenshot: Option<String>, include_log: bool) -> Result<Option<String>, String> {
    let runner = status_text(&state);
    let mut text = body;
    if include_log { text.push_str(&format!("\n\n**Runner log (last 40 lines)**\n\n```\n{}\n```", log_tail(40))); }
    let report = serde_json::json!({
        "body": text, "kind": kind, "priority": priority, "page": "/dev/astra",
        "context": { "source": "astra-app", "appVersion": env!("CARGO_PKG_VERSION"), "runner": runner },
        "screenshots": screenshot.into_iter().collect::<Vec<_>>(),
    });
    let answer = sync_post("feedback?op=file", &report)?;
    Ok(answer["id"].as_str().map(String::from))
}

fn main() {
    let runner: Shared = Arc::new(Mutex::new(Runner::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(runner.clone())
        .invoke_handler(tauri::generate_handler![file_feedback, capture_region])
        .setup({
            let runner = runner.clone();
            move |app| {
                #[cfg(target_os = "macos")]
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);

                let status = MenuItem::with_id(app, "status", status_text(&runner), false, None::<&str>)?;
                let server = MenuItem::with_id(app, "server", "Server: checking…", false, None::<&str>)?;
                let run_now = MenuItem::with_id(app, "run-now", "Run 1 × W1+W5 Now (5 LPs)", true, None::<&str>)?;
                let tonight = MenuItem::with_id(app, "tonight", "Queue 4 × W1+W5 for Tonight", true, None::<&str>)?;
                let open = MenuItem::with_id(app, "open", "Open Developer → Astra", true, Some("CmdOrCtrl+O"))?;
                let browser = MenuItem::with_id(app, "browser", "Open in Browser", true, None::<&str>)?;
                let feedback = MenuItem::with_id(app, "feedback", "Send Feedback…", true, None::<&str>)?;
                let toggle = MenuItem::with_id(app, "toggle", "Start Runner", true, None::<&str>)?;
                let logs = MenuItem::with_id(app, "logs", "Open Runner Logs", true, None::<&str>)?;
                let login = CheckMenuItem::with_id(app, "login", "Open at Login",
                    true, app.autolaunch().is_enabled().unwrap_or(false), None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Quit Astra", true, Some("CmdOrCtrl+Q"))?;
                let sep = || PredefinedMenuItem::separator(app);
                let menu = Menu::with_items(app, &[&status, &server, &sep()?, &run_now, &tonight, &sep()?, &open, &browser, &feedback, &sep()?, &toggle, &logs, &login, &sep()?, &quit])?;

                // Start the runner unless launchd already runs it.
                if !launchd_runner() {
                    let mut r = runner.lock().unwrap();
                    r.wanted = true;
                    if let Err(e) = r.start() { eprintln!("runner start failed: {e}"); }
                }

                let refresh = {
                    let (runner, status, toggle, server) = (runner.clone(), status.clone(), toggle.clone(), server.clone());
                    move || {
                        let _ = status.set_text(status_text(&runner));
                        let _ = server.set_text(server_line());
                        let external = launchd_runner();
                        let on = runner.lock().unwrap().wanted;
                        let _ = toggle.set_enabled(!external);
                        let _ = toggle.set_text(if on { "Stop Runner" } else { "Start Runner" });
                    }
                };
                { let refresh = refresh.clone(); std::thread::spawn(move || refresh()); }

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
                            "feedback" => show_feedback(app),
                            "run-now" => { let r = refresh.clone(); std::thread::spawn(move || { notify(&queue("w1w5", 5, 1, true)); r(); }); }
                            "tonight" => { let r = refresh.clone(); std::thread::spawn(move || { notify(&queue("w1w5", 5, 4, false)); r(); }); }
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
            if let WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close(); let _ = w.hide();
                let app = w.app_handle();
                let open = app.webview_windows().values().any(|o| o.label() != w.label() && o.is_visible().unwrap_or(false));
                if !open { in_dock(app, false); }
            }
        })
        .build(tauri::generate_context!())
        .expect("error building Astra")
        .run({
            let runner = runner.clone();
            move |_, e| if let tauri::RunEvent::Exit = e { runner.lock().unwrap().stop(); }
        });
}

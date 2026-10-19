//! Runs the bundled pipeline through the uv sidecar: `uv sync` installs Python and the locked
//! dependencies into the app data dir, and `uv run gs …` runs stages against the app's own data.
//! Output streams to the frontend as `pipeline://log` events; one process runs at a time.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};

use crate::secrets::{self, Secret};
use crate::{err, Dirs};

/// `gs` subcommands the frontend may start.
const COMMANDS: &[&str] =
    &["fetch", "homepage", "card", "gate", "summarize", "embed", "place", "layout", "name", "reassign", "export", "run"];

#[derive(Default)]
pub struct Pipeline {
    busy: AtomicBool,
    cancelled: AtomicBool,
    pid: Mutex<Option<u32>>,
}

/// Holds the one-run-at-a-time slot until dropped.
pub struct Slot<'a>(&'a Pipeline);

impl Drop for Slot<'_> {
    fn drop(&mut self) {
        *self.0.pid.lock().unwrap() = None;
        self.0.busy.store(false, Ordering::SeqCst);
    }
}

impl Pipeline {
    pub fn acquire(&self) -> Result<Slot<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "the pipeline is already running".to_owned())?;
        self.cancelled.store(false, Ordering::SeqCst);
        Ok(Slot(self))
    }

    pub fn running(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }
}

#[derive(Clone, Serialize)]
struct LogLine<'a> {
    stream: &'a str,
    line: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    /// The exit code of the last step that ran; `None` when it was killed by a signal.
    pub code: Option<i32>,
    pub cancelled: bool,
    /// Index of the step that failed, if one did.
    pub failed_step: Option<usize>,
}

/// The uv sidecar: Tauri copies `binaries/uv-<target>` next to the app's executable as `uv`.
fn uv_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(err)?;
    let dir = exe.parent().ok_or("the app executable has no directory")?;
    let uv = dir.join(if cfg!(windows) { "uv.exe" } else { "uv" });
    if uv.is_file() {
        Ok(uv)
    } else {
        Err(format!("the bundled uv is missing at {}", uv.display()))
    }
}

fn uv(dirs: &Dirs, args: &[String]) -> Result<Command, String> {
    for d in [dirs.data(), dirs.export(), dirs.venv(), dirs.uv_python(), dirs.uv_cache()] {
        std::fs::create_dir_all(&d).map_err(err)?;
    }
    let mut cmd = Command::new(uv_path()?);
    cmd.args(args)
        .env("GITSTARS_DATA", dirs.data())
        .env("GITSTARS_EXPORT", dirs.export())
        .env("GITSTARS_CONTRACT", dirs.contract())
        .env("UV_PROJECT_ENVIRONMENT", dirs.venv())
        .env("UV_PYTHON_INSTALL_DIR", dirs.uv_python())
        .env("UV_CACHE_DIR", dirs.uv_cache())
        .env("UV_PYTHON_PREFERENCE", "only-managed")
        .env("PYTHONUNBUFFERED", "1")
        .env("NO_COLOR", "1")
        .env("COLUMNS", "160")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for s in [Secret::Github, Secret::Openrouter] {
        if let Some(v) = secrets::get(s) {
            cmd.env(s.env(), v);
        }
    }
    #[cfg(unix)]
    cmd.process_group(0);
    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }
    Ok(cmd)
}

fn project_args(dirs: &Dirs) -> Vec<String> {
    vec!["--project".into(), dirs.pipeline().to_string_lossy().into_owned(), "--frozen".into(), "--no-dev".into()]
}

fn installed_marker(dirs: &Dirs) -> PathBuf {
    dirs.venv().join(".gitstars-uv.lock")
}

/// Installed means the environment was synced from exactly the bundled lockfile.
pub fn installed(dirs: &Dirs) -> bool {
    match (std::fs::read(installed_marker(dirs)), std::fs::read(dirs.pipeline().join("uv.lock"))) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Splits on `\r` too, so progress bars arrive as separate lines rather than one long one.
async fn pump(app: AppHandle, stream: &'static str, mut r: impl AsyncRead + Unpin) {
    let mut buf = [0u8; 8192];
    let mut line = Vec::new();
    let emit = |line: &mut Vec<u8>| {
        if !line.is_empty() {
            let text = String::from_utf8_lossy(line).trim_end().to_owned();
            line.clear();
            if !text.is_empty() {
                let _ = app.emit("pipeline://log", LogLine { stream, line: text });
            }
        }
    };
    loop {
        match r.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                for &b in &buf[..n] {
                    if b == b'\n' || b == b'\r' {
                        emit(&mut line);
                    } else {
                        line.push(b);
                    }
                }
            }
        }
    }
    emit(&mut line);
}

/// Runs one process to completion, streaming its output.
async fn run_streamed(app: &AppHandle, p: &Pipeline, mut cmd: Command) -> Result<Option<i32>, String> {
    let mut child: Child = cmd.spawn().map_err(err)?;
    *p.pid.lock().unwrap() = child.id();
    let out = tokio::spawn(pump(app.clone(), "stdout", child.stdout.take().unwrap()));
    let errs = tokio::spawn(pump(app.clone(), "stderr", child.stderr.take().unwrap()));
    let status = child.wait().await.map_err(err)?;
    let _ = tokio::join!(out, errs);
    *p.pid.lock().unwrap() = None;
    Ok(status.code())
}

fn note(app: &AppHandle, line: impl Into<String>) {
    let _ = app.emit("pipeline://log", LogLine { stream: "app", line: line.into() });
}

fn finish(app: &AppHandle, r: RunResult) -> RunResult {
    let _ = app.emit("pipeline://done", r.clone());
    r
}

/// `uv sync`: fetches Python 3.12 and the locked wheels (several GB with CUDA torch) on first use.
#[tauri::command]
pub async fn pipeline_setup(app: AppHandle, dirs: State<'_, Dirs>, p: State<'_, Pipeline>) -> Result<RunResult, String> {
    let _slot = p.acquire()?;
    let mut args = vec!["sync".to_owned()];
    args.extend(project_args(&dirs));
    note(&app, "Installing the pipeline runtime: Python 3.12 and the locked dependencies");
    let code = run_streamed(&app, &p, uv(&dirs, &args)?).await?;
    if code == Some(0) {
        std::fs::copy(dirs.pipeline().join("uv.lock"), installed_marker(&dirs)).map_err(err)?;
    }
    let cancelled = p.cancelled.load(Ordering::SeqCst);
    Ok(finish(&app, RunResult { code, cancelled, failed_step: (code != Some(0)).then_some(0) }))
}

/// Runs `gs <step…>` for each step in order and stops at the first failure.
#[tauri::command]
pub async fn pipeline_run(
    app: AppHandle,
    dirs: State<'_, Dirs>,
    p: State<'_, Pipeline>,
    steps: Vec<Vec<String>>,
) -> Result<RunResult, String> {
    if steps.is_empty() || steps.iter().any(|s| s.first().is_none_or(|c| !COMMANDS.contains(&c.as_str()))) {
        return Err(format!("each step must start with one of: {}", COMMANDS.join(", ")));
    }
    let _slot = p.acquire()?;
    let mut code = Some(0);
    for (i, step) in steps.iter().enumerate() {
        if p.cancelled.load(Ordering::SeqCst) {
            break;
        }
        note(&app, format!("$ gs {}", step.join(" ")));
        let mut args = vec!["run".to_owned()];
        args.extend(project_args(&dirs));
        args.push("gs".into());
        args.extend(step.iter().cloned());
        code = run_streamed(&app, &p, uv(&dirs, &args)?).await?;
        if code != Some(0) {
            let cancelled = p.cancelled.load(Ordering::SeqCst);
            return Ok(finish(&app, RunResult { code, cancelled, failed_step: Some(i) }));
        }
    }
    let cancelled = p.cancelled.load(Ordering::SeqCst);
    Ok(finish(&app, RunResult { code, cancelled, failed_step: None }))
}

/// `gs status --json`, captured rather than streamed.
#[tauri::command]
pub async fn pipeline_status(dirs: State<'_, Dirs>, p: State<'_, Pipeline>) -> Result<serde_json::Value, String> {
    let _slot = p.acquire()?;
    let mut args = vec!["run".to_owned()];
    args.extend(project_args(&dirs));
    args.extend(["gs".into(), "status".into(), "--json".into()]);
    let out = uv(&dirs, &args)?.output().await.map_err(err)?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned());
    }
    serde_json::from_slice(&out.stdout).map_err(err)
}

/// Stops the running process and everything it started (uv, Python, its workers).
#[tauri::command]
pub async fn pipeline_cancel(p: State<'_, Pipeline>) -> Result<(), String> {
    p.cancelled.store(true, Ordering::SeqCst);
    let Some(pid) = *p.pid.lock().unwrap() else { return Ok(()) };
    kill_tree(pid, false);
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    if *p.pid.lock().unwrap() == Some(pid) {
        kill_tree(pid, true);
    }
    Ok(())
}

#[cfg(unix)]
fn kill_tree(pid: u32, hard: bool) {
    // The child leads its own process group, so the negative pid reaches its descendants too.
    unsafe {
        libc::kill(-(pid as i32), if hard { libc::SIGKILL } else { libc::SIGTERM });
    }
}

#[cfg(windows)]
fn kill_tree(pid: u32, _hard: bool) {
    let _ = std::process::Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).status();
}

/// The first NVIDIA GPU's name and driver, or `None` without one; `embed` needs CUDA.
pub fn gpu() -> Option<String> {
    let out = std::process::Command::new("nvidia-smi").args(["--query-gpu=name,driver_version", "--format=csv,noheader"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next()?.trim();
    (out.status.success() && !first.is_empty()).then(|| first.to_owned())
}

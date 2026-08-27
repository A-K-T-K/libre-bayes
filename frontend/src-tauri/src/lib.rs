use std::fs::File;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::Manager;

struct BackendProcess(Mutex<Option<Child>>);

/// Set via `--debug` on the command line or the `LIBRE_BAYES_DEBUG` env var
/// (what `run-debug.bat`/`run-debug.sh` set) -- turns on verbose (Debug
/// level) logging and opens the webview devtools on startup, so a user who
/// hits a silent failure (e.g. the classic "inference request failed" with
/// no further detail in the UI) has somewhere to actually see why: the
/// browser console for frontend/network errors, `logs/app.log` and
/// `logs/backend.log` next to the executable for the Rust and Python sides.
fn debug_requested() -> bool {
    std::env::args().any(|a| a == "--debug") || std::env::var("LIBRE_BAYES_DEBUG").is_ok()
}

/// Where the FastAPI backend's source lives, resolved at *runtime* rather
/// than baked in at compile time -- a portable build gets copied to an
/// arbitrary location on an arbitrary machine, so `env!("CARGO_MANIFEST_DIR")`
/// (an absolute path fixed at the moment this binary was compiled) would
/// silently point back at the original build machine's checkout and never
/// resolve there. Two layouts are supported:
///
/// 1. **Portable/release**: a `backend/` folder sitting right next to the
///    executable -- this is what `scripts/make_portable.*` assembles.
/// 2. **Dev tree**: `src-tauri/../../backend`, relative to this crate's own
///    manifest -- used only as a fallback when no sibling `backend/` exists,
///    which is the case for `cargo run` / `tauri dev` inside the repo.
fn backend_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let sibling = exe_dir.join("backend");
            if sibling.join("main.py").is_file() {
                return sibling;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("backend")
}

/// `logs/` next to the executable (falling back to next to `backend_dir()`
/// for a dev tree, where there's no meaningful "next to the executable" --
/// that'd be buried in `target/debug/`). Created on demand.
fn log_dir() -> PathBuf {
    let dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("logs")))
        .unwrap_or_else(|| backend_dir().join("logs"));
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// The Python interpreter to run the backend with. Three layouts, tried in
/// order:
///
/// 1. **Fully self-contained portable build**: `python-runtime/` sitting
///    next to the executable, a complete interpreter + every backend
///    dependency already installed (see `scripts/bundle_python_runtime.py`)
///    -- this is what actually makes a portable build "portable": nothing
///    needs to be installed or downloaded on the machine it's run on.
/// 2. **Dev checkout that's run `python run.py` before**: a virtualenv at
///    `backend_dir/.venv`, the same one `scripts/*.{sh,bat,py}` create.
/// 3. Whatever bare `python`/`python3` happens to be on PATH -- a dev
///    checkout that hasn't set anything up yet.
fn python_command(exe_dir: &std::path::Path, backend_dir: &std::path::Path) -> Command {
    let bundled_python = if cfg!(windows) {
        exe_dir.join("python-runtime").join("python.exe")
    } else {
        exe_dir.join("python-runtime").join("bin").join("python3")
    };
    if bundled_python.is_file() {
        return Command::new(bundled_python);
    }

    let venv_python = if cfg!(windows) {
        backend_dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        backend_dir.join(".venv").join("bin").join("python")
    };
    if venv_python.is_file() {
        return Command::new(venv_python);
    }

    Command::new(if cfg!(windows) { "python" } else { "python3" })
}

/// Spawns the FastAPI backend with its stdout/stderr captured to
/// `logs/backend.log` rather than left to `Stdio::inherit()`'s default --
/// a release build has no console window at all (`windows_subsystem =
/// "windows"`), so inherited output was previously just discarded with no
/// way to see e.g. a missing-dependency traceback that kills the backend
/// on startup and leaves the frontend's every request failing with a
/// generic "inference request failed".
fn spawn_backend() -> std::io::Result<Child> {
    let dir = backend_dir();
    log::info!("spawning FastAPI backend in {:?}", dir);

    let log_path = log_dir().join("backend.log");
    let stdout_file = File::create(&log_path)?;
    let stderr_file = stdout_file.try_clone()?;

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| dir.clone());

    python_command(&exe_dir, &dir)
        .args(["-m", "uvicorn", "main:app", "--port", "8000"])
        .current_dir(dir)
        // Without this, Python block-buffers stdout/stderr once they're not
        // a tty (i.e. always, here) -- backend.log would stay empty until
        // the buffer filled or the process exited, defeating its purpose
        // as a live diagnostic during exactly the startup window it exists
        // to cover.
        .env("PYTHONUNBUFFERED", "1")
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let debug = debug_requested();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .setup(move |app| {
            // Logging is always on (not just in dev builds) so a portable
            // release build is diagnosable without a rebuild -- it just
            // goes to logs/app.log next to the executable instead of a
            // console when this is a windowed release binary.
            let level = if debug { log::LevelFilter::Debug } else { log::LevelFilter::Info };
            let mut log_builder = tauri_plugin_log::Builder::default().level(level).target(
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                    path: log_dir(),
                    file_name: Some("app".into()),
                }),
            );
            if cfg!(debug_assertions) {
                log_builder = log_builder.target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout));
            }
            app.handle().plugin(log_builder.build())?;

            if debug {
                log::info!("debug mode requested (--debug / LIBRE_BAYES_DEBUG) -- opening devtools");
            }

            match spawn_backend() {
                Ok(child) => {
                    app.manage(BackendProcess(Mutex::new(Some(child))));
                }
                Err(err) => {
                    log::error!("failed to start backend: {err}. Start it manually with `uvicorn main:app --port 8000` inside backend/.");
                }
            }

            if debug {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<BackendProcess>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

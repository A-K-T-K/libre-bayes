use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::Manager;

struct BackendProcess(Mutex<Option<Child>>);

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

/// The Python interpreter to run the backend with -- prefers a virtualenv
/// inside `backend_dir` (`.venv`, the same one `scripts/*.{sh,bat,py}`
/// create) over whatever bare `python`/`python3` happens to be on PATH, so
/// the backend's actual dependencies (pgmpy, fastapi, ...) are guaranteed
/// present rather than hoping the system interpreter happens to have them.
fn python_command(backend_dir: &std::path::Path) -> Command {
    let venv_python = if cfg!(windows) {
        backend_dir.join(".venv").join("Scripts").join("python.exe")
    } else {
        backend_dir.join(".venv").join("bin").join("python")
    };
    if venv_python.is_file() {
        return Command::new(venv_python);
    }
    // No local venv (e.g. a dev checkout that hasn't run the setup scripts
    // yet) -- fall back to whatever's on PATH, preferring `python3` since
    // that's unambiguous on macOS/Linux; Windows only ever ships `python`.
    Command::new(if cfg!(windows) { "python" } else { "python3" })
}

fn spawn_backend() -> std::io::Result<Child> {
    let dir = backend_dir();
    log::info!("spawning FastAPI backend in {:?}", dir);
    python_command(&dir)
        .args(["-m", "uvicorn", "main:app", "--port", "8000"])
        .current_dir(dir)
        .spawn()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            match spawn_backend() {
                Ok(child) => {
                    app.manage(BackendProcess(Mutex::new(Some(child))));
                }
                Err(err) => {
                    log::error!("failed to start backend: {err}. Start it manually with `uvicorn main:app --port 8000` inside backend/.");
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

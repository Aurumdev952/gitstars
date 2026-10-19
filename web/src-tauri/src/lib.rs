mod data;
mod model;
mod pipeline;
mod protocol;
mod secrets;

use std::path::{Path, PathBuf};

use tauri::Manager;

/// Every path the app reads or writes. One root under the OS app data dir holds the pipeline's
/// database, its export, the downloaded search model and the Python environment; the bundled
/// resources hold the pipeline source, the contract and the export the app ships with.
#[derive(Clone)]
pub struct Dirs {
    pub root: PathBuf,
    pub res: PathBuf,
}

impl Dirs {
    /// `GITSTARS_DATA` for the pipeline: the directory holding `gitstars.db`.
    pub fn data(&self) -> PathBuf {
        self.root.join("data")
    }
    pub fn db(&self) -> PathBuf {
        self.data().join("gitstars.db")
    }
    /// `GITSTARS_EXPORT`: what `gs://localhost/data/*` serves ahead of the bundled export.
    pub fn export(&self) -> PathBuf {
        self.root.join("export")
    }
    pub fn export_prev(&self) -> PathBuf {
        self.root.join("export.prev")
    }
    pub fn backups(&self) -> PathBuf {
        self.root.join("backups")
    }
    pub fn models(&self) -> PathBuf {
        self.root.join("models")
    }
    pub fn venv(&self) -> PathBuf {
        self.root.join("venv")
    }
    pub fn uv_python(&self) -> PathBuf {
        self.root.join("uv").join("python")
    }
    pub fn uv_cache(&self) -> PathBuf {
        self.root.join("uv").join("cache")
    }
    pub fn pipeline(&self) -> PathBuf {
        self.res.join("pipeline")
    }
    pub fn contract(&self) -> PathBuf {
        self.res.join("contract").join("galaxy.schema.json")
    }
}

/// Windows resource paths come back verbatim (`\\?\C:\…`), which Python and uv do not all accept.
fn plain(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => path,
    }
}

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Copies through a sibling temp file and a rename, so a reader never sees half a file.
pub fn copy_atomic(src: &Path, dest: &Path) -> std::io::Result<()> {
    let tmp = dest.with_extension("tmp-copy");
    std::fs::copy(src, &tmp)?;
    std::fs::rename(&tmp, dest)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol("gs", |ctx, request, responder| {
            let dirs = ctx.app_handle().state::<Dirs>().inner().clone();
            tauri::async_runtime::spawn_blocking(move || responder.respond(protocol::serve(&dirs, &request)));
        })
        .setup(|app| {
            let root = plain(app.path().app_data_dir()?);
            let res = plain(app.path().resource_dir()?);
            std::fs::create_dir_all(&root)?;
            app.manage(Dirs { root, res });
            app.manage(pipeline::Pipeline::default());
            app.manage(model::ModelLock::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            data::app_state,
            data::import_existing,
            data::check_new_stars,
            data::backup_snapshot,
            data::restore_previous,
            pipeline::pipeline_setup,
            pipeline::pipeline_run,
            pipeline::pipeline_cancel,
            pipeline::pipeline_status,
            model::model_fetch,
            secrets::secret_set,
            secrets::secret_has,
        ])
        .run(tauri::generate_context!())
        .expect("error while running gitstars");
}

//! The app's own copy of the pipeline data: importing an existing checkout's database without
//! touching it, snapshots before a run that changes the layout, and the check for new stars.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{backup::Backup, Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::pipeline::{self, Pipeline};
use crate::secrets::{self, Secret};
use crate::{copy_atomic, err, Dirs};

const EXPORT_FILES: [&str; 2] = ["galaxy.json", "vectors.f16.bin"];
const KEEP_BACKUPS: usize = 3;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    root: String,
    has_db: bool,
    has_export: bool,
    has_previous: bool,
    installed: bool,
    gpu: Option<String>,
    has_github_token: bool,
    has_openrouter_key: bool,
    running: bool,
    /// Where the import dialog opens: `GITSTARS_DATA`, or the dev checkout's `data/` in a debug build.
    import_default: Option<String>,
}

fn import_default() -> Option<PathBuf> {
    let env = std::env::var_os("GITSTARS_DATA").map(PathBuf::from);
    #[cfg(debug_assertions)]
    let dev = Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("data"));
    #[cfg(not(debug_assertions))]
    let dev: Option<PathBuf> = None;
    [env, dev].into_iter().flatten().find(|d| d.join("gitstars.db").is_file()).map(|d| d.canonicalize().unwrap_or(d))
}

#[tauri::command]
pub async fn app_state(dirs: State<'_, Dirs>, p: State<'_, Pipeline>) -> Result<AppState, String> {
    let d = dirs.inner().clone();
    let running = p.running();
    tauri::async_runtime::spawn_blocking(move || AppState {
        root: d.root.to_string_lossy().into_owned(),
        has_db: d.db().is_file(),
        has_export: d.export().join("galaxy.json").is_file(),
        has_previous: d.export_prev().join("galaxy.json").is_file(),
        installed: pipeline::installed(&d),
        gpu: pipeline::gpu(),
        has_github_token: secrets::get(Secret::Github).is_some(),
        has_openrouter_key: secrets::get(Secret::Openrouter).is_some(),
        running,
        import_default: import_default().map(|p| p.to_string_lossy().into_owned()),
    })
    .await
    .map_err(err)
}

/// SQLite's online backup: a consistent copy even while another connection writes, and the
/// source is opened read-only. Writes to a temp file first so a failed copy leaves nothing behind.
fn backup_db(src: &Path, dest: &Path) -> Result<(), String> {
    let from = Connection::open_with_flags(src, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("cannot open {} read-only: {e}", src.display()))?;
    let tmp = dest.with_extension("db.tmp");
    let _ = std::fs::remove_file(&tmp);
    {
        let mut to = Connection::open(&tmp).map_err(err)?;
        Backup::new(&from, &mut to).map_err(err)?.run_to_completion(1024, std::time::Duration::ZERO, None).map_err(err)?;
    }
    std::fs::rename(&tmp, dest).map_err(err)
}

/// Restores `src` into the live database through a connection, so its WAL stays consistent.
fn restore_db(src: &Path, live: &Path) -> Result<(), String> {
    let from = Connection::open_with_flags(src, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
    let mut to = Connection::open(live).map_err(err)?;
    let backup = Backup::new(&from, &mut to).map_err(err)?;
    backup.run_to_completion(1024, std::time::Duration::ZERO, None).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    db: String,
    repos: i64,
    export_from: Option<String>,
}

/// Copies an existing checkout's `gitstars.db`, and its export when it sits at the checkout's
/// `web/public/data/`, into the app data dir. The source is only ever read.
#[tauri::command]
pub async fn import_existing(dirs: State<'_, Dirs>, p: State<'_, Pipeline>, source_dir: String) -> Result<ImportReport, String> {
    let _slot = p.acquire()?;
    let d = dirs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(&source_dir);
        let (data_dir, src_db) = if source.is_file() {
            (source.parent().map(Path::to_path_buf).unwrap_or_default(), source.clone())
        } else {
            (source.clone(), source.join("gitstars.db"))
        };
        if !src_db.is_file() {
            return Err(format!("no gitstars.db in {}", data_dir.display()));
        }
        if d.db().exists() {
            return Err(format!("{} already exists; the app imports only into an empty data dir", d.db().display()));
        }
        std::fs::create_dir_all(d.data()).map_err(err)?;
        backup_db(&src_db, &d.db())?;
        let repos: i64 = Connection::open_with_flags(d.db(), OpenFlags::SQLITE_OPEN_READ_ONLY)
            .and_then(|c| c.query_row("SELECT COUNT(*) FROM repos WHERE active = 1", [], |r| r.get(0)))
            .map_err(err)?;

        let candidates = [data_dir.join("..").join("web").join("public").join("data"), data_dir.join("export")];
        let export_from = candidates.into_iter().find(|c| EXPORT_FILES.iter().all(|f| c.join(f).is_file()));
        if let Some(from) = &export_from {
            std::fs::create_dir_all(d.export()).map_err(err)?;
            for f in EXPORT_FILES {
                copy_atomic(&from.join(f), &d.export().join(f)).map_err(err)?;
            }
        }
        Ok(ImportReport {
            db: d.db().to_string_lossy().into_owned(),
            repos,
            export_from: export_from.map(|p| p.canonicalize().unwrap_or(p).to_string_lossy().into_owned()),
        })
    })
    .await
    .map_err(err)?
}

fn copy_dir(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            std::fs::copy(entry.path(), dest.join(entry.file_name()))?;
        }
    }
    Ok(())
}

/// Before a run that changes the galaxy: the database to `backups/` (the newest three are kept)
/// and the export to `export.prev/`.
#[tauri::command]
pub async fn backup_snapshot(dirs: State<'_, Dirs>, p: State<'_, Pipeline>) -> Result<(), String> {
    let _slot = p.acquire()?;
    let d = dirs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if d.db().is_file() {
            std::fs::create_dir_all(d.backups()).map_err(err)?;
            let ts = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_secs();
            backup_db(&d.db(), &d.backups().join(format!("gitstars-{ts}.db")))?;
            let mut all = backups(&d)?;
            while all.len() > KEEP_BACKUPS {
                std::fs::remove_file(all.remove(0)).map_err(err)?;
            }
        }
        if d.export().join("galaxy.json").is_file() {
            let tmp = d.root.join("export.prev.tmp");
            let _ = std::fs::remove_dir_all(&tmp);
            copy_dir(&d.export(), &tmp).map_err(err)?;
            let _ = std::fs::remove_dir_all(d.export_prev());
            std::fs::rename(&tmp, d.export_prev()).map_err(err)?;
        }
        Ok(())
    })
    .await
    .map_err(err)?
}

/// Oldest first.
fn backups(d: &Dirs) -> Result<Vec<PathBuf>, String> {
    let mut v: Vec<(u64, PathBuf)> = std::fs::read_dir(d.backups())
        .map_err(err)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter_map(|p| {
            let ts = p.file_name()?.to_str()?.strip_prefix("gitstars-")?.strip_suffix(".db")?.parse().ok()?;
            Some((ts, p))
        })
        .collect();
    v.sort();
    Ok(v.into_iter().map(|(_, p)| p).collect())
}

/// Puts back the last snapshot: the newest database backup and `export.prev/`.
#[tauri::command]
pub async fn restore_previous(dirs: State<'_, Dirs>, p: State<'_, Pipeline>) -> Result<(), String> {
    let _slot = p.acquire()?;
    let d = dirs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !d.export_prev().join("galaxy.json").is_file() {
            return Err("there is no previous export to restore".to_owned());
        }
        if let Some(newest) = backups(&d).unwrap_or_default().pop() {
            restore_db(&newest, &d.db())?;
        }
        let old = d.root.join("export.old");
        let _ = std::fs::remove_dir_all(&old);
        if d.export().exists() {
            std::fs::rename(d.export(), &old).map_err(err)?;
        }
        std::fs::rename(d.export_prev(), d.export()).map_err(err)?;
        let _ = std::fs::remove_dir_all(&old);
        Ok(())
    })
    .await
    .map_err(err)?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewStars {
    /// Stars newer than anything in the database, among the 20 most recent.
    count: usize,
    /// All 20 of the most recent stars are new, so there may be more.
    more: bool,
    names: Vec<String>,
    total_starred: i64,
    in_galaxy: i64,
}

const NEW_STARS_QUERY: &str = "query { viewer { login starredRepositories(first: 20, orderBy: {field: STARRED_AT, direction: DESC}) { totalCount edges { starredAt node { nameWithOwner owner { login } } } } } }";

/// One GraphQL call for the 20 newest stars, compared read-only against the database. Repos the
/// viewer owns are skipped, as `gs fetch` skips them.
#[tauri::command]
pub async fn check_new_stars(dirs: State<'_, Dirs>) -> Result<Option<NewStars>, String> {
    let d = dirs.inner().clone();
    let Some(token) = tauri::async_runtime::spawn_blocking(|| secrets::get(Secret::Github)).await.map_err(err)? else {
        return Ok(None);
    };
    if !d.db().is_file() {
        return Ok(None);
    }
    let body: serde_json::Value = reqwest::Client::new()
        .post("https://api.github.com/graphql")
        .bearer_auth(token)
        .header(reqwest::header::USER_AGENT, "gitstars-desktop")
        .json(&serde_json::json!({ "query": NEW_STARS_QUERY }))
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(err)?
        .json()
        .await
        .map_err(err)?;
    if let Some(errors) = body.get("errors") {
        return Err(format!("GitHub returned {errors}"));
    }
    let viewer = &body["data"]["viewer"];
    let login = viewer["login"].as_str().unwrap_or_default().to_owned();
    let total_starred = viewer["starredRepositories"]["totalCount"].as_i64().unwrap_or(0);
    let recent: Vec<String> = viewer["starredRepositories"]["edges"]
        .as_array()
        .map(|edges| {
            edges
                .iter()
                .filter(|e| !e["node"]["owner"]["login"].as_str().unwrap_or_default().eq_ignore_ascii_case(&login))
                .filter_map(|e| e["node"]["nameWithOwner"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let window = viewer["starredRepositories"]["edges"].as_array().map_or(0, Vec::len);

    tauri::async_runtime::spawn_blocking(move || {
        let db = Connection::open_with_flags(d.db(), OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
        let in_galaxy: i64 = db.query_row("SELECT COUNT(*) FROM repos WHERE active = 1", [], |r| r.get(0)).map_err(err)?;
        let mut known = db.prepare("SELECT 1 FROM repos WHERE full_name = ?1 COLLATE NOCASE AND active = 1").map_err(err)?;
        let mut names = Vec::new();
        for name in recent {
            if known.query_row([&name], |_| Ok(())).optional().map_err(err)?.is_none() {
                names.push(name);
            }
        }
        Ok(Some(NewStars { count: names.len(), more: window > 0 && names.len() == window, names, total_starred, in_galaxy }))
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_copies_rows_and_leaves_the_source_alone() {
        let tmp = std::env::temp_dir().join(format!("gs-data-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("src.db");
        {
            let c = Connection::open(&src).unwrap();
            c.execute_batch(
                "PRAGMA journal_mode=WAL; CREATE TABLE repos (full_name TEXT, active INTEGER); INSERT INTO repos VALUES ('a/b', 1);",
            )
            .unwrap();
        }
        let before = std::fs::read(&src).unwrap();
        let mtime = std::fs::metadata(&src).unwrap().modified().unwrap();
        let dest = tmp.join("dest.db");
        backup_db(&src, &dest).unwrap();
        let n: i64 = Connection::open(&dest).unwrap().query_row("SELECT COUNT(*) FROM repos", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        assert_eq!(std::fs::read(&src).unwrap(), before);
        assert_eq!(std::fs::metadata(&src).unwrap().modified().unwrap(), mtime);
        std::fs::remove_dir_all(&tmp).unwrap();
    }
}

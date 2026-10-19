//! Downloads the browser search model into `models/`, where `gs://localhost/models/` serves it.
//! A port of the download loop in `web/scripts/fetch-model.ts`: sizes from the Hub's tree API,
//! resumable `.part` files, and `config.json` last, since the search worker reads a present
//! `config.json` as "every file is here".

use std::collections::HashMap;
use std::path::Path;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;

use crate::{err, Dirs};

/// One download at a time; a second caller waits and then finds the files present.
#[derive(Default)]
pub struct ModelLock(tokio::sync::Mutex<()>);

#[derive(Clone, Serialize)]
struct Progress<'a> {
    file: &'a str,
    loaded: u64,
    total: u64,
}

const EMIT_EVERY: u64 = 4 << 20;

fn safe_rel(p: &str) -> bool {
    !p.is_empty() && !p.starts_with('/') && p.split('/').all(|s| !s.is_empty() && s != "." && s != ".." && !s.contains(['\\', ':']))
}

fn size_of(p: &Path) -> Option<u64> {
    std::fs::metadata(p).ok().map(|m| m.len())
}

async fn remote_sizes(client: &reqwest::Client, model: &str) -> Result<HashMap<String, u64>, String> {
    #[derive(serde::Deserialize)]
    struct Entry {
        #[serde(rename = "type")]
        kind: String,
        path: String,
        #[serde(default)]
        size: u64,
    }
    let url = format!("https://huggingface.co/api/models/{model}/tree/main?recursive=true");
    let res = client.get(&url).send().await.map_err(err)?;
    if !res.status().is_success() {
        return Err(format!("listing {model} returned {}", res.status()));
    }
    let entries: Vec<Entry> = res.json().await.map_err(err)?;
    Ok(entries.into_iter().filter(|e| e.kind == "file").map(|e| (e.path, e.size)).collect())
}

/// The requested files plus their external-data siblings (`model.onnx_data`, `model.onnx_data_1`, …),
/// with `config.json` moved to the end.
fn plan(requested: &[String], sizes: &HashMap<String, u64>) -> Result<Vec<(String, u64)>, String> {
    let mut files: Vec<String> = Vec::new();
    for f in requested {
        if !sizes.contains_key(f) {
            return Err(format!("the model has no {f}"));
        }
        files.push(f.clone());
        let mut data: Vec<&String> = sizes.keys().filter(|k| k.starts_with(&format!("{f}_data"))).collect();
        data.sort();
        files.extend(data.into_iter().cloned());
    }
    files.dedup();
    files.sort_by_key(|f| f == "config.json");
    Ok(files
        .into_iter()
        .map(|f| {
            let s = sizes[&f];
            (f, s)
        })
        .collect())
}

/// `on_bytes` gets the bytes of this file on disk so far.
async fn download(client: &reqwest::Client, url: &str, dest: &Path, size: u64, on_bytes: impl Fn(u64)) -> Result<(), String> {
    let part = dest.with_file_name(format!("{}.part", dest.file_name().unwrap().to_string_lossy()));
    if size_of(&part).is_some_and(|s| s > size) {
        tokio::fs::remove_file(&part).await.map_err(err)?;
    }
    let mut have = size_of(&part).unwrap_or(0);
    if have < size {
        let mut req = client.get(url);
        if have > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let res = req.send().await.map_err(err)?;
        if !res.status().is_success() {
            return Err(format!("{url} returned {}", res.status()));
        }
        // A server that ignores Range answers 200 with the whole file, so the part file starts over.
        if res.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            have = 0;
        }
        let mut out =
            tokio::fs::OpenOptions::new().create(true).write(true).append(have > 0).truncate(have == 0).open(&part).await.map_err(err)?;
        let mut stream = res.bytes_stream();
        let mut shown = have;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(err)?;
            out.write_all(&chunk).await.map_err(err)?;
            have += chunk.len() as u64;
            if have - shown >= EMIT_EVERY || have == size {
                shown = have;
                on_bytes(have);
            }
        }
        out.flush().await.map_err(err)?;
    }
    let got = size_of(&part).unwrap_or(0);
    if got != size {
        return Err(format!("{} is {got} bytes, expected {size}; retry to resume", dest.display()));
    }
    tokio::fs::rename(&part, dest).await.map_err(err)
}

/// Fetches `files` of the Hub model `model` (paths as transformers.js resolves them) and returns
/// the bytes now on disk.
#[tauri::command]
pub async fn model_fetch(
    app: AppHandle,
    dirs: State<'_, Dirs>,
    lock: State<'_, ModelLock>,
    model: String,
    files: Vec<String>,
) -> Result<u64, String> {
    let _guard = lock.0.lock().await;
    let mut parts = model.split('/');
    let valid_id = matches!((parts.next(), parts.next(), parts.next()), (Some(a), Some(b), None) if safe_rel(a) && safe_rel(b));
    if !valid_id || files.iter().any(|f| !safe_rel(f)) {
        return Err("invalid model id or file path".into());
    }
    let dir = dirs.models().join(&model);
    let client = reqwest::Client::builder().user_agent("gitstars-desktop").build().map_err(err)?;
    let todo = plan(&files, &remote_sizes(&client, &model).await?)?;
    let total: u64 = todo.iter().map(|(_, s)| s).sum();

    let config = dir.join("config.json");
    if todo.iter().any(|(f, s)| size_of(&dir.join(f)) != Some(*s)) && config.exists() {
        tokio::fs::remove_file(&config).await.map_err(err)?;
    }
    let mut done = 0;
    for (file, size) in &todo {
        let dest = dir.join(file);
        tokio::fs::create_dir_all(dest.parent().unwrap()).await.map_err(err)?;
        if size_of(&dest) != Some(*size) {
            let url = format!("https://huggingface.co/{model}/resolve/main/{file}");
            let emit = |have| {
                let _ = app.emit("model://progress", Progress { file, loaded: done + have, total });
            };
            download(&client, &url, &dest, *size, emit).await?;
        }
        done += size;
        let _ = app.emit("model://progress", Progress { file, loaded: done, total });
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_adds_external_data_and_puts_config_last() {
        let sizes: HashMap<String, u64> = [
            ("config.json", 1),
            ("tokenizer.json", 2),
            ("onnx/model_fp16.onnx", 3),
            ("onnx/model_fp16.onnx_data", 4),
            ("onnx/model.onnx", 5),
            ("onnx/model.onnx_data", 6),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v))
        .collect();
        let req = ["config.json", "tokenizer.json", "onnx/model_fp16.onnx"].map(String::from);
        let got: Vec<String> = plan(&req, &sizes).unwrap().into_iter().map(|(f, _)| f).collect();
        assert_eq!(got, ["tokenizer.json", "onnx/model_fp16.onnx", "onnx/model_fp16.onnx_data", "config.json"]);
        assert!(plan(&["missing.json".to_owned()], &sizes).is_err());
        assert!(!safe_rel("../x") && !safe_rel("a//b") && safe_rel("onnx/model.onnx"));
    }
}

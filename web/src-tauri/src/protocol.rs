//! `gs://localhost/{data,models}/…`: the pipeline's export and the search model, read from the app
//! data dir first and the bundled resources second, with Range support for the model weights.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use tauri::http::{header, Method, Request, Response, StatusCode};

use crate::Dirs;

pub fn serve(dirs: &Dirs, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // The page (tauri://localhost, or http://tauri.localhost on Windows) is another origin than
    // gs://, so fetches from it and from the search worker are CORS requests.
    let base = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Length, Content-Range, Accept-Ranges")
        .header("Cross-Origin-Resource-Policy", "same-origin");
    if request.method() == Method::OPTIONS {
        return base
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
            .body(Vec::new())
            .unwrap();
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return status(base, StatusCode::METHOD_NOT_ALLOWED);
    }
    let Some(path) = resolve(dirs, request.uri().path()) else {
        return status(base, StatusCode::NOT_FOUND);
    };
    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).map(str::to_owned);
    match read(&path, range.as_deref(), request.method() == Method::HEAD) {
        Ok(Body { status: code, bytes, total, start, len }) => {
            let mut b = base
                .status(code)
                .header(header::CONTENT_TYPE, content_type(&path))
                .header(header::ACCEPT_RANGES, "bytes")
                // A new export replaces galaxy.json in place; the next load must not see the old one.
                .header(header::CACHE_CONTROL, "no-cache");
            if code == StatusCode::PARTIAL_CONTENT {
                b = b
                    .header(header::CONTENT_RANGE, format!("bytes {}-{}/{}", start, start + len - 1, total))
                    .header(header::CONTENT_LENGTH, len);
            } else {
                b = b.header(header::CONTENT_LENGTH, total);
            }
            b.body(bytes).unwrap()
        }
        Err(ReadError::Unsatisfiable(total)) => base
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{total}"))
            .body(Vec::new())
            .unwrap(),
        Err(ReadError::Io) => status(base, StatusCode::INTERNAL_SERVER_ERROR),
    }
}

fn status(b: tauri::http::response::Builder, code: StatusCode) -> Response<Vec<u8>> {
    b.status(code).body(Vec::new()).unwrap()
}

/// Maps a URL path to a file: `/data/*` to `export/` then the bundled `data/`, `/models/*` to
/// `models/` then the bundled `models/`. Anything that could step outside those roots is refused.
pub fn resolve(dirs: &Dirs, url_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(url_path)?;
    let mut parts = decoded.trim_start_matches('/').split('/');
    let (own, bundled) = match parts.next()? {
        "data" => (dirs.export(), dirs.res.join("data")),
        "models" => (dirs.models(), dirs.res.join("models")),
        _ => return None,
    };
    let rest: Vec<&str> = parts.collect();
    if rest.is_empty() || rest.iter().any(|s| !safe_segment(s)) {
        return None;
    }
    [own, bundled].into_iter().map(|root| rest.iter().fold(root, |p, s| p.join(s))).find(|p| p.is_file())
}

fn safe_segment(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.contains(['\\', ':', '\0']) && !s.ends_with(".part")
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "json" => "application/json",
        "wasm" => "application/wasm",
        "mjs" | "js" => "text/javascript",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

struct Body {
    status: StatusCode,
    bytes: Vec<u8>,
    total: u64,
    start: u64,
    len: u64,
}

enum ReadError {
    Unsatisfiable(u64),
    Io,
}

impl From<std::io::Error> for ReadError {
    fn from(_: std::io::Error) -> Self {
        ReadError::Io
    }
}

fn read(path: &Path, range: Option<&str>, head: bool) -> Result<Body, ReadError> {
    let mut file = File::open(path)?;
    let total = file.metadata()?.len();
    let (status, start, len) = match range.map(|r| parse_range(r, total)) {
        None | Some(RangeSpec::Ignore) => (StatusCode::OK, 0, total),
        Some(RangeSpec::Unsatisfiable) => return Err(ReadError::Unsatisfiable(total)),
        Some(RangeSpec::Bytes(start, end)) => (StatusCode::PARTIAL_CONTENT, start, end - start + 1),
    };
    let mut bytes = Vec::new();
    if !head {
        bytes.reserve_exact(len as usize);
        file.seek(SeekFrom::Start(start))?;
        file.take(len).read_to_end(&mut bytes)?;
    }
    Ok(Body { status, bytes, total, start, len })
}

#[derive(Debug, PartialEq)]
enum RangeSpec {
    /// Inclusive byte range.
    Bytes(u64, u64),
    Unsatisfiable,
    /// Multiple ranges or a malformed header: answer with the whole file, as RFC 9110 allows.
    Ignore,
}

fn parse_range(header: &str, total: u64) -> RangeSpec {
    let Some(spec) = header.trim().strip_prefix("bytes=") else { return RangeSpec::Ignore };
    if spec.contains(',') {
        return RangeSpec::Ignore;
    }
    let Some((a, b)) = spec.split_once('-') else { return RangeSpec::Ignore };
    let (a, b) = (a.trim(), b.trim());
    let parsed = match (a.is_empty(), b.is_empty()) {
        (true, true) => return RangeSpec::Ignore,
        // A suffix: the last b bytes.
        (true, false) => match b.parse::<u64>() {
            Ok(0) => return RangeSpec::Unsatisfiable,
            Ok(n) => (total.saturating_sub(n), total.saturating_sub(1)),
            Err(_) => return RangeSpec::Ignore,
        },
        (false, _) => {
            let Ok(start) = a.parse::<u64>() else { return RangeSpec::Ignore };
            let end = if b.is_empty() {
                total.saturating_sub(1)
            } else {
                match b.parse::<u64>() {
                    Ok(e) if e >= start => e.min(total.saturating_sub(1)),
                    _ => return RangeSpec::Ignore,
                }
            };
            (start, end)
        }
    };
    if total == 0 || parsed.0 >= total {
        return RangeSpec::Unsatisfiable;
    }
    RangeSpec::Bytes(parsed.0, parsed.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs(tmp: &Path) -> Dirs {
        Dirs { root: tmp.join("root"), res: tmp.join("res") }
    }

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-0", 10), RangeSpec::Bytes(0, 0));
        assert_eq!(parse_range("bytes=4-", 10), RangeSpec::Bytes(4, 9));
        assert_eq!(parse_range("bytes=4-100", 10), RangeSpec::Bytes(4, 9));
        assert_eq!(parse_range("bytes=-3", 10), RangeSpec::Bytes(7, 9));
        assert_eq!(parse_range("bytes=10-", 10), RangeSpec::Unsatisfiable);
        assert_eq!(parse_range("bytes=0-1,4-5", 10), RangeSpec::Ignore);
        assert_eq!(parse_range("items=0-1", 10), RangeSpec::Ignore);
    }

    #[test]
    fn app_data_wins_and_traversal_is_refused() {
        let tmp = std::env::temp_dir().join(format!("gs-protocol-{}", std::process::id()));
        let d = dirs(&tmp);
        std::fs::create_dir_all(d.export()).unwrap();
        std::fs::create_dir_all(d.res.join("data")).unwrap();
        std::fs::create_dir_all(d.res.join("models/ort")).unwrap();
        std::fs::write(d.export().join("galaxy.json"), "{}").unwrap();
        std::fs::write(d.res.join("data/galaxy.json"), "[]").unwrap();
        std::fs::write(d.res.join("models/ort/a.wasm"), "w").unwrap();
        std::fs::write(tmp.join("secret"), "s").unwrap();

        assert_eq!(resolve(&d, "/data/galaxy.json"), Some(d.export().join("galaxy.json")));
        assert_eq!(resolve(&d, "/models/ort/a.wasm"), Some(d.res.join("models/ort/a.wasm")));
        assert_eq!(resolve(&d, "/data/../../secret"), None);
        assert_eq!(resolve(&d, "/data/%2e%2e/%2e%2e/secret"), None);
        assert_eq!(resolve(&d, "/data/..%5c..%5csecret"), None);
        assert_eq!(resolve(&d, "/other/galaxy.json"), None);
        assert_eq!(resolve(&d, "/data/"), None);
        std::fs::remove_dir_all(&tmp).unwrap();
    }
}

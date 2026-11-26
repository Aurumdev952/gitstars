//! The GitHub token and OpenRouter key live in the OS keychain. The frontend can store, replace or
//! clear one and ask whether it is set; it never reads a value back.

use crate::err;

const SERVICE: &str = "dev.gitstars.app";

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Secret {
    Github,
    Openrouter,
}

impl Secret {
    /// The keychain account name, which is also the environment variable the pipeline reads.
    pub fn env(self) -> &'static str {
        match self {
            Secret::Github => "GITHUB_TOKEN",
            Secret::Openrouter => "OPENROUTER_API_KEY",
        }
    }
}

fn entry(s: Secret) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, s.env()).map_err(err)
}

/// The stored value, else the variable from the app's own environment. Rust-side only.
pub fn get(s: Secret) -> Option<String> {
    let stored = entry(s).ok().and_then(|e| e.get_password().ok());
    stored.or_else(|| std::env::var(s.env()).ok()).map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

/// An empty value clears the entry.
#[tauri::command]
pub async fn secret_set(name: Secret, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let e = entry(name)?;
        let value = value.trim();
        if value.is_empty() {
            match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(x) => Err(err(x)),
            }
        } else {
            e.set_password(value).map_err(err)
        }
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn secret_has(name: Secret) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || get(name).is_some()).await.map_err(err)
}

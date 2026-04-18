use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

use anyhow::{Context, Result};
use rand::Rng;

#[derive(Debug, Clone)]
pub struct Config {
    pub token: String,
    pub ws_port: u16,
}

pub fn load_or_create() -> Result<Config> {
    let path = config_path()?;

    if path.exists() {
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let table: toml::Table = toml::from_str(&content)
            .with_context(|| format!("failed to parse {}", path.display()))?;
        let token = table
            .get("token")
            .and_then(|v| v.as_str())
            .context("missing 'token' in config")?
            .to_string();
        let ws_port = table
            .get("ws_port")
            .and_then(|v| v.as_integer())
            .unwrap_or(7878) as u16;
        return Ok(Config { token, ws_port });
    }

    // Generate a random 32-char alphanumeric token
    let token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    let dir = path.parent().context("config path has no parent")?;
    std::fs::create_dir_all(dir)
        .with_context(|| format!("failed to create {}", dir.display()))?;

    let content = format!("token = \"{token}\"\nws_port = 7878\n");

    // chmod 600 — token is a secret
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&path)
        .with_context(|| format!("failed to create {}", path.display()))
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(content.as_bytes())
                .context("failed to write config")
        })?;

    tracing::info!(
        path = %path.display(),
        token_prefix = &token[..8],
        "generated new config"
    );
    Ok(Config { token, ws_port: 7878 })
}

fn config_path() -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME not set")?;
    Ok(PathBuf::from(home).join(".config/clauded/config.toml"))
}

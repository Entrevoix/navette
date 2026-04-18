use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

use anyhow::{Context, Result};
use rand::Rng;

#[derive(Debug, Clone)]
pub struct NotifyConfig {
    pub ntfy_base_url: String,
    pub ntfy_topic: String,
    pub ntfy_token: String,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub token: String,
    pub ws_port: u16,
    pub approval_ttl_secs: u64,
    pub approval_warn_before_secs: u64,
    pub max_concurrent_sessions: usize,
    pub notify: NotifyConfig,
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
        let approval_ttl_secs = table
            .get("approval_ttl_secs")
            .and_then(|v| v.as_integer())
            .unwrap_or(300) as u64;
        let approval_warn_before_secs = table
            .get("approval_warn_before_secs")
            .and_then(|v| v.as_integer())
            .unwrap_or(30) as u64;
        let max_concurrent_sessions = table
            .get("max_concurrent_sessions")
            .and_then(|v| v.as_integer())
            .unwrap_or(4) as usize;
        let ntfy_base_url = table
            .get("ntfy_base_url")
            .and_then(|v| v.as_str())
            .unwrap_or("https://ntfy.sh")
            .to_string();
        let ntfy_token = table
            .get("ntfy_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // Generate and persist ntfy_topic on first access for existing configs.
        // Atomic write: build new content, write to .tmp, fsync, rename.
        let ntfy_topic_raw = table
            .get("ntfy_topic")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let ntfy_topic = if ntfy_topic_raw.is_empty() {
            let topic = random_alphanumeric(32);
            let updated = format!("{}ntfy_topic = \"{topic}\"\n", content.trim_end_matches('\n').to_string() + "\n");
            write_config_atomic(&path, &updated)
                .with_context(|| format!("failed to persist ntfy_topic to {}", path.display()))?;
            tracing::info!(topic = %topic, url = %ntfy_base_url, "generated ntfy topic (subscribe at {ntfy_base_url}/{topic})");
            topic
        } else {
            ntfy_topic_raw
        };

        return Ok(Config {
            token,
            ws_port,
            approval_ttl_secs,
            approval_warn_before_secs,
            max_concurrent_sessions,
            notify: NotifyConfig { ntfy_base_url, ntfy_topic, ntfy_token },
        });
    }

    // New config — generate token and ntfy_topic.
    let token = random_alphanumeric(32);
    let ntfy_topic = random_alphanumeric(32);

    let dir = path.parent().context("config path has no parent")?;
    std::fs::create_dir_all(dir)
        .with_context(|| format!("failed to create {}", dir.display()))?;

    let content = format!(
        "token = \"{token}\"\nws_port = 7878\napproval_ttl_secs = 300\napproval_warn_before_secs = 30\nmax_concurrent_sessions = 4\nntfy_base_url = \"https://ntfy.sh\"\nntfy_topic = \"{ntfy_topic}\"\nntfy_token = \"\"\n"
    );

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
        ntfy_topic = %ntfy_topic,
        "generated new config"
    );
    Ok(Config {
        token,
        ws_port: 7878,
        approval_ttl_secs: 300,
        approval_warn_before_secs: 30,
        max_concurrent_sessions: 4,
        notify: NotifyConfig {
            ntfy_base_url: "https://ntfy.sh".to_string(),
            ntfy_topic,
            ntfy_token: String::new(),
        },
    })
}

/// Write content to path atomically: write to .tmp, fsync, rename.
fn write_config_atomic(path: &PathBuf, content: &str) -> Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("toml.tmp");
    {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .with_context(|| format!("failed to open tmp config {}", tmp.display()))?;
        f.write_all(content.as_bytes()).context("failed to write tmp config")?;
        f.sync_all().context("failed to fsync tmp config")?;
    }
    std::fs::rename(&tmp, path)
        .with_context(|| format!("failed to rename {} → {}", tmp.display(), path.display()))
}

fn random_alphanumeric(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn config_path() -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME not set")?;
    Ok(PathBuf::from(home).join(".config/clauded/config.toml"))
}

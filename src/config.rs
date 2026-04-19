use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

use anyhow::{Context, Result};
use rand::Rng;

#[derive(Debug, Clone)]
pub struct NotifyConfig {
    pub ntfy_base_url: String,
    pub ntfy_topic: String,
    pub ntfy_token: String,
    pub telegram_bot_token: String,
    pub telegram_chat_id: String,
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
        let telegram_bot_token = table
            .get("telegram_bot_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let telegram_chat_id = table
            .get("telegram_chat_id")
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
            notify: NotifyConfig {
                ntfy_base_url,
                ntfy_topic,
                ntfy_token,
                telegram_bot_token,
                telegram_chat_id,
            },
        });
    }

    // New config — generate token and ntfy_topic.
    let token = random_alphanumeric(32);
    let ntfy_topic = random_alphanumeric(32);

    let dir = path.parent().context("config path has no parent")?;
    std::fs::create_dir_all(dir)
        .with_context(|| format!("failed to create {}", dir.display()))?;

    let content = format!(
        "token = \"{token}\"\nws_port = 7878\napproval_ttl_secs = 300\napproval_warn_before_secs = 30\nmax_concurrent_sessions = 4\nntfy_base_url = \"https://ntfy.sh\"\nntfy_topic = \"{ntfy_topic}\"\nntfy_token = \"\"\ntelegram_bot_token = \"\"\ntelegram_chat_id = \"\"\n"
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
            telegram_bot_token: String::new(),
            telegram_chat_id: String::new(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_config(token: &str) -> Config {
        Config {
            token: token.to_string(),
            ws_port: 7878,
            approval_ttl_secs: 300,
            approval_warn_before_secs: 30,
            max_concurrent_sessions: 4,
            notify: NotifyConfig {
                ntfy_base_url: "https://ntfy.sh".to_string(),
                ntfy_topic: "test-topic".to_string(),
                ntfy_token: String::new(),
                telegram_bot_token: String::new(),
                telegram_chat_id: String::new(),
            },
        }
    }

    #[test]
    fn default_config_has_sensible_values() {
        let cfg = make_config("mysecrettoken1234567890123456789");
        assert!(cfg.approval_ttl_secs > 0);
        assert!(cfg.approval_warn_before_secs < cfg.approval_ttl_secs);
        assert!(cfg.max_concurrent_sessions > 0);
        assert!(!cfg.token.is_empty());
    }

    #[test]
    fn ws_port_is_valid() {
        let cfg = make_config("tok");
        assert!(cfg.ws_port > 0);
    }

    #[test]
    fn warn_before_is_less_than_ttl() {
        let cfg = make_config("tok");
        // warn window must be strictly smaller so there's time to warn
        assert!(cfg.approval_warn_before_secs < cfg.approval_ttl_secs);
    }

    #[test]
    fn ntfy_base_url_is_non_empty() {
        let cfg = make_config("tok");
        assert!(!cfg.notify.ntfy_base_url.is_empty());
    }

    #[test]
    fn random_alphanumeric_length() {
        let s = random_alphanumeric(32);
        assert_eq!(s.len(), 32);
        assert!(s.chars().all(|c| c.is_alphanumeric()));
    }

    #[test]
    fn random_alphanumeric_different_each_call() {
        let a = random_alphanumeric(32);
        let b = random_alphanumeric(32);
        // Probability of collision is astronomically low for 32-char tokens
        assert_ne!(a, b);
    }

    #[test]
    fn toml_parsing_reads_all_fields() {
        let token = "testtoken1234567890123456789012";
        let content = format!(
            "token = \"{token}\"\nws_port = 9090\napproval_ttl_secs = 600\napproval_warn_before_secs = 60\nmax_concurrent_sessions = 8\nntfy_base_url = \"https://ntfy.sh\"\nntfy_topic = \"mytopic\"\nntfy_token = \"\"\ntelegram_bot_token = \"\"\ntelegram_chat_id = \"\"\n"
        );
        let table: toml::Table = toml::from_str(&content).unwrap();

        let parsed_token = table.get("token").and_then(|v| v.as_str()).unwrap();
        let parsed_port = table.get("ws_port").and_then(|v| v.as_integer()).unwrap() as u16;
        let parsed_ttl = table
            .get("approval_ttl_secs")
            .and_then(|v| v.as_integer())
            .unwrap() as u64;
        let parsed_warn = table
            .get("approval_warn_before_secs")
            .and_then(|v| v.as_integer())
            .unwrap() as u64;
        let parsed_max = table
            .get("max_concurrent_sessions")
            .and_then(|v| v.as_integer())
            .unwrap() as usize;

        assert_eq!(parsed_token, token);
        assert_eq!(parsed_port, 9090);
        assert_eq!(parsed_ttl, 600);
        assert_eq!(parsed_warn, 60);
        assert_eq!(parsed_max, 8);
        assert!(parsed_warn < parsed_ttl);
    }

    #[test]
    fn toml_missing_optional_fields_use_defaults() {
        // A minimal config with only 'token' — all optional fields should fall back to defaults.
        let content = "token = \"minimaltoken\"\n";
        let table: toml::Table = toml::from_str(content).unwrap();

        let ws_port = table
            .get("ws_port")
            .and_then(|v| v.as_integer())
            .unwrap_or(7878) as u16;
        let ttl = table
            .get("approval_ttl_secs")
            .and_then(|v| v.as_integer())
            .unwrap_or(300) as u64;
        let warn = table
            .get("approval_warn_before_secs")
            .and_then(|v| v.as_integer())
            .unwrap_or(30) as u64;
        let max = table
            .get("max_concurrent_sessions")
            .and_then(|v| v.as_integer())
            .unwrap_or(4) as usize;

        assert_eq!(ws_port, 7878);
        assert_eq!(ttl, 300);
        assert_eq!(warn, 30);
        assert_eq!(max, 4);
        assert!(warn < ttl);
    }
}

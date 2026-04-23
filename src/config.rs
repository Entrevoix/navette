// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

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
    pub tls_cert_path: Option<String>,
    pub tls_key_path: Option<String>,
}

impl Config {
    pub fn tls_enabled(&self) -> bool {
        match (&self.tls_cert_path, &self.tls_key_path) {
            (Some(cert), Some(key)) => {
                std::path::Path::new(cert).exists() && std::path::Path::new(key).exists()
            }
            _ => false,
        }
    }
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
        let port_i64 = table
            .get("ws_port")
            .and_then(|v| v.as_integer())
            .unwrap_or(7878);
        let ws_port = if (1..=65535).contains(&port_i64) {
            port_i64 as u16
        } else {
            tracing::warn!(value = port_i64, "ws_port out of range, using default 7878");
            7878
        };
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

        let tls_cert_path = table
            .get("tls_cert_path")
            .and_then(|v| v.as_str())
            .map(String::from);
        let tls_key_path = table
            .get("tls_key_path")
            .and_then(|v| v.as_str())
            .map(String::from);

        // Generate and persist ntfy_topic on first access for existing configs.
        // Atomic write: build new content, write to .tmp, fsync, rename.
        let ntfy_topic_raw = table
            .get("ntfy_topic")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let ntfy_topic = if ntfy_topic_raw.is_empty() {
            let topic = random_alphanumeric(32);
            let updated = format!(
                "{}ntfy_topic = \"{topic}\"\n",
                content.trim_end_matches('\n').to_string() + "\n"
            );
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
            tls_cert_path,
            tls_key_path,
        });
    }

    // New config — generate token, ntfy_topic, and self-signed TLS cert.
    let token = random_alphanumeric(32);
    let ntfy_topic = random_alphanumeric(32);

    let dir = path.parent().context("config path has no parent")?;
    std::fs::create_dir_all(dir).with_context(|| format!("failed to create {}", dir.display()))?;

    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");
    generate_self_signed_cert(&cert_path, &key_path)?;

    let cert_str = cert_path.to_string_lossy();
    let key_str = key_path.to_string_lossy();

    let content = format!(
        "token = \"{token}\"\nws_port = 7878\napproval_ttl_secs = 300\napproval_warn_before_secs = 30\nmax_concurrent_sessions = 4\nntfy_base_url = \"https://ntfy.sh\"\nntfy_topic = \"{ntfy_topic}\"\nntfy_token = \"\"\ntelegram_bot_token = \"\"\ntelegram_chat_id = \"\"\ntls_cert_path = \"{cert_str}\"\ntls_key_path = \"{key_str}\"\n"
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
        ntfy_topic = %ntfy_topic,
        tls_cert = %cert_str,
        "generated new config with TLS"
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
        tls_cert_path: Some(cert_str.into_owned()),
        tls_key_path: Some(key_str.into_owned()),
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
        f.write_all(content.as_bytes())
            .context("failed to write tmp config")?;
        f.sync_all().context("failed to fsync tmp config")?;
    }
    std::fs::rename(&tmp, path)
        .with_context(|| format!("failed to rename {} → {}", tmp.display(), path.display()))
}

fn generate_self_signed_cert(
    cert_path: &std::path::Path,
    key_path: &std::path::Path,
) -> Result<()> {
    use std::io::Write;

    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    let mut params = rcgen::CertificateParams::new(vec!["localhost".to_string()])
        .context("failed to create cert params")?;
    params.subject_alt_names.push(rcgen::SanType::IpAddress(
        "127.0.0.1".parse().expect("valid literal"),
    ));
    if let Ok(ip) = local_ip.parse() {
        params.subject_alt_names.push(rcgen::SanType::IpAddress(ip));
    }

    let key_pair = rcgen::KeyPair::generate().context("failed to generate key pair")?;
    let cert = params
        .self_signed(&key_pair)
        .context("failed to generate self-signed cert")?;

    let mut cert_file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(cert_path)
        .with_context(|| format!("failed to create {}", cert_path.display()))?;
    cert_file
        .write_all(cert.pem().as_bytes())
        .context("failed to write cert")?;

    let mut key_file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(key_path)
        .with_context(|| format!("failed to create {}", key_path.display()))?;
    key_file
        .write_all(key_pair.serialize_pem().as_bytes())
        .context("failed to write key")?;

    tracing::info!(
        cert = %cert_path.display(),
        key = %key_path.display(),
        san_ip = %local_ip,
        "generated self-signed TLS certificate"
    );
    Ok(())
}

fn random_alphanumeric(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

#[cfg(test)]
pub fn generate_self_signed_cert_for_test(cert_path: &std::path::Path, key_path: &std::path::Path) {
    generate_self_signed_cert(cert_path, key_path).unwrap();
}

fn config_path() -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME not set")?;
    Ok(PathBuf::from(home).join(".config/navetted/config.toml"))
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
            tls_cert_path: None,
            tls_key_path: None,
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

    #[test]
    fn tls_disabled_when_no_paths() {
        let cfg = make_config("tok");
        assert!(!cfg.tls_enabled());
    }

    #[test]
    fn tls_disabled_when_files_missing() {
        let mut cfg = make_config("tok");
        cfg.tls_cert_path = Some("/nonexistent/cert.pem".to_string());
        cfg.tls_key_path = Some("/nonexistent/key.pem".to_string());
        assert!(!cfg.tls_enabled());
    }

    #[test]
    fn tls_enabled_when_files_exist() {
        let dir = std::env::temp_dir().join("navetted-test-tls");
        std::fs::create_dir_all(&dir).unwrap();
        let cert = dir.join("cert.pem");
        let key = dir.join("key.pem");
        generate_self_signed_cert(&cert, &key).unwrap();

        let mut cfg = make_config("tok");
        cfg.tls_cert_path = Some(cert.to_string_lossy().into_owned());
        cfg.tls_key_path = Some(key.to_string_lossy().into_owned());
        assert!(cfg.tls_enabled());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generate_cert_creates_valid_pem_files() {
        let dir = std::env::temp_dir().join("navetted-test-certgen");
        std::fs::create_dir_all(&dir).unwrap();
        let cert = dir.join("cert.pem");
        let key = dir.join("key.pem");
        generate_self_signed_cert(&cert, &key).unwrap();

        let cert_content = std::fs::read_to_string(&cert).unwrap();
        let key_content = std::fs::read_to_string(&key).unwrap();
        assert!(cert_content.contains("BEGIN CERTIFICATE"));
        assert!(key_content.contains("BEGIN PRIVATE KEY"));

        std::fs::remove_dir_all(&dir).ok();
    }
}

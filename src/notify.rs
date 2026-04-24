// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

use std::time::Duration;

use anyhow::Result;

use crate::config::NotifyConfig;

pub struct NotifyClient {
    client: reqwest::Client,
    base_url: String,
    topic: String,
    token: String,
    telegram_bot_token: String,
    telegram_chat_id: String,
    webhook_url: Option<String>,
}

impl NotifyClient {
    pub fn new(cfg: &NotifyConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .expect("reqwest client build");
        Self {
            client,
            base_url: cfg.ntfy_base_url.trim_end_matches('/').to_string(),
            topic: cfg.ntfy_topic.clone(),
            token: cfg.ntfy_token.clone(),
            telegram_bot_token: cfg.telegram_bot_token.clone(),
            telegram_chat_id: cfg.telegram_chat_id.clone(),
            webhook_url: cfg.webhook_url.clone(),
        }
    }

    pub async fn publish(
        &self,
        title: &str,
        body: &str,
        priority: &str,
        tags: &[&str],
    ) -> Result<()> {
        if self.topic.is_empty() {
            return Ok(());
        }
        let url = format!("{}/{}", self.base_url, self.topic);
        let mut builder = self
            .client
            .post(&url)
            .header("Title", title)
            .header("Priority", priority)
            .body(body.to_string());

        if !tags.is_empty() {
            builder = builder.header("Tags", tags.join(","));
        }

        // Only send credentials over HTTPS to prevent token leakage.
        if !self.token.is_empty() {
            if self.base_url.starts_with("https://") {
                builder = builder.header("Authorization", format!("Bearer {}", self.token));
            } else {
                tracing::warn!(
                    "ntfy_token not sent: refusing to send credentials over non-HTTPS URL ({})",
                    self.base_url
                );
            }
        }

        let resp = builder.send().await?;
        if let Err(e) = resp.error_for_status() {
            tracing::warn!("ntfy publish failed: {e}");
        }
        Ok(())
    }

    pub async fn send_telegram(&self, text: &str) {
        if self.telegram_bot_token.is_empty() || self.telegram_chat_id.is_empty() {
            return;
        }
        let url = format!(
            "https://api.telegram.org/bot{}/sendMessage",
            self.telegram_bot_token
        );
        let payload = serde_json::json!({
            "chat_id": self.telegram_chat_id,
            "text": text,
            "parse_mode": "HTML"
        });
        if let Err(e) = self.client.post(&url).json(&payload).send().await {
            tracing::warn!("Telegram notification failed: {e}");
        }
    }

    pub async fn publish_webhook(&self, payload: &serde_json::Value) {
        let url = match &self.webhook_url {
            Some(u) if !u.is_empty() => u,
            _ => return,
        };
        match self.client.post(url).json(payload).send().await {
            Ok(resp) => {
                if let Err(e) = resp.error_for_status() {
                    tracing::warn!("webhook POST returned error status: {e}");
                }
            }
            Err(e) => {
                tracing::warn!("webhook POST failed: {e}");
            }
        }
    }
}

pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_escape_handles_special_chars() {
        assert_eq!(html_escape("<script>"), "&lt;script&gt;");
        assert_eq!(html_escape("A&B"), "A&amp;B");
        assert_eq!(html_escape("normal text"), "normal text");
        assert_eq!(html_escape(""), "");
        assert_eq!(html_escape(r#"a"b'c"#), "a&quot;b&#x27;c");
    }

    fn test_notify_config(webhook_url: Option<String>) -> NotifyConfig {
        NotifyConfig {
            ntfy_base_url: String::new(),
            ntfy_topic: String::new(),
            ntfy_token: String::new(),
            telegram_bot_token: String::new(),
            telegram_chat_id: String::new(),
            webhook_url,
        }
    }

    #[tokio::test]
    async fn publish_webhook_skips_when_url_is_none() {
        let client = NotifyClient::new(&test_notify_config(None));
        client
            .publish_webhook(&serde_json::json!({"type": "session_ended"}))
            .await;
    }

    #[tokio::test]
    async fn publish_webhook_skips_when_url_is_empty() {
        let client = NotifyClient::new(&test_notify_config(Some(String::new())));
        client
            .publish_webhook(&serde_json::json!({"type": "session_ended"}))
            .await;
    }
}

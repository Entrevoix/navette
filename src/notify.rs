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
}

impl NotifyClient {
    pub fn new(cfg: &NotifyConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        Self {
            client,
            base_url: cfg.ntfy_base_url.trim_end_matches('/').to_string(),
            topic: cfg.ntfy_topic.clone(),
            token: cfg.ntfy_token.clone(),
            telegram_bot_token: cfg.telegram_bot_token.clone(),
            telegram_chat_id: cfg.telegram_chat_id.clone(),
        }
    }

    pub async fn publish(&self, title: &str, body: &str, priority: &str, tags: &[&str]) -> Result<()> {
        if self.topic.is_empty() {
            return Ok(());
        }
        let url = format!("{}/{}", self.base_url, self.topic);
        let mut builder = self.client
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
                tracing::warn!("ntfy_token not sent: refusing to send credentials over non-HTTPS URL ({})", self.base_url);
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
}

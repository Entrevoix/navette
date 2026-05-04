// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

use std::time::Duration;

use anyhow::{Context, Result};
use ring::hmac;
use subtle::ConstantTimeEq;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;

use crate::{BufferedDecisions, Decision, PendingApprovals};

const MAX_REQUEST_SIZE: usize = 8192;

pub(crate) fn approval_sig(token: &str, tool_use_id: &str, decision: &str) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, token.as_bytes());
    let msg = format!("{tool_use_id}:{decision}");
    let tag = hmac::sign(&key, msg.as_bytes());
    hex::encode(tag.as_ref())
}

pub async fn serve(
    port: u16,
    token: String,
    pending: PendingApprovals,
    buffered: BufferedDecisions,
    tls_acceptor: Option<TlsAcceptor>,
) -> Result<()> {
    let addr = format!("0.0.0.0:{port}");
    let listener = TcpListener::bind(&addr)
        .await
        .with_context(|| format!("failed to bind HTTP API on {addr}"))?;
    let scheme = if tls_acceptor.is_some() {
        "https"
    } else {
        "http"
    };
    tracing::info!("HTTP API listening on {scheme}://{addr}");

    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                let token = token.clone();
                let pending = pending.clone();
                let buffered = buffered.clone();
                let tls = tls_acceptor.clone();
                tokio::spawn(async move {
                    let result = if let Some(acceptor) = tls {
                        match acceptor.accept(stream).await {
                            Ok(tls_stream) => handle(tls_stream, &token, &pending, &buffered).await,
                            Err(e) => {
                                tracing::debug!(%peer, "HTTP API TLS handshake failed: {e}");
                                return;
                            }
                        }
                    } else {
                        handle(stream, &token, &pending, &buffered).await
                    };
                    if let Err(e) = result {
                        tracing::debug!(%peer, "HTTP API error: {e:#}");
                    }
                });
            }
            Err(e) => tracing::warn!("HTTP API accept error: {e}"),
        }
    }
}

async fn handle<S: AsyncRead + AsyncWrite + Unpin>(
    mut stream: S,
    token: &str,
    pending: &PendingApprovals,
    buffered: &BufferedDecisions,
) -> Result<()> {
    let mut buf = vec![0u8; MAX_REQUEST_SIZE];
    let mut pos = 0;
    loop {
        let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buf[pos..]))
            .await
            .context("HTTP read timed out")?
            .context("HTTP read failed")?;
        if n == 0 {
            break;
        }
        pos += n;
        if pos >= MAX_REQUEST_SIZE || buf[..pos].windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    if pos == 0 {
        return Ok(());
    }
    let request = std::str::from_utf8(&buf[..pos]).unwrap_or("");

    let first_line = request.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 {
        return send_response(&mut stream, 400, "Bad Request").await;
    }

    let method = parts[0];
    let full_path = parts[1];

    if method != "POST" {
        return send_response(&mut stream, 405, "Method Not Allowed").await;
    }

    let (path, query) = match full_path.split_once('?') {
        Some((p, q)) => (p, q),
        None => return send_response(&mut stream, 400, "Missing signature").await,
    };

    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    if segments.len() != 3 || segments[0] != "approve" {
        return send_response(&mut stream, 404, "Not Found").await;
    }

    let tool_use_id = segments[1];
    let decision_str = segments[2];

    let decision = match decision_str {
        "allow" => Decision::Allow,
        "deny" => Decision::Deny,
        _ => return send_response(&mut stream, 400, "Invalid decision").await,
    };

    let sig = query
        .split('&')
        .find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            if k == "sig" {
                Some(v)
            } else {
                None
            }
        })
        .unwrap_or("");

    let expected = approval_sig(token, tool_use_id, decision_str);
    if bool::from(sig.as_bytes().ct_ne(expected.as_bytes())) {
        return send_response(&mut stream, 403, "Forbidden").await;
    }

    if let Some(tx) = pending.lock().await.remove(tool_use_id) {
        let _ = tx.send(decision);
        tracing::info!(%tool_use_id, %decision_str, "HTTP API approval resolved");
    } else {
        buffered
            .lock()
            .await
            .insert(tool_use_id.to_string(), decision);
        tracing::info!(%tool_use_id, %decision_str, "HTTP API decision buffered");
    }

    send_response(&mut stream, 200, "OK").await
}

async fn send_response<S: AsyncWrite + Unpin>(
    stream: &mut S,
    status: u16,
    body: &str,
) -> Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: text/plain\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::{oneshot, Mutex};

    #[test]
    fn approval_sig_is_deterministic() {
        let sig1 = approval_sig("token123", "tool-abc", "allow");
        let sig2 = approval_sig("token123", "tool-abc", "allow");
        assert_eq!(sig1, sig2);
    }

    #[test]
    fn approval_sig_differs_by_decision() {
        let allow = approval_sig("token123", "tool-abc", "allow");
        let deny = approval_sig("token123", "tool-abc", "deny");
        assert_ne!(allow, deny);
    }

    #[test]
    fn approval_sig_differs_by_tool_use_id() {
        let sig1 = approval_sig("token123", "tool-abc", "allow");
        let sig2 = approval_sig("token123", "tool-xyz", "allow");
        assert_ne!(sig1, sig2);
    }

    #[test]
    fn approval_sig_differs_by_token() {
        let sig1 = approval_sig("token123", "tool-abc", "allow");
        let sig2 = approval_sig("other-token", "tool-abc", "allow");
        assert_ne!(sig1, sig2);
    }

    async fn do_handle(
        request: &str,
        token: &str,
        pending: &PendingApprovals,
        buffered: &BufferedDecisions,
    ) -> String {
        let (mut client, server) = tokio::io::duplex(4096);
        client.write_all(request.as_bytes()).await.unwrap();
        client.shutdown().await.unwrap();
        let _ = handle(server, token, pending, buffered).await;
        let mut response = String::new();
        client.read_to_string(&mut response).await.unwrap();
        response
    }

    fn empty_state() -> (PendingApprovals, BufferedDecisions) {
        (
            Arc::new(Mutex::new(HashMap::new())),
            Arc::new(Mutex::new(HashMap::new())),
        )
    }

    #[tokio::test]
    async fn handle_resolves_pending_allow() {
        let token = "test-token";
        let id = "tool-123";
        let sig = approval_sig(token, id, "allow");
        let req = format!("POST /approve/{id}/allow?sig={sig} HTTP/1.1\r\nHost: localhost\r\n\r\n");

        let (pending, buffered) = empty_state();
        let (tx, rx) = oneshot::channel();
        pending.lock().await.insert(id.to_string(), tx);

        let resp = do_handle(&req, token, &pending, &buffered).await;
        assert!(resp.contains("200 OK"));
        assert_eq!(rx.await.unwrap(), Decision::Allow);
    }

    #[tokio::test]
    async fn handle_buffers_when_no_pending() {
        let token = "test-token";
        let id = "tool-456";
        let sig = approval_sig(token, id, "deny");
        let req = format!("POST /approve/{id}/deny?sig={sig} HTTP/1.1\r\nHost: localhost\r\n\r\n");

        let (pending, buffered) = empty_state();
        let resp = do_handle(&req, token, &pending, &buffered).await;
        assert!(resp.contains("200 OK"));
        assert_eq!(buffered.lock().await.get(id), Some(&Decision::Deny));
    }

    #[tokio::test]
    async fn handle_rejects_wrong_sig() {
        let req = "POST /approve/tool-123/allow?sig=bad HTTP/1.1\r\nHost: localhost\r\n\r\n";
        let (pending, buffered) = empty_state();
        let resp = do_handle(req, "test-token", &pending, &buffered).await;
        assert!(resp.contains("403 Forbidden"));
    }

    #[tokio::test]
    async fn handle_rejects_get_method() {
        let req = "GET /approve/tool-123/allow?sig=x HTTP/1.1\r\nHost: localhost\r\n\r\n";
        let (pending, buffered) = empty_state();
        let resp = do_handle(req, "test-token", &pending, &buffered).await;
        assert!(resp.contains("405 Method Not Allowed"));
    }

    #[tokio::test]
    async fn handle_rejects_invalid_path() {
        let req = "POST /unknown?sig=x HTTP/1.1\r\nHost: localhost\r\n\r\n";
        let (pending, buffered) = empty_state();
        let resp = do_handle(req, "test-token", &pending, &buffered).await;
        assert!(resp.contains("404 Not Found"));
    }

    #[tokio::test]
    async fn handle_rejects_invalid_decision() {
        let token = "test-token";
        let sig = approval_sig(token, "tool-x", "maybe");
        let req =
            format!("POST /approve/tool-x/maybe?sig={sig} HTTP/1.1\r\nHost: localhost\r\n\r\n");
        let (pending, buffered) = empty_state();
        let resp = do_handle(&req, token, &pending, &buffered).await;
        assert!(resp.contains("400 Bad Request"));
    }
}

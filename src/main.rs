// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

use anyhow::{Context, Result};
use base64::Engine as _;
use navetted::config;

fn print_help() {
    let version = env!("CARGO_PKG_VERSION");
    println!("navetted {version} — remote interface daemon for Claude Code");
    println!();
    println!("USAGE:");
    println!("    navetted [OPTIONS]");
    println!();
    println!("OPTIONS:");
    println!("    --pair    Show a QR code to pair the mobile app (daemon must be running)");
    println!("    --help    Print this help message");
    println!();
    println!("CONFIG:");
    println!("    ~/.config/navetted/config.toml (auto-created on first run)");
    println!();
    println!("Start the daemon first, then run `navetted --pair` in another terminal");
    println!("to display the pairing QR code for the navette mobile app.");
}

fn handle_pair() -> Result<()> {
    let cfg = config::load_or_create()?;

    let addr = format!("127.0.0.1:{}", cfg.ws_port);
    if std::net::TcpStream::connect_timeout(
        &addr.parse().unwrap(),
        std::time::Duration::from_secs(2),
    )
    .is_err()
    {
        anyhow::bail!(
            "navetted is not running on port {}. Start the daemon first: navetted",
            cfg.ws_port
        );
    }

    let tls = cfg.tls_enabled();
    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    let payload = serde_json::json!({
        "host": local_ip,
        "port": cfg.ws_port.to_string(),
        "token": cfg.token,
        "tls": tls,
    });
    let json = serde_json::to_string(&payload).context("failed to serialize pairing payload")?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&json);
    let uri = format!("navette://{encoded}");

    let qr = qrcode::QrCode::new(uri.as_bytes()).context("failed to generate QR code")?;
    let rendered = qr
        .render::<char>()
        .quiet_zone(true)
        .module_dimensions(2, 1)
        .build();

    println!("\n{rendered}");
    println!("  Scan with the navette app to connect.");
    println!("  Host: {local_ip}  Port: {}\n", cfg.ws_port);
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    if std::env::args().any(|a| a == "--help" || a == "-h") {
        print_help();
        return Ok(());
    }
    if std::env::args().any(|a| a == "--pair") {
        return handle_pair();
    }

    if let Some(code) = navetted::maybe_reexec_on_host()? {
        std::process::exit(code);
    }

    tracing_subscriber::fmt::init();

    navetted::run_daemon().await
}

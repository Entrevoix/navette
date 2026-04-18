mod claude;
mod db;
mod hook;

use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use tokio::sync::{oneshot, Mutex};

/// Shared map: tool_use_id → oneshot sender waiting for a user decision.
/// Hook connections insert their sender here and block on the receiver.
/// Approval sources (stdin today, WebSocket later) send to resolve them.
pub type PendingApprovals = Arc<Mutex<HashMap<String, oneshot::Sender<Decision>>>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let prompt = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: clauded <prompt>");
        std::process::exit(1);
    });

    let db = Arc::new(std::sync::Mutex::new(db::open()?));
    let pending: PendingApprovals = Arc::new(Mutex::new(HashMap::new()));

    // Hook socket listener — must be running before Claude is spawned
    tokio::spawn(hook::serve(pending.clone()));

    // Temporary stdin approval reader until WebSocket is built.
    // Type "y <tool_use_id>" or "n <tool_use_id>" to approve/deny.
    tokio::spawn(read_stdin_approvals(pending.clone()));

    // Spawn Claude and stream events into SQLite; blocks until claude exits
    claude::spawn_and_process(&prompt, db, pending).await?;

    Ok(())
}

async fn read_stdin_approvals(pending: PendingApprovals) {
    use tokio::io::{AsyncBufReadExt, BufReader};
    let mut lines = BufReader::new(tokio::io::stdin()).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        let mut parts = line.splitn(2, ' ');
        let (cmd, id) = match (parts.next(), parts.next()) {
            (Some(c), Some(i)) => (c, i.trim()),
            _ => {
                eprintln!("usage: y <tool_use_id> | n <tool_use_id>");
                continue;
            }
        };
        let decision = match cmd {
            "y" => Decision::Allow,
            "n" => Decision::Deny,
            other => {
                eprintln!("unknown command '{other}': use 'y' or 'n'");
                continue;
            }
        };
        if let Some(tx) = pending.lock().await.remove(id) {
            let _ = tx.send(decision);
        } else {
            eprintln!("no pending approval for tool_use_id '{id}'");
        }
    }
}

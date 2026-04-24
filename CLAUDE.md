# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

navette is a mobile-first remote interface for Claude Code. A Rust daemon (`navetted`) runs on the workstation and bridges a React Native mobile app to the Claude Code CLI over WebSocket.

## Build & Test

```bash
cargo build                      # Build both binaries (navetted + navetted-hook)
cargo test                       # Run all tests
cargo test test_name             # Run a single test by name
cargo clippy -- -D warnings      # Lint
cargo fmt                        # Format
```

The crate produces two binaries: `navetted` (the daemon) and `navetted-hook` (the PreToolUse hook). They must be built together — `navetted-hook` must exist alongside `navetted` at runtime.

Vendored dependencies live in `vendor/` (committed, used for Flatpak offline builds). `cargo build` uses the normal registry; Flatpak builds use `vendor/`.

### Mobile (React Native)

```bash
cd mobile && npm install && npx expo start
```

## Architecture

```
phone (navette app) ←── WebSocket :7878 ───→ workstation (navetted)
                                                    ↕
                                             Claude Code CLI (PTY)
```

### Daemon startup (`main.rs`)

`main.rs` wires up four long-lived tokio tasks:
1. **Hook socket** (`hook.rs`) — Unix domain socket at `$XDG_RUNTIME_DIR/navetted/hook.sock`
2. **Push notifications** (`notify.rs`) — subscribes to the broadcast channel, fires ntfy/Telegram
3. **Scheduler** — polls SQLite every 30s to fire scheduled sessions
4. **WebSocket server** (`ws.rs`) — authenticates clients, replays events, handles commands

All tasks share state through `Arc<Mutex<..>>` maps: `PendingApprovals`, `BufferedDecisions`, `Sessions`.

### Approval flow (the core loop)

1. Claude Code calls `navetted-hook` (a separate binary) as a PreToolUse hook before every tool use
2. `navetted-hook` reads the hook JSON from stdin, connects to the Unix socket, sends a `HookRequest`
3. `hook.rs` persists an `approval_pending` event, broadcasts it to all WS clients
4. The mobile app shows the approval; user taps allow/deny
5. WS handler in `ws.rs` resolves the `oneshot::Sender` in `PendingApprovals` (or buffers early decisions in `BufferedDecisions`)
6. `hook.rs` writes the decision back to the Unix socket; `navetted-hook` exits 0 (allow) or 2 (deny)
7. Approval has a configurable TTL (default 300s) with a warning event before expiry; unanswered approvals auto-deny

### Claude process management (`claude.rs`)

Sessions spawn Claude Code in a PTY (via `portable-pty`) with `--output-format stream-json --verbose`. The PTY is necessary so Claude's `isatty()` returns true (enabling interactive hooks). Lines are read from the PTY master, ANSI-stripped, and only JSON lines are stored. Events larger than 64 KiB are truncated. Token usage is accumulated atomically from `usage` fields in assistant events.

When `dangerously_skip_permissions` is false (the default), `claude.rs` writes `~/.claude/settings.local.json` with a PreToolUse hook pointing at `navetted-hook` and pre-approves all tool permissions so Claude doesn't prompt interactively.

### Persistence (`db.rs`)

SQLite at `~/.local/share/navetted/events.db` (WAL mode, 0600 permissions). Four tables:
- `events` — append-only event log with session_id, capped at 10,000 rows via `enforce_retention`
- `scheduled_sessions` — future sessions with `fired` flag
- `prompt_library` — saved prompt templates (CRUD)
- `secrets` — AES-256-GCM encrypted secrets (key derived from the auth token via HKDF)

### Configuration (`config.rs`)

TOML at `~/.config/navetted/config.toml`. Auto-generates a random 32-char auth token and ntfy topic on first run. Key fields: `token`, `ws_port` (default 7878), `approval_ttl_secs` (300), `max_concurrent_sessions` (4), ntfy/Telegram notification settings.

### WebSocket protocol (`ws.rs`)

Three-phase connection: (1) `hello` with token auth (constant-time compare), (2) `attach` + event replay from a `since` seq, (3) bidirectional live loop. Message types include: `run`, `kill_session`, `list_sessions`, `schedule_session`, `list_dir`, `read_file`, `write_file` (restricted to `~/.claude/`), `save_prompt`, `set_secret`, and approval `input`.

### Mobile app (`mobile/`)

React Native (Expo) app. Core hook is `useNavettedWS.ts` which manages the WebSocket connection, event replay, and all command dispatch. Screens: Connect, Main (session view), Lock, Settings, FileBrowser, PromptLibrary, Secrets, Schedule, Skills, SessionHistory.

## Key design decisions

- **PTY not pipe**: Claude Code requires `isatty()=true` for PreToolUse hooks to fire. PTY cols set to 32,767 to prevent JSON line wrapping.
- **Broadcast channel**: Events flow through a tokio `broadcast::channel(4096)` — all WS clients and the notification task subscribe independently.
- **Buffered decisions**: If a mobile user taps allow/deny before the hook binary connects, the decision is buffered in `BufferedDecisions` and consumed when the hook registers.
- **Secrets encryption**: Secrets are encrypted at rest with AES-256-GCM. The encryption key is derived from the auth token via HKDF-SHA256 — changing the token invalidates all secrets.
- **File writes restricted**: The `write_file` WS command only allows writes under `~/.claude/` to limit blast radius.
- **Container support**: Sessions can run inside distrobox containers via the `container` field on `run` messages.

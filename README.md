# claude-desktop-ssh

A multi-device native client for [Claude Code](https://www.anthropic.com/claude-code) — purpose-built for developing on the go.

Raw Termux+SSH works but the UX is painful: tiny keyboard, no context on reconnect, tool approvals buried in terminal noise. This project wraps Claude Code CLI in a persistent daemon with a WebSocket resume protocol, serving a Tauri desktop app and React Native Android app. Tool approvals become swipeable cards. Disconnecting and reconnecting replays what you missed. The AI pauses; the human has real control.

## How it works

```
[claude --output-format stream-json]
         ↕ stdin/stdout
    [clauded — Rust daemon]
         ├── SQLite: event log (seq, ts, json)
         ├── WebSocket 0.0.0.0:7878
         │     ├── resume: {"since": N} → replay + live stream
         │     └── input:  {"type":"input","text":"y"}
         ├── [React Native Android] — tool approval cards, session replay
         └── [Tauri desktop] — three-panel: sessions / conversation / diff
```

Claude Code already emits structured JSON events via `--output-format stream-json`. No PTY hacks, no screen-scraping. `clauded` wraps that stream, persists it to SQLite, and serves it over WebSocket with a resume protocol. Both clients are rendering problems — the daemon is the whole game.

Network transport: [Tailscale](https://tailscale.com). No open ports. No cloud relay. Direct connection from phone to home machine over VPN.

## Build order

1. **`clauded`** — Rust/Tokio daemon (this repo)
2. **React Native Android** — bare minimum: tool approval cards + session replay
3. **Tauri desktop** — three-panel layout, diff viewer (hermes-desktop scaffold)

## Day-0 verification (run before writing daemon code)

The entire architecture depends on `claude --output-format stream-json` pausing on stdin for tool approval. Verify this first:

```bash
stdbuf -oL claude --output-format stream-json \
  -p "write hello to /tmp/test.txt" | while IFS= read -r line; do
    echo "$(date +%s.%N) $line"
    sleep 0.1
done
```

**If output STOPS after the `tool_use` event** — stdin is the gate. Architecture works. Send `y` to stdin and confirm the tool executes.

**If output CONTINUES through `tool_result`** — stream-json auto-approves. Pivot to Claude's hooks system or an MCP server wrapper.

Do not write the WebSocket layer until both checks pass.

## Protocol (v0)

### Connection

Every connection starts with a `hello`:

```json
// client → server
{"type": "hello", "token": "shared-secret", "client_id": "uuid-v4"}

// server → client
{"type": "welcome", "client_id": "uuid-v4"}
{"type": "rejected", "reason": "bad token"}
```

Token lives in `~/.config/clauded/config.toml` (created `chmod 600`). Rotated by changing the value and restarting clauded.

### Resume

```json
// client → server. N is exclusive — returns events with seq > N.
{"type": "attach", "session_id": "abc123"}
{"since": 142}

// server → client: replay 143..current, then live
{"seq": 143, "ts": 1713380000.1, "event": {...}}
{"type": "caught-up", "seq": 144}
{"seq": 145, ...}  // live
```

After `attach`, all input on that connection is routed to that session. To switch sessions, reconnect.

### Tool approval

```json
// daemon broadcasts when tool_use event arrives:
{"seq": 50, "event": {"type": "tool_use", "name": "Write", "input": {...}}}

// first client to respond wins:
{"type": "input", "text": "y"}

// daemon broadcasts resolution to all clients:
{"type": "approval_resolved", "by": "client-id", "decision": "y"}
```

Default approval timeout: 1800s (configurable). On timeout, daemon writes `n` to stdin and broadcasts `approval_timeout`.

### Session states

```
IDLE ──spawn──► RUNNING ──tool_use──► PENDING_APPROVAL
                  │                         │
                  │            approval/timeout/deny
                  │                         │
                  │◄────────────────────────┘
                  │
                  ├── unexpected exit (attempt 1) ──► RESTARTING ──► RUNNING
                  │                                                └──► DEAD
                  ├── kill ──► DEAD
                  └── exit 0 ──► DONE
```

### Session management

```json
{"type": "spawn", "prompt": "refactor auth module", "cwd": "/home/user/myproject"}
{"type": "spawned", "session_id": "abc123", "pid": 48291}

{"type": "attach", "session_id": "abc123"}
{"since": 0}
```

## Event log

- SQLite WAL mode. One DB per session: `~/.local/share/clauded/{session-id}.db`
- Each DB has a `meta` table (`session_id`, `cwd`, `status`, `created_at`) for restart recovery
- On daemon restart: orphaned `RUNNING` sessions are marked `DEAD`
- Max payload: 64KB inline. Larger payloads truncated with `"truncated": true, "full_size_bytes": N`
- Retention: 10,000 events per session (cleanup every 100 inserts)

## Configuration

```toml
# ~/.config/clauded/config.toml  (chmod 600)

[auth]
token = "your-shared-secret-here"  # rotate by changing + restart

[daemon]
claude_bin = "/usr/local/bin/claude"  # explicit path, don't rely on PATH
max_restarts = 1

[session]
approval_timeout_seconds = 1800  # 30 min default
```

## Distribution

| Artifact | Format | Install |
|----------|--------|---------|
| `clauded` | GitHub Release binary | Download, add to PATH, systemd unit for auto-start |
| Android app | APK sideload | GitHub Releases |
| Desktop app | `.AppImage` | GitHub Releases |

CI: GitHub Actions on tag push. `cargo build --release` for `linux/amd64` and `linux/arm64`.

## Requirements

- [Claude Code](https://www.anthropic.com/claude-code) installed and authenticated
- [Tailscale](https://tailscale.com) on all devices
- Rust toolchain (for building from source)

## Status

Pre-implementation. Design doc and architecture complete. See [TODOS.md](TODOS.md) for the build queue.

**First thing to build:** run the Day-0 verification above. Everything else depends on it.

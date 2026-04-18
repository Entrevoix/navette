# claude-desktop-ssh

A multi-device native client for [Claude Code](https://www.anthropic.com/claude-code) — purpose-built for developing on the go.

Raw Termux+SSH works but the UX is painful: tiny keyboard, no context on reconnect, tool approvals buried in terminal noise. This project wraps Claude Code CLI in a persistent daemon with a WebSocket resume protocol, serving a Tauri desktop app and React Native Android app. Tool approvals become swipeable cards. Disconnecting and reconnecting replays what you missed. The AI pauses; the human has real control.

## How it works

```
[claude --output-format stream-json]
         ↑ stdout (events)
    [clauded — Rust daemon]
         ├── PreToolUse hook → /internal/approval (IPC, blocks claude)
         ├── SQLite: event log (seq, ts, json)
         ├── WebSocket 0.0.0.0:7878
         │     ├── resume: {"since": N} → replay + live stream
         │     └── input:  {"type":"input","text":"y"} → approval decision
         ├── [React Native Android] — tool approval cards, session replay
         └── [Tauri desktop] — three-panel: sessions / conversation / diff
```

Claude Code already emits structured JSON events via `--output-format stream-json`. No PTY hacks, no screen-scraping. `clauded` wraps that stream, persists it to SQLite, and serves it over WebSocket with a resume protocol. Both clients are rendering problems — the daemon is the whole game.

Network transport: [Tailscale](https://tailscale.com). No open ports. No cloud relay. Direct connection from phone to home machine over VPN.

## Build order

1. **`clauded`** — Rust/Tokio daemon (this repo)
2. **React Native Android** — bare minimum: tool approval cards + session replay
3. **Tauri desktop** — three-panel layout, diff viewer (hermes-desktop scaffold)

## Day-0 verification (completed — findings changed the architecture)

**Result:** `claude --output-format stream-json -p "..."` does **not** pause on stdin for tool approval. The `-p` flag runs Claude non-interactively. On a tool call, Claude Code immediately emits `tool_result` with `permission_denials` and exits. stdin is not the gate.

```
tool_use  (Write /tmp/test.txt)   t=0ms
tool_result → "you haven't granted it yet."  t=175ms
result.permission_denials: [{"tool_name":"Write",...}]
process exits
```

**The approval gate is Claude Code's hooks system**, not stdin.

### How approval actually works

Claude Code has two layers: a built-in permission system (fires immediately, causes `permission_denials`) and a hooks system (`PreToolUse` hook, runs as a subprocess). In default `permissionMode`, the built-in check fires **before** any hook and denies unapproved tools instantly — the hook never gets a chance.

The daemon must spawn Claude with `--dangerously-skip-permissions` to disable the built-in gate. The `PreToolUse` hook then becomes the sole approval mechanism.

```bash
claude --output-format stream-json --dangerously-skip-permissions \
  --verbose -p "..."
```

`clauded` writes a hook config to `~/.claude/settings.local.json` (atomic tempfile + rename) before spawning:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": ".*",
      "command": "/absolute/path/to/clauded-hook"
    }]
  }
}
```

The hook binary:
- Receives full tool call JSON on stdin (includes `tool_use_id` — the correlation key)
- Connects to daemon Unix socket at `$XDG_RUNTIME_DIR/clauded/hook.sock` (500ms connect timeout)
- Sends `{"tool_use_id": "...", "tool_name": "...", "input": {...}}` and blocks
- Daemon responds `{"decision": "allow"}` or `{"decision": "deny", "reason": "..."}`
- Exit 0 → allow, exit 2 → block. **Any error path exits 2. Never fail open.**

```
[claude --dangerously-skip-permissions --output-format stream-json]
    stdout → tool_use event → clauded (log to SQLite, note tool_use_id)
    PreToolUse hook fires (blocking subprocess, keyed by tool_use_id)
        → hook connects to $XDG_RUNTIME_DIR/clauded/hook.sock
        → daemon correlates by tool_use_id, broadcasts pending_approval to WebSocket
        → user approves/denies from phone or desktop
        → daemon writes decision to hook socket connection
        → hook exits 0 (allow) or 2 (deny)
    stdout → tool_result event → clauded (log, broadcast)
```

**Concurrent tool calls:** Claude may invoke multiple tools in parallel. The daemon maintains a `HashMap<tool_use_id, ApprovalSender>` — N independent pending approvals, not a global slot. Each hook connection is independent.

**Hook disconnect:** If the hook process dies mid-wait (OOM, signal), the Unix socket connection closes. The daemon must detect this and garbage-collect the pending approval entry.

**Security:** The hook socket parent dir is `chmod 700`. Daemon verifies `SO_PEERCRED` on each connection to confirm the peer PID descends from the spawned claude process. Hook binary path must be absolute and not world-writable.

Do not write the WebSocket layer until you have a working PreToolUse hook that blocks on IPC, correlates by `tool_use_id`, and correctly gates tool execution with fail-closed behavior.

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

Approval is gated by a `PreToolUse` hook subprocess, not stdin. The hook blocks claude until the daemon resolves it.

```json
// hook fires → daemon correlates by tool_use_id, broadcasts to all WebSocket clients:
{"seq": 50, "event": {"type": "tool_use", "name": "Write", "tool_use_id": "tu_abc", "input": {...}}}

// first client to respond wins (must include tool_use_id to handle concurrent approvals):
{"type": "input", "tool_use_id": "tu_abc", "decision": "y"}   // or "n"

// daemon resolves the hook IPC → hook exits 0 (allow) or 2 (deny)
// daemon broadcasts resolution to all clients:
{"type": "approval_resolved", "tool_use_id": "tu_abc", "by": "client-id", "decision": "y"}
```

Default approval timeout: 1800s (configurable). On timeout, daemon resolves deny → hook exits 2 → broadcasts `approval_timeout`.

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

## Distrobox support

Distrobox shares the host's network namespace and `$HOME`, so the daemon is nearly transparent:

- **Network:** WebSocket on `0.0.0.0:7878` is visible to Tailscale on the host. No changes needed.
- **Filesystem:** SQLite DBs (`~/.local/share/clauded/`) and hook socket (`$XDG_RUNTIME_DIR/clauded/hook.sock`) are on the host filesystem via bind-mounts. Persist across container restarts.
- **Paths:** distrobox shares `$HOME`, so `cwd` paths in session spawn commands are identical inside and outside the container.

**Running clauded persistently inside distrobox:**

```ini
# ~/.config/systemd/user/clauded.service  (on the host)
[Unit]
Description=clauded daemon (inside distrobox)
After=network.target

[Service]
ExecStart=distrobox-enter --name mybox -- /home/user/.local/bin/clauded
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

If your distrobox uses `--init` (systemd inside the container), install the unit inside the box instead and enable it normally.

Set `distrobox_name` in config to have clauded prefix all `claude` spawns with `distrobox-enter --name <name> --`. This lets clauded run on the host while `claude` runs inside the container.

## Configuration

```toml
# ~/.config/clauded/config.toml  (chmod 600)

[auth]
token = "your-shared-secret-here"  # rotate by changing + restart

[daemon]
claude_bin = "/home/user/.local/bin/claude"  # in-container path
max_restarts = 1
distrobox_name = "mybox"  # optional: prefix claude spawns with distrobox-enter

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

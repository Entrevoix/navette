# clauded

**Self-hosted AI agent remote control — drive Claude Code from your phone**

![Rust](https://img.shields.io/badge/rust-1.75%2B-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

---

clauded is a Rust PTY daemon that lets you control Claude Code (and other AI agent CLIs) from a React Native mobile app. No cloud relay, no subscription — just your own API key and a WebSocket connection over your local network or VPN.

---

## Features

- **Multi-session daemon** — up to 4 concurrent agent sessions (configurable)
- **Tool approval gate** — permit or deny tool calls from your phone with a configurable timeout and auto-deny on expiry; orange pulse warning ≤30s
- **Mid-session text input** — steer the agent without stopping the session
- **Skill launcher** — browse `~/.claude/skills/` and run any skill as `/skill-name` from mobile
- **Advanced session start** — collapsible panel with custom command, work-dir picker, and `--dangerously-skip-permissions` toggle
- **Push notifications** — via [ntfy.sh](https://ntfy.sh) (self-hostable, no Apple Push/FCM account needed)
- **Multi-agent support** — run `claude`, `codex`, `gemini`, `aider`, or any custom binary
- **Visual diff viewer** — collapsible unified diff with +/− line coloring for file edits
- **Session dashboard** — live cards with agent label, status, elapsed time, and token usage
- **Scheduled sessions** — fire at +1h, +4h, +8h, or a custom time
- **Session history replay** — past sessions render full tool-use detail with diffs, not just plain text
- **Telegram notifications** — optional channel alongside ntfy
- **WebSocket auto-reconnect** — exponential backoff with event replay on reconnect

---

## Architecture

```
Mobile (React Native/Expo)
    ↕ WebSocket :7878 (token-auth)
clauded (Rust PTY daemon)
    ├── PTY subprocess (claude / codex / aider / gemini / custom)
    ├── Unix socket hook (PreToolUse approval gate)
    ├── SQLite event store
    └── ntfy.sh / Telegram notifications
```

Two binaries are built:

| Binary | Role |
|---|---|
| `clauded` | Long-running WebSocket daemon and PTY manager |
| `clauded-hook` | One-shot Claude Code hook; blocks tool execution pending mobile approval |

---

## Installation

### Option A: Flatpak (recommended for Linux desktop)

```bash
# Build the Flatpak bundle (from the flatpak/ directory)
cd flatpak && ./build.sh

# Install
flatpak install --user clauded.flatpak

# Install the systemd user service
cp flatpak/com.beary.clauded.service ~/.config/systemd/user/clauded.service
systemctl --user daemon-reload

# Enable and start
systemctl --user enable --now clauded

# Check status
systemctl --user status clauded
```

### Option B: Build from source

Prerequisites: Rust 1.75+, SQLite 3 dev headers

```bash
cargo build --release

# Install both binaries
sudo install -Dm755 target/release/clauded /usr/local/bin/clauded
sudo install -Dm755 target/release/clauded-hook /usr/local/bin/clauded-hook

# Run
clauded
```

### Mobile app (Android)

Sideload the debug APK via ADB:

```bash
adb install app-debug.apk
```

---

## Configuration

Config is auto-generated at `~/.config/clauded/config.toml` on first run. The auth token and ntfy topic are randomly generated and written at mode `0600`.

```toml
token = "your-auth-token-here"          # auto-generated; copy into the mobile app
ws_port = 7878
approval_ttl_secs = 300                 # auto-deny pending approvals after 5 minutes
approval_warn_before_secs = 30          # push warning at 30s remaining
max_concurrent_sessions = 4

ntfy_base_url = "https://ntfy.sh"       # replace with your self-hosted URL if needed
ntfy_topic = "auto-generated"           # subscribe at ntfy_base_url/ntfy_topic
ntfy_token = ""                         # ntfy access token (leave empty for public topics)

# Optional Telegram notifications
telegram_bot_token = ""
telegram_chat_id = ""
```

The token and ntfy topic are logged on first startup. Retrieve them anytime:

```bash
journalctl --user -u clauded -n 20
# or
cat ~/.config/clauded/config.toml
```

---

## Connecting the mobile app

1. Start clauded on your server or desktop
2. Find the auth token in `~/.config/clauded/config.toml` or the startup logs
3. In the mobile app: enter `ws://your-host:7878`, paste the token, tap **Connect**

For remote access over the internet, tunnel the WebSocket port through WireGuard, Tailscale, or SSH port forwarding. Do not expose port 7878 directly to the internet without a TLS terminator.

---

## Hook setup (tool approvals)

`clauded-hook` must be registered as a Claude Code `PreToolUse` hook. Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "command": "clauded-hook"
      }
    ]
  }
}
```

When a tool call fires, `clauded-hook` contacts the daemon via Unix socket and blocks until the mobile app sends permit or deny, or until `approval_ttl_secs` elapses (auto-deny).

---

## Supported agents

| Agent | Command |
|---|---|
| Claude Code | `claude` (default) |
| OpenAI Codex | `openai codex` |
| Gemini CLI | `gemini` |
| Aider | `aider` |
| Custom | any binary in `$PATH` |

The `command` field is optional in the `run` WebSocket message. When omitted, the daemon falls back to the `CLAUDE_BIN` environment variable, then `claude`.

---

## Environment variables

| Variable | Effect |
|---|---|
| `CLAUDE_BIN` | Override the default agent binary |
| `RUST_LOG` | Log filter (e.g. `info`, `debug`, `clauded=trace`) |

---

## License

MIT

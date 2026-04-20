# navetted Roadmap

Self-hosted, subscription-free AI agent remote control — a Rust PTY daemon + React Native mobile client.

**Positioning**: The remote control layer for developers who won't route their sessions through someone else's server. Works with any Claude API key, no Anthropic Max subscription required, zero cloud relay.

---

## Shipped

### Phase 1 — Approval timeout + auto-deny
- Configurable TTL (`approval_ttl_secs`, `approval_warn_before_secs`) in `navetted.toml`
- Auto-deny on expiry; `approval_pending`, `approval_warning`, `approval_expired` events
- Countdown timer in `ApprovalCard` with warning color at ≤30s

### Phase 2 — Push notifications via ntfy.sh
- `NotifyClient` in `src/notify.rs` (fire-and-forget, errors logged not propagated)
- Notifies on: approval needed, approval expiring, auto-denied, session ended
- Self-hostable ntfy server supported; no Apple Push/FCM account needed
- Settings screen with topic display and ntfy deep-link

### Phase 3 — Multi-session daemon
- `SessionRegistry`: `Arc<Mutex<HashMap<SessionId, SessionEntry>>>`
- `max_concurrent_sessions` cap (default 4)
- Per-session `session_id` injected into all broadcast events and DB rows
- `kill_session`, `list_sessions`, `session_list_changed` WS messages
- Mobile: horizontal pill switcher; ChatView filters by `activeSessionId`

### Sprint 4 — Multi-provider / agent-agnostic support
- `command` field accepted in `run` WS message; daemon resolves binary (`claude`, `codex`, `gemini`, `aider`, custom)
- Mobile: horizontal agent picker pills (claude / codex / gemini / aider) in session-start UI
- Falls back to `CLAUDE_BIN` env var or `claude` when no command specified

### Sprint 5 — Visual diff review on mobile
- `DiffView.tsx`: collapsible unified diff viewer with +/- line coloring and hunk headers
- Integrated into expanded tool_result blocks in ChatView

### Sprint 6 — Session dashboard
- `SessionCard.tsx`: card with agent label, prompt preview, status dot, elapsed time (live tick)
- `MainScreen`: horizontal FlatList of cards when sessions > 1; falls back to pill row for single session
- `hasPendingApproval` highlights active session card yellow

### Token usage tracking (P2)
- `SessionEntry` gains `input_tokens`/`output_tokens`/`cache_read_tokens` as `Arc<AtomicU64>`
- `claude.rs` parses `usage` fields from JSON stream and accumulates into atomics
- `get_token_usage` WS message returns live counts; `sessions_snapshot` includes totals
- `SessionCard` shows `↑N ↓N` token summary when counts > 0

### Installed skills browser (P2)
- `list_skills` WS message reads `~/.claude/skills/` subdirs, extracts description from `SKILL.md`
- `SkillsScreen.tsx`: FlatList modal (name, description, folder icon, refresh button)
- Accessible via Settings → Browse Skills

### Session history replay (P2)
- `db.rs`: `get_session_list()` and `get_session_events()` query past sessions from SQLite
- `list_past_sessions` / `get_session_history` WS messages
- `SessionHistoryScreen.tsx`: two-panel viewer (session list + read-only event replay)
- Accessible via Settings → Session History

### Scheduled / cron sessions (P2)
- `scheduled_sessions` SQLite table; 30s polling scheduler task in daemon
- `schedule_session` / `cancel_scheduled_session` / `list_scheduled_sessions` WS messages
- `ScheduleScreen.tsx`: +1h/+4h/+8h/+24h quick buttons + custom hours input, pending list with cancel
- Accessible via Settings → Scheduled Sessions

---

## Next Up

### Sprint 7 — Apple Watch approval companion *(P1)*

AgentApprove is the only current tool with watchOS support — it's a standout differentiator. Permit/deny directly from the watch face (no phone unlock) is uniquely compelling for the "AFK and need to unblock an agent" scenario.

**Scope:**
- WatchKit companion target (or React Native Watch bridge)
- Push approval-pending payloads to watch via paired iOS app
- Single-glance: tool name, truncated input, Permit / Deny actions
- Complication showing count of pending approvals

### Sprint 8 — Transport resilience *(P1)*

WebSocket drops on network change (WiFi → cellular, subway tunnels, sleep) were unrecoverable — required manual reconnect and lost session state.

**Shipped (pragmatic reconnect):**
- `useClaudedWS`: exponential backoff auto-reconnect (1s → 30s) on unexpected close
- Last seen `seq` tracked; reconnect sends `attach` with `since=lastSeq` for server-side replay
- Missed events de-duped by existing seq guard; full event history preserved across reconnects
- `shouldReconnectRef` suppresses reconnect on intentional disconnect or auth rejection
- Mobile status bar: yellow "Reconnecting…" badge + 2s green "Reconnected" flash on recovery

**Deferred:** Full mosh/UDP transport (requires separate mosh binary + RN UDP bridge — out of scope for current phase)

---

## Unscheduled Plans

Detailed PRP specs exist in `.claude/PRPs/plans/` but aren't yet slotted into a
sprint. Listed here so they're visible alongside formal work.

| Plan | Area | Priority | One-line scope |
|---|---|---|---|
| `session-ux-improvements` | Mobile | P1 | 5-min lock grace period, fresh-connect view, directory picker wired up |
| `smart-approval-ux` | Mobile | P1 | Batch approve/deny, quick-response button detection, per-hunk diff accept |
| `secrets-management` | Daemon + Mobile | P1 | Encrypted SQLite vault (AES-256-GCM) + per-session env injection |
| `prompt-library-templates` | Daemon + Mobile | P2 | Saved-prompt CRUD + PromptLibraryScreen |
| `file-browser-config-editor` | Daemon + Mobile | P2 | `read_file`/`write_file` WS scoped to `.claude/` + FileBrowserScreen |
| `session-search-kanban-indicators` | Daemon + Mobile | P2 | FTS5 over events, unread badges, kanban view |
| `desktop-stt-offload` | Daemon + Mobile | P3 | GPU-accelerated whisper.cpp on daemon; phone streams audio |

## Unplanned Primitives

Missing from both code and plans as of 2026-04-20 audit. Tracked here so they
don't get lost.

| Primitive | Priority | Notes |
|---|---|---|
| Auth pairing + TLS | P0 | Currently only a static bearer token; see PROMPTS/roadmap-hardening.md Phase 1 |
| Approval policy / allowlist | P1 | Per-tool allow/deny rules to cut notification fatigue |
| Cost guardrails | P1 | Budget caps on top of existing token tracking |
| CI pipeline (test/lint/typecheck) | P1 | Two landed PRs were user-found crashes; add gate |
| Structured logging + rotation | P2 | `tracing` + daily file rotation; required for real ops |
| `/healthz` + `/readyz` | P2 | Table-stakes for systemd/docker/k8s self-hosting |
| WS rate limiting + connection cap | P2 | Token bucket per connection, global max connections |
| Audit log table | P2 | Append-only record of paired/revoked/approve/deny/etc. |
| Session labels / tags | P3 | Group sessions (feature / ops / docs) |
| Session TTL / GC | P3 | Promoted from TODOS.md:50 — `navetted gc` subcommand |
| Webhook outbound surface | P3 | HMAC-signed callbacks for session + approval events |
| MCP server registry | P3 | Daemon-level MCP lifecycle + mobile UI |
| Multi-user / RBAC | Strategic | Direction decision; currently single-tenant by design |
| Tauri desktop client | Strategic | TODOS.md:36; competitive matrix omits desktop column |

---

## Known Bugs

| Bug | Area | Notes |
|---|---|---|
| Directory selector does not work | Mobile / session start | Fixed — server sends plain {type:'dir_listing'} without seq/event wrapper; added top-level handler in ws.onmessage before seq check |

---

## Mobile / Desktop Feature Gaps (audited 2026-04-19)

Features the daemon supports that mobile does not yet expose:

| Gap | Area | Detail |
|---|---|---|
| ~~Free-text mid-session input~~ | ~~Mobile UI~~ | **shipped 2026-04-19** — ChatView input bar; `sendInput()` in useClaudedWS |
| ~~`approval_warning` event~~ | ~~Mobile~~ | **shipped 2026-04-19** — useClaudedWS marks approval `urgent`; ApprovalCard pulses orange border |
| ~~Launch a skill~~ | ~~SkillsScreen~~ | **shipped 2026-04-19** — Per-row Run button fires `/<skill-name>` |
| ~~Custom `work_dir` + `command` override~~ | ~~Session start UI~~ | **shipped 2026-04-19** — Collapsible Advanced panel |
| ~~`dangerously_skip_permissions` toggle~~ | ~~Session start UI~~ | **shipped 2026-04-19** — Switch in Advanced panel with red warning |
| ~~Session history detail~~ | ~~SessionHistoryScreen~~ | **shipped 2026-04-19** — Extracted EventLog component shared with ChatView; full DiffView + tool-use rendering in replay |
| ~~ntfy onboarding flow~~ | ~~SettingsScreen~~ | **shipped 2026-04-19** — Notifications section with topic, deep-link, send-test button; daemon `send_test_notification` WS handler |

---

## Backlog

| Feature | Priority | Notes |
|---|---|---|
| Token usage tracking per session | ~~P2~~ **shipped** | SessionCard shows live ↑/↓ counts; get_token_usage WS message |
| Scheduled / cron sessions | ~~P2~~ **shipped** | ScheduleScreen with quick buttons; 30s daemon polling loop |
| Session recording + replay | ~~P2~~ **shipped** | SessionHistoryScreen reads past events from SQLite |
| Installed skills browser | ~~P2~~ **shipped** | SkillsScreen lists ~/.claude/skills/ with descriptions |
| Mid-session text input | ~~P1~~ **shipped** | ChatView input bar; sendInput() in useClaudedWS |
| Skill launcher | ~~P2~~ **shipped** | SkillsScreen per-row Run button fires /skill-name |
| Session start advanced options | ~~P2~~ **shipped** | Collapsible Advanced panel: work_dir picker, custom command, dangerously_skip toggle |
| Session history diff + tool detail | ~~P2~~ **shipped** | EventLog component shared with ChatView; full DiffView + tool-use blocks in replay |
| approval_warning UI | ~~P2~~ **shipped** | useClaudedWS marks approval urgent; ApprovalCard pulses orange border ≤30s |
| ntfy in-app onboarding | ~~P3~~ **shipped** | Notifications section: topic display + ntfy:// deep-link + send-test button |
| Telegram notification channel | ~~P3~~ **shipped** | NotifyClient::send_telegram via Bot API; broadcasts approval/expiry/session events |
| Voice input (on-device STT) | ~~P3~~ **shipped** | Tap-to-toggle mic via Google on-device Soda recognizer; auto-restarts on silence gaps; text accumulates across sessions; Android 16 Soda workarounds (EXTRA_LANGUAGE_MODEL=web_search, 500ms restart delay) |
| Whisper API fallback for STT | P3 | Cloud-based fallback when on-device STT fails or is unavailable; needs API key config in settings; recording via expo-av + POST to Whisper endpoint |
| Android `.aab` release build + signing | P3 | Current APK is debug-signed; needs keystore + Play Store account |
| Upgrade to Expo 54 / RN 0.81.5+ | P2 | Permanent fix for Android 16 (Sept 2025 patch) permission-hang regression — currently patched via JS check-first workaround in VoiceButton.tsx (facebook/react-native#53898 lands in 0.81.5). Also clears 16KB page-size + ErrorUtils tech debt. |
| iOS App Store submission | P3 | Requires Apple Developer account and TestFlight distribution |

---

## Competitive Context (April 2026)

| Competitor | Self-hosted | No subscription | Android | Multi-agent | Diff review | Watch |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **navetted** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Anthropic Remote Control | ❌ | ❌ ($100+/mo) | ✅ | ❌ | ❌ | ❌ |
| AgentsRoom | ❌ | ❌ | ✅ | ✅ | Partial | ❌ |
| Nimbalyst | ❌ | ❌ | ❌ | Partial | ✅ | ❌ |
| ClawTab | Partial | ✅ (MIT) | ❌ | ✅ | ❌ | ❌ |
| AgentApprove | Partial | ❌ | ❌ | ✅ | ❌ | ✅ |
| Moshi | ✅ (SSH) | ✅ | ❌ | ✅ (SSH) | ❌ | ✅ (webhook) |

**navetted's moat**: The only full-featured option requiring no cloud relay, no vendor subscription, and no Apple Push/FCM account. Works with raw API keys, Bedrock, and Vertex. Anthropic Remote Control's $100+/mo paywall and API-key exclusion are the wedge.

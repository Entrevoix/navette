# Roadmap Hardening Prompt

Paste into Claude Code at your workstation to implement the auth, policy, cost,
CI, iOS/Watch, and polish work queued behind Sprint 7.

---

```
I'm working on navette (Rust daemon `navetted` + React Native mobile client in
/home/user/navette — or wherever this repo lives on your box). Read ROADMAP.md,
TODOS.md, src/*.rs, and mobile/src/ first so you understand the architecture.

Goal: harden the foundation and close the biggest roadmap gaps before Sprint 7
(Apple Watch). Work through the phases below in order. For each phase: plan →
implement → add tests → update ROADMAP.md → commit. Open a separate branch and
PR per phase so I can review incrementally. Do NOT batch multiple phases into
one PR.

================================================================================
PHASE 1 — Auth + TLS between app and daemon  (P0, blocking)
================================================================================

Today the WS server on :7878 appears to accept any connection. README sells
"Tailscale or any network" but the roadmap has no auth entry. Fix this first.

Implement:
- Pairing flow: `navetted pair` CLI command generates a 6-digit code + random
  32-byte token, prints a QR (use `qrcode` crate to stdout). Token is stored
  hashed (argon2id) in a new `paired_devices` SQLite table with columns:
  id, device_label, token_hash, created_at, last_seen_at, revoked_at.
- Mobile: "Pair workstation" screen scans the QR (use expo-camera) or accepts
  manual entry of host:port + 6-digit code. Stores bearer token in
  expo-secure-store. Sends it as `Authorization: Bearer <token>` on WS upgrade.
- Server: WS upgrade handler validates the bearer; reject with 401 + close code
  4401 on mismatch. Emit `auth_failed` event before close so mobile can show a
  clear error instead of a generic reconnect loop.
- TLS: add `--tls-cert` / `--tls-key` flags to navetted. If both present, serve
  `wss://`. If only one present, fail fast with a clear error. Document a
  mkcert-based dev setup in README. Keep plain `ws://` as an explicit opt-in
  via `--insecure` (so Tailscale users aren't forced to run a CA).
- Device management: `list_paired_devices` / `revoke_paired_device` WS messages
  and a Settings → Paired Devices screen with a revoke button per row.

Tests:
- Unit test for token hashing + verification.
- Integration test: unauthenticated WS connection is rejected with 4401.
- Integration test: valid token connects; revoked token is rejected.

Update ROADMAP.md: add "Sprint 7 — Auth + TLS" under Shipped when done, and
remove the implicit assumption that Tailscale is the only deployment.

================================================================================
PHASE 2 — CI pipeline (tests + lint + typecheck)
================================================================================

Both landed PRs (#1 biometric crash, #2 silent STT failure) were user-found
production crashes. Add minimal CI so regressions get caught pre-merge.

Implement (.github/workflows/ci.yml):
- `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` on PRs that
  touch Rust.
- `cd mobile && npm ci && npx tsc --noEmit && npx expo lint` on PRs that touch
  mobile.
- Cache cargo and node_modules.
- Keep runtime under 5 min; split Rust and mobile into parallel jobs.
- No release/build step yet — that's in TODOS.md:44 and can wait.

Add a baseline Rust test suite if one doesn't exist: at minimum cover
SessionRegistry insert/kill/list, approval timeout expiry, and the new auth
path from Phase 1.

================================================================================
PHASE 3 — Approval policy / per-tool allowlist
================================================================================

Auto-deny on timeout doesn't help with notification fatigue. Add a policy layer
so routine tools stop pinging the phone.

Implement:
- New `approval_policies` SQLite table: id, tool_name_glob, path_glob,
  action (allow|deny|prompt), scope (global|session), created_at, expires_at.
- In `hook.rs` (or wherever PreToolUse is handled), evaluate policies before
  broadcasting `approval_pending`. On `allow`, auto-permit silently and emit an
  `approval_auto_allowed` event for transparency. On `deny`, auto-deny the same
  way.
- WS messages: `list_policies`, `add_policy`, `remove_policy`.
- Mobile: Settings → Approval Rules screen. List + add form with tool-name
  picker populated from observed tool names in session history. "Expires in"
  quick buttons (1h / 24h / never).
- On the ApprovalCard, add a "Always allow this tool in this session" quick
  action that creates a session-scoped allow policy inline.

Tests:
- Policy evaluation precedence (session > global, deny > allow on equal specificity).
- Expired policies are ignored.

================================================================================
PHASE 4 — Cost guardrails on top of token tracking
================================================================================

`SessionEntry` already accumulates input/output/cache tokens. Turn that into
caps.

Implement:
- `navetted.toml`: `[budget]` section with `per_session_usd`, `daily_usd`,
  `monthly_usd`, and a `pricing` sub-table mapping model name → {input_per_mtok,
  output_per_mtok, cache_read_per_mtok}. Ship sensible defaults for the current
  Claude/Codex/Gemini lineup.
- Compute running cost from the atomics already in SessionEntry. Broadcast a
  `budget_warning` event at 80% and `budget_exceeded` at 100%. On exceeded: the
  session is paused (refuse to process further user input / tool approvals) and
  requires an explicit `resume_session` WS message to continue.
- Mobile: SessionCard gets a small "$0.42 / $5.00" line when a budget exists.
  Orange at 80%, red at 100%. Pause banner with Resume button when exceeded.

Tests: budget math, 80%/100% threshold broadcasts, resume clears the pause.

================================================================================
PHASE 5 — Session transcript export
================================================================================

Small quality-of-life win. Past sessions are in SQLite but there's no way out.

Implement:
- `export_session` WS message: returns a markdown transcript (user prompts,
  assistant messages, tool calls w/ inputs, diffs as fenced blocks) and a JSON
  dump of raw events.
- Mobile: SessionHistoryScreen gets a share button per session using
  expo-sharing. Markdown by default; long-press for JSON.
- Redact the bearer token and any env-var values if they appear in session
  metadata.

================================================================================
PHASE 6 — iOS parity + Watch (Sprint 7 in ROADMAP.md)
================================================================================

Sprint 7 (Apple Watch, P1) depends on an iOS app, but iOS App Store is P3 in
the backlog. Fix the sequencing.

Implement in this order:
1. iOS build working locally via `npx expo run:ios` — fix any iOS-only issues
   surfaced by the Android-first codebase (keyboard avoidance, safe areas,
   SecureStore keychain access group, expo-camera permission strings).
2. TestFlight distribution via EAS. Document the Apple Developer account
   setup in mobile/README.md.
3. Only then start the WatchKit target. Scope per ROADMAP.md:70 — complication
   + single-glance approval screen + push via APNs from paired iOS app.

If you hit a blocker that requires my Apple Developer credentials, stop and
surface it — don't try to work around it.

================================================================================
PHASE 7 — Smaller items (bundle into one PR)
================================================================================

- Voice output / TTS: use expo-speech to read assistant messages aloud when a
  "Speak responses" toggle is on. Complements the shipped voice input for AFK.
- Bedrock / Vertex validation: add a `provider` field to session start
  (anthropic | bedrock | vertex), wire through to the agent command env, and
  add a smoke-test doc in README showing it working against each. ROADMAP.md
  line 154 claims this works — verify and document.
- Telemetry opt-in (off by default): local ring buffer of last N errors
  accessible via Settings → Diagnostics → Copy logs. No network calls.

================================================================================
Ground rules
================================================================================

- One branch per phase: `feat/phase-1-auth`, `feat/phase-2-ci`, etc.
- Update ROADMAP.md in the same PR as the feature.
- Don't refactor opportunistically. If you see something worth cleaning up,
  note it in TODOS.md and move on.
- Don't add comments that just describe what the code does.
- If a phase turns out bigger than expected, stop and ask before scope-creeping.
- Test on a real Android device for any mobile change — Expo Go is not enough
  for the auth / secure-store / camera surfaces.

Start with Phase 1. Plan it out loud first, then implement.

================================================================================
PHASE 8 — Land the untracked PRP plans
================================================================================

Six PRP plans exist under .claude/PRPs/plans/ but are not in ROADMAP.md. Read
each plan file and ship them in this order (one branch + PR per plan). Update
ROADMAP.md alongside each.

Order (by ratio of user value to scope):

1. session-ux-improvements.plan.md — 5-min lock grace period, fresh-connect
   view, directory picker wired up. Three small papercuts, ship first.
2. smart-approval-ux.plan.md — batch approve/deny, quick-response button
   detection, per-hunk diff accept. Competitive-critical vs. Warp/Nimbalyst.
3. secrets-management.plan.md — encrypted SQLite vault, AES-256-GCM, per-
   session env injection. Depends on Phase 1 auth landing first (share the
   same key-derivation story where possible).
4. prompt-library-templates.plan.md — saved-prompt CRUD + PromptLibraryScreen.
   Wire into session-start so saved prompts show as a picker.
5. file-browser-config-editor.plan.md — read_file/write_file WS restricted to
   `.claude/`, FileBrowserScreen + ConfigEditor. Must NOT allow writes outside
   `.claude/` even with a relative-path escape.
6. session-search-kanban-indicators.plan.md — FTS5 over events, unread badges,
   kanban view. Requires a db migration; ship a one-shot backfill.

Do not combine plans into a single PR even if they're small — each has its own
acceptance story.

================================================================================
PHASE 9 — Operational primitives (logging, health, rate limits)
================================================================================

These are missing from both code and plans. They are table stakes for anyone
actually running navetted as a daemon (systemd, docker, k8s).

Implement:
- Structured logging via `tracing` + `tracing-subscriber`. Log to stdout (for
  systemd/journalctl) AND a rotating file at `~/.local/state/navetted/log/`
  (use `tracing-appender` with daily rotation, keep 14 days).
- Replace every `eprintln!` / `println!` in src/ with `tracing::info!` /
  `tracing::warn!` / `tracing::error!` with span context (session_id where
  available).
- HTTP health endpoint `GET /healthz` on the same listener (serves 200 OK +
  JSON with version, uptime, active_sessions, pending_approvals). No auth.
- HTTP readiness `GET /readyz` that also checks SQLite is writeable.
- Per-connection rate limit on the WS: token bucket, default 30 messages / 10s
  per connection. Exceeding closes with code 4429. Configurable via
  `[limits] ws_messages_per_10s` in navetted.toml.
- Global cap: reject new WS connections past `max_ws_connections` (default 10)
  with code 4503 and a `server_full` event.

Tests: rate-limit cutoff, healthz/readyz shape, log file rotation.

================================================================================
PHASE 10 — Organization primitives (audit, tags, GC)
================================================================================

Sessions and approvals currently live in one flat events table with no audit
lens, no labels, and no cleanup. Fix all three together — they share a
migration.

Implement:
- New `audit_log` table: id, ts, actor (device_id FK), action (paired,
  revoked, approved, denied, auto_denied, policy_added, policy_removed,
  budget_exceeded, session_started, session_killed), target_id, details_json.
  Write an entry from every privileged code path. Never delete rows.
- Settings → Audit Log screen: reverse-chronological list, filter by action.
- Session labels: new `session_labels` table (session_id, label). WS messages
  `add_session_label` / `remove_session_label` / `list_session_labels`.
  SessionCard renders labels as colored chips. Filter pill row by label.
- `navetted gc` subcommand (from TODOS.md:50): deletes events + session_labels
  rows for sessions older than `gc_retention_days` (default 30) AND status in
  DONE/DEAD. Dry-run by default; `--apply` to actually delete. Never deletes
  audit_log rows.
- Scheduled nightly GC task in the daemon (3am local), logs results to
  tracing + audit_log.

Tests: audit row written on every privileged action, GC respects retention +
status, labels survive GC of unrelated sessions.

================================================================================
PHASE 11 — Extension surface (webhooks + MCP)
================================================================================

navette's moat is self-hosted + agent-agnostic. Double down on extensibility.

Implement:
- Webhooks: `[webhooks]` config section with N named endpoints, each with
  url, secret (HMAC-SHA256), and event filter list. Fire on session_started,
  session_ended, approval_pending, approval_decided, budget_warning,
  budget_exceeded. Signed body: `X-Navette-Signature: sha256=...`.
- Settings → Webhooks screen: add/remove/test endpoint, last-delivery status.
- MCP server registry: new `mcp_servers` table (name, command, args_json,
  env_json, enabled, last_health_ok, last_health_at). Daemon spawns enabled
  MCP servers as child processes, proxies stdio to the active Claude session
  via the agent's MCP config. `list_mcp_servers`, `add_mcp_server`,
  `toggle_mcp_server`, `remove_mcp_server` WS messages.
- Settings → MCP Servers screen: list, enable toggle, health dot, add form.

Tests: webhook HMAC verification, MCP server process lifecycle (spawn,
health-check, restart on crash, clean shutdown on daemon exit).

================================================================================
PHASE 12 — Multi-user / team (STRATEGIC — ask me before starting)
================================================================================

This is a direction decision, not just work. Before starting Phase 12, STOP
and ask me whether navette should remain single-user or become multi-tenant.
If yes, the sketch is:

- Users table (id, display_name, created_at).
- Paired devices belong to a user.
- Sessions belong to a user.
- Roles: owner | collaborator | viewer. Approvals require collaborator+.
- Mobile: identity switcher at the top of the settings screen.

Non-goal: SSO/OIDC integration in the first pass — keep it device-pairing-
based. The point is to share a household daemon between a laptop's user and
a partner's phone without giving them the same bearer token.

================================================================================
PHASE 13 — Desktop + distribution polish (decide in/out)
================================================================================

- Tauri desktop app from TODOS.md:36. Three-panel layout (sessions / chat /
  diff). Share `mobile/src/` components where possible. Decide whether desktop
  is in scope before starting — skipping is a valid answer.
- iOS App Store submission per ROADMAP.md:138 (done naturally during Phase 6).
- Android `.aab` signed release per .claude/PRPs/plans/android-aab-release-
  build.plan.md. Follow that plan verbatim.
- CI release pipeline per TODOS.md:44: on tag push, `cargo build --release`
  for linux/amd64 + linux/arm64 (via `cross`), attach to GitHub Release.
  EAS build for mobile (separate workflow).
```

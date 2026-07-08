# Agent-Native Roadmap for navette

Goal: an AI coding agent should be able to take a raw bug report or feature
request against this repo, reproduce it, implement a fix, test it, and verify
it end-to-end with minimal human input.

This file is prioritized by **Human-Attention-Saved per Unit of Effort** —
cheap fixes that remove a recurring point where a human currently has to step
in (to explain tribal knowledge, unblock a build, or eyeball a result) sort
above expensive ones.

Audited 2026-07-07. Stack: Rust daemon (`navetted` + `navetted-hook` binaries,
tokio/tokio-tungstenite/rusqlite), React Native mobile client (Expo), Tauri
desktop client, Flatpak packaging, GitHub Actions CI.

---

## Top 5 — immediately actionable

### 1. Document the Flatpak build workflow in CLAUDE.md
**Effort:** ~15 min (docs only) · **Saves:** every future flatpak-touching task currently requires asking a human what `build-dir` vs `build-dir-fresh` means and how the vendor/offline build actually gets invoked.

CLAUDE.md currently describes `cargo build`/`cargo test` but says nothing about
Flatpak, even though `flatpak/`, `flatpak-repo/`, `build-dir/`,
`build-dir-fresh/`, `.flatpak-builder/`, and two `.flatpak` binaries live at
the repo root. An agent asked to "fix the flatpak packaging" or "why does the
flatpak build fail" has no documented entry point.

- Files: `flatpak/build.sh`, `flatpak/io.entrevoix.navette.json`,
  `flatpak/io.entrevoix.navetted.yml`, `CLAUDE.md`
- Command to verify by reading (do NOT run `flatpak-builder` per instructions):
  `cat flatpak/build.sh` shows the actual sequence: vendor crates → write
  `.cargo-home/config.toml` → `cargo build --release --offline` → install
  binaries into `flatpak-build/`. `flatpak/io.entrevoix.navette.json` is the
  separate Flatpak manifest that runs `cargo build --release --offline
  --frozen` inside the sandbox and installs into `/app/bin`.
- Acceptance criteria: CLAUDE.md gains a "Flatpak / packaging" section stating
  (a) `vendor/` must be re-synced with `cargo vendor vendor/` after any
  `Cargo.toml`/`Cargo.lock` change destined for a flatpak build, (b)
  `build-dir/` and `build-dir-fresh/` are flatpak-builder's own state dirs (not
  hand-edited, safe to delete/regenerate), (c) which manifest
  (`io.entrevoix.navette.json` vs `io.entrevoix.navetted.yml`) is the canonical
  one currently used for release packaging, since two exist side by side.

### 2. Add an integration test that drives the real approval loop end-to-end
**Effort:** ~1-2 hrs · **Saves:** this is the single biggest verification gap — nobody, human or agent, can currently confirm a change to `hook.rs`/`ws.rs`/`claude.rs` didn't break the core approval flow without manually running the daemon and a mobile/WS client by hand.

All 94 existing `#[test]`/`#[tokio::test]` functions (in `db.rs`, `config.rs`,
`claude.rs`, `http.rs`, `notify.rs`, `hook.rs`, `ws.rs`) are unit tests of
individual functions (HMAC verification, token hashing, event framing, DB
queries). There is no `tests/` integration directory and no test that (a)
starts `hook.rs`'s Unix socket listener, (b) spawns `navetted-hook` as a real
subprocess feeding it crafted PreToolUse JSON on stdin, and (c) asserts the
resulting `approval_pending` event, WS broadcast, and exit code (0/2) all
match. This is exactly the "reproduce → verify" loop an agent needs for any
bug report about approvals, timeouts, or the hook binary.

- Files to add: `tests/approval_flow.rs` (new integration test crate dir —
  `cargo test` auto-discovers `tests/*.rs`)
- Approach: reuse the existing `tempfile` dev-dependency to stand up a scratch
  `$XDG_RUNTIME_DIR`, start the hook socket listener from `hook.rs` in-process,
  spawn the built `navetted-hook` binary (via `env!("CARGO_BIN_EXE_navetted-hook")`)
  with stdin JSON, and assert on the returned decision + exit code. A second
  test should drive a decision through the WS side (fake `hello`/`attach`/
  `input` frames over a loopback WS server) to close the loop without needing
  a real mobile client.
- Acceptance criteria: `cargo test` runs and passes a new `approval_flow`
  integration test covering allow, deny, and timeout-auto-deny paths; CI's
  existing `cargo test --all` (`.github/workflows/ci.yml`) picks it up with no
  changes needed.

### 3. Clean up root clutter and gitignore stale build artifacts
**Effort:** ~20 min · **Saves:** every `find`/`grep`/directory-listing an agent runs at repo root currently returns noise from `target/` (11 GB), `.flatpak-builder/` (6.4 GB), `build-dir/`, `build-dir-fresh/`, `repo-fresh/`, `clauded.flatpak`, `relay.flatpak` — multiple near-duplicate flatpak build outputs sitting uncommented at the top level.

`.gitignore` already excludes `/target`, `/vendor/`, `/flatpak-repo/`,
`*.flatpak`, `/repo-fresh/`, `.reports/`, `docs/CODEMAPS/` — so these are
already untracked, but they're still physically present and unexplained,
which costs agent tool-call budget and attention every time a directory
listing or full-repo search is done (confirmed during this audit — a plain
`ls` at repo root returns 15+ build-artifact entries mixed with real source
dirs).

- Action: confirm `build-dir/` and `build-dir-fresh/` are flatpak-builder
  scratch state (both contain identical `export/`, `files/`, `var/`,
  `metadata`) and are safe to delete; add `/build-dir/`, `/build-dir-fresh/`,
  `/.flatpak-builder/` to `.gitignore` if not already covered, and physically
  remove `clauded.flatpak` / `relay.flatpak` (stale build outputs from
  before/during the navette rename — `clauded` and `relay` don't match any
  current binary or crate name) or move them under a single `.build/`
  artifacts directory that's obviously disposable.
- Acceptance criteria: `ls` at repo root shows only source, docs, and config
  directories; a one-line note in CLAUDE.md tells an agent "ignore
  `build-dir*`, `.flatpak-builder/`, `target/` — these are build caches, never
  hand-edit or read them for context."

### 4. Add a session-transcript replay fixture for bug reproduction
**Effort:** ~1 hr · **Saves:** every mobile/UI bug report today ("session card shows wrong status", "approval didn't render") requires a human to manually reproduce it live against a running daemon + phone; there's no way for an agent to reproduce from a bug report alone.

`db.rs` already has `get_session_list()`/`get_session_events()` and the wire
format is just a sequence of JSON events with a `seq`/`ts`. A raw bug report
("here's what happened") could ship as a JSON transcript fixture that gets
replayed straight into a scratch SQLite DB and served over the existing
`list_past_sessions`/`get_session_history` WS messages — letting an agent
reproduce a UI bug without a live PTY/Claude session at all.

- Files: new `tests/fixtures/sessions/*.json` (one file per known bug repro),
  new `scripts/replay_session.sh` (or a `#[test]` in the new `tests/`
  integration dir from item 2) that loads a fixture into a scratch DB via
  `db.rs`'s existing insert functions and starts `ws.rs::serve` against it.
- Acceptance criteria: given a fixture file, `cargo test replay_session` (or
  the equivalent script) starts a daemon instance an agent (or a Playwright
  script against the mobile web build) can connect to and inspect — closing
  the loop from "user pasted a screenshot + description" to "agent has a live
  repro."

### 5. Document the `.claude/PRPs/` plan → review → land workflow, and the roles of ROADMAP.md / TODOS.md / REVIEW_LOG.md
**Effort:** ~20 min (docs only) · **Saves:** an agent picking up a feature request has no documented answer for "where do I write the plan, where do I log the review, when do I update the roadmap" — currently inferred only by reading dozens of existing files in `.claude/PRPs/plans/completed/` and `.claude/PRPs/reviews/`.

The repo has a clear, consistent convention already in practice (plan →
`.claude/PRPs/plans/<name>.plan.md`, review → `.claude/PRPs/reviews/<name>-review.md`,
report → `.claude/PRPs/reports/<name>-report.md`, then move the plan to
`plans/completed/` and add an entry to `ROADMAP.md`'s Shipped section and
`REVIEW_LOG.md`), but it's tribal — never written down. `PROMPTS/roadmap-hardening.md`
references this loosely but isn't the canonical spec. This is exactly the kind
of "not yet codified" chokepoint the audit was asked to find.

- Acceptance criteria: CLAUDE.md gains a short "Planning & review workflow"
  section stating the four file locations, the completion convention (move to
  `completed/`, update `ROADMAP.md` Shipped + `REVIEW_LOG.md`), and that
  `TODOS.md` is for un-scoped/deferred ideas vs. `ROADMAP.md` for
  scheduled/shipped work.

---

## Additional findings (lower ratio, still worth tracking)

- **`ws.rs` is 2151 lines** — WS protocol framing (hello/attach/replay),
  session registry management, TLS acceptor setup, challenge/HMAC auth, and
  dispatch to `capture/` handlers all live in one file, well past the
  repo's own 800-line file-size guidance. An agent scoped to "fix the auth
  challenge" has to read unrelated capture-dispatch and session-list code to
  get there. Recommend splitting into `ws/protocol.rs` (framing +
  hello/attach), `ws/auth.rs` (challenge/HMAC/TLS), `ws/session.rs` (registry,
  `list_sessions`/`kill_session`), leaving `ws.rs` as the top-level `serve()`
  entrypoint that wires them together.
- **`capture/` module is an entangled, undocumented side-feature.** It
  shells out to `claude -p` to enrich `capture/{idea,journal,person}` WS
  messages and writes markdown into a "Carnet sync folder" — a personal
  note-taking feature bolted onto the same WS dispatch table as the core
  approval-relay protocol, and it appears nowhere in CLAUDE.md's Architecture
  section (which only describes the five main.rs tasks). An agent asked to
  work on "the approval flow" could easily misread this as in-scope, or miss
  that changes to `ws.rs`'s message dispatch also touch it. Recommend either
  documenting it explicitly as a separate concern in CLAUDE.md, or extracting
  it to a point where it's opt-in/feature-gated.
- **Duplicate CODEMAPS files.** `docs/CODEMAPS/` has both
  `ARCHITECTURE.md`/`BACKEND.md`/`FRONTEND.md`/`DATABASE.md`/`DEPENDENCIES.md`/`INDEX.md`
  (uppercase) and `architecture.md`/`backend.md`/`frontend.md`/`data.md`/`dependencies.md`
  (lowercase) side by side — likely one generation is stale. An agent using
  codemaps for fast orientation risks reading the wrong (older) copy. The
  whole dir is gitignored (`docs/CODEMAPS/`), so this is a local generation
  artifact, not a tracked inconsistency, but worth a `rm` of whichever set is
  stale before next `update-codemaps` run.
- **CI already covers the basics well.** `.github/workflows/ci.yml` runs
  `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test --all`,
  release build, and mobile `tsc --noEmit` + `jest`, gated behind a single
  `gate` job for branch protection — this part of `PROMPTS/roadmap-hardening.md`
  Phase 2 is already done and doesn't need re-litigating.
- **No `/healthz`-style liveness surface** for the daemon (already flagged in
  `ROADMAP.md`'s "Unplanned Primitives" table as P2) — also relevant to
  agent-native operation: without it, an agent can't cheaply confirm "is
  navetted actually running and healthy" without parsing logs or connecting a
  full WS client.

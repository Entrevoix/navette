# Plan: Secrets Management (Per-Session Env Var Injection)

## Summary
Add a secrets vault to clauded that lets users store named secrets (API keys, tokens) in an encrypted SQLite table, and inject them as environment variables into agent sessions at launch. Secrets are managed via a mobile Settings screen and never appear in logs, event streams, or WS messages beyond masked previews.

## User Story
As a developer who runs agents that need API keys (OpenAI, GitHub, etc.),
I want to securely store and inject secrets into agent sessions,
So that I don't have to SSH in to set env vars or hardcode secrets on the server.

## Problem → Solution
Currently secrets must be pre-configured as env vars on the server or in shell profile → Add a secrets vault with mobile CRUD and per-session injection.

## Metadata
- **Complexity**: Medium
- **Source PRD**: Competitive gap analysis (ClawTab: Keychain/gopass integration, per-job secret injection)
- **PRD Phase**: N/A
- **Estimated Files**: 7-10

---

## UX Design

### Before
```
┌─────────────────────────────┐
│  To use GITHUB_TOKEN:       │
│  1. SSH into server         │
│  2. export GITHUB_TOKEN=... │
│  3. Start agent             │
│  (manual env var setup)     │
└─────────────────────────────┘
```

### After
```
┌─────────────────────────────┐
│  Settings → Secrets         │
│                             │
│  ┌─ Secrets Vault ────────┐ │
│  │ GITHUB_TOKEN   ••••xyz │ │
│  │ OPENAI_KEY     ••••abc │ │
│  │ AWS_SECRET     ••••def │ │
│  │        [+ Add Secret]  │ │
│  └─────────────────────────┘ │
│                             │
│  Session Start:             │
│  [Prompt: ___________]      │
│  ☑ Inject secrets (3)       │
│  [Run]                      │
└─────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Secret storage | SSH + export | Settings → Secrets → Add | Mobile CRUD |
| Session launch | Secrets pre-configured | "Inject secrets" checkbox | Opt-in per session |
| Secret visibility | Full value in shell | Masked in UI (••••last4) | Never shown in full after save |
| Logs / events | Could leak in env | Scrubbed from event stream | Daemon-side filtering |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/claude.rs` | all | How agent processes are spawned — env vars injected here |
| P0 | `src/main.rs` | 37-57 | RunRequest struct — needs secrets field |
| P0 | `src/ws.rs` | 190-260 | Run handler — where secrets are resolved and passed |
| P0 | `src/db.rs` | all | DB patterns for new secrets table |
| P1 | `src/config.rs` | all | Config loading — encryption key derivation |
| P1 | `mobile/src/screens/SettingsScreen.tsx` | all | Settings UI patterns |
| P1 | `mobile/src/screens/MainScreen.tsx` | all | Session start UI — secrets toggle |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| SQLite encryption | sqlcipher or app-level encryption | SQLite doesn't encrypt by default; use app-level encryption for secret values |
| ring crate | docs.rs/ring | Rust crypto library for AES-GCM encryption; derive key from daemon token |

---

## Patterns to Mirror

### DB_TABLE
// SOURCE: src/db.rs:23-31
Standard SQLite table creation in `open()`.

### WS_HANDLER
// SOURCE: src/ws.rs:304-331
Message type matching, JSON response, error handling.

### PROCESS_SPAWN
// SOURCE: src/claude.rs
Agent process spawned with env vars from current environment. Add custom env vars here.

### SETTINGS_SECTION
// SOURCE: mobile/src/screens/SettingsScreen.tsx
Sections with labels, TextInputs, save buttons.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db.rs` | UPDATE | Add `secrets` table + CRUD functions with encryption |
| `src/ws.rs` | UPDATE | Add `list_secrets`, `set_secret`, `delete_secret` handlers; modify `run` to inject |
| `src/main.rs` | UPDATE | Add `inject_secrets` field to RunRequest |
| `src/claude.rs` | UPDATE | Apply secret env vars when spawning agent process |
| `Cargo.toml` | UPDATE | Add `ring` crate for encryption (or use existing `subtle` + `rand`) |
| `mobile/src/types/index.ts` | UPDATE | Add SecretEntry type (name + masked value, never full value) |
| `mobile/src/screens/SecretsScreen.tsx` | CREATE | Secrets vault CRUD screen |
| `mobile/src/screens/SettingsScreen.tsx` | UPDATE | Add "Secrets" nav button |
| `mobile/src/screens/MainScreen.tsx` | UPDATE | Add "Inject secrets" toggle to session start |
| `mobile/src/hooks/useClaudedWS.ts` | UPDATE | Add secret management WS methods |

## NOT Building

- Secret rotation / expiration
- Per-session secret selection (all or nothing for v1)
- Secret sharing between users
- Integration with external vaults (HashiCorp, AWS Secrets Manager)
- Secret templates / groups

---

## Step-by-Step Tasks

### Task 1: Add secrets SQLite table with encryption
- **ACTION**: Create secrets table; encrypt values at rest
- **IMPLEMENT**:
  ```sql
  CREATE TABLE IF NOT EXISTS secrets (
      name       TEXT PRIMARY KEY,
      encrypted  BLOB NOT NULL,
      nonce      BLOB NOT NULL,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL
  );
  ```
  Encryption: AES-256-GCM using a key derived from the daemon's auth token (HKDF).
  Functions: `list_secrets()` (returns names only), `get_secret(name)` (decrypts), `set_secret(name, value)` (encrypts + upsert), `delete_secret(name)`
- **MIRROR**: DB_TABLE (scheduled_sessions)
- **IMPORTS**: `ring::aead`, `ring::hkdf`, `rusqlite`
- **GOTCHA**: Key derivation must be deterministic from daemon token so secrets survive daemon restarts. HKDF with a fixed salt is appropriate here.
- **VALIDATE**: `cargo test` — encrypt, store, decrypt roundtrip

### Task 2: Add WS handlers for secret management
- **ACTION**: CRUD messages for secrets — NEVER send full secret values to client
- **IMPLEMENT**:
  - `list_secrets` → returns `{type: "secrets_list", secrets: [{name, masked, created_at, updated_at}]}`
    - `masked`: last 4 chars with `••••` prefix (e.g., `••••xyz1`)
  - `set_secret` → `{name, value}` → encrypts, stores → returns `{type: "secret_saved", name}`
    - CRITICAL: `value` field is received from client, encrypted, stored. Never echoed back.
  - `delete_secret` → `{name}` → deletes → returns `{type: "secret_deleted", name}`
  - NO `get_secret` message exposed to WS. Secrets are write-only from the client's perspective.
- **MIRROR**: WS_HANDLER patterns
- **IMPORTS**: `crate::db`
- **GOTCHA**: NEVER send the decrypted secret value over WS. Only the daemon reads decrypted values when spawning processes.
- **VALIDATE**: list returns masked values; set stores encrypted; no way to retrieve plaintext via WS

### Task 3: Inject secrets into agent process
- **ACTION**: When `run` message includes `inject_secrets: true`, load and inject all secrets as env vars
- **IMPLEMENT**:
  - In `run` handler: if `inject_secrets` is true, call `db::list_secret_names()` then `db::get_secret(name)` for each
  - Pass decrypted `HashMap<String, String>` to `run_session()`
  - In `claude.rs`: when spawning the process, add each secret to the command's env
  - Secrets never appear in event JSON or logs
- **MIRROR**: PROCESS_SPAWN patterns in claude.rs
- **IMPORTS**: `std::collections::HashMap`
- **GOTCHA**: Must not log secret values. Use `tracing::info!(secret_count = N, "injecting secrets")` — count only, never names or values.
- **VALIDATE**: Agent process has secrets in env; secrets don't appear in events

### Task 4: Add SecretEntry type and WS methods
- **ACTION**: TypeScript types and hook methods for secret management
- **IMPLEMENT**:
  ```typescript
  export interface SecretEntry {
    name: string;
    masked: string;
    created_at: number;
    updated_at: number;
  }
  ```
  Hook methods: `listSecrets()`, `setSecret(name, value)`, `deleteSecret(name)`
- **MIRROR**: Existing WS hook patterns
- **IMPORTS**: SecretEntry
- **GOTCHA**: `value` sent in setSecret is plaintext over WS — WS connection should be trusted (same-network or tunneled). Document this.
- **VALIDATE**: Types compile; methods callable

### Task 5: Create SecretsScreen
- **ACTION**: Secrets vault management screen
- **IMPLEMENT**:
  - FlatList of secrets: name, masked value (••••last4), created date
  - "Add Secret" button → form: name (TextInput), value (secureTextEntry TextInput)
  - Delete: long-press or swipe → confirm delete
  - Edit: tap → shows name (read-only) + new value field + save
  - Warning banner: "Secrets are encrypted at rest. Values cannot be viewed after saving."
  - No "show password" toggle — write-only by design
- **MIRROR**: SETTINGS_SECTION patterns; SkillsScreen FlatList pattern
- **IMPORTS**: FlatList, Modal, TextInput, Pressable, SecureTextEntry
- **GOTCHA**: secureTextEntry for value input; never show decrypted values
- **VALIDATE**: CRUD works; values masked after save

### Task 6: Add secrets toggle to session start
- **ACTION**: Checkbox/switch in session start UI to inject secrets
- **IMPLEMENT**:
  - "Inject secrets (N)" switch below the Advanced panel
  - N = number of stored secrets
  - When enabled, `run` message includes `inject_secrets: true`
  - If 0 secrets stored, show "No secrets configured" with link to Settings
  - Default: enabled if secrets exist
- **MIRROR**: Existing Advanced panel toggle patterns (dangerously_skip_permissions)
- **IMPORTS**: Switch
- **GOTCHA**: Don't default to enabled if user has never configured secrets
- **VALIDATE**: Toggle sends inject_secrets in run message

### Task 7: Add Settings navigation
- **ACTION**: "Secrets" button in SettingsScreen
- **IMPLEMENT**: Follow existing pattern (like Skills, History)
- **MIRROR**: SETTINGS_NAV_PATTERN
- **IMPORTS**: SecretsScreen
- **GOTCHA**: N/A
- **VALIDATE**: Navigation works

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Encrypt/decrypt roundtrip | "my-secret-value" | Same value after decrypt | No |
| list_secrets returns masked | 2 stored secrets | [{name, masked: "••••..."}] | No |
| set_secret stores encrypted | name + value | Row in DB with encrypted blob | No |
| delete_secret removes | Valid name | Row deleted | No |
| WS list_secrets never returns value | list_secrets | No `value` field in response | Yes — SECURITY |
| inject_secrets adds env vars | run with inject_secrets:true | Process env contains secrets | No |
| secrets not in event stream | Agent runs with secrets | Event JSON has no secret values | Yes — SECURITY |

### Edge Cases Checklist
- [ ] 0 secrets — inject toggle hidden or shows "none configured"
- [ ] Secret name with special chars — handled (env var names are restricted)
- [ ] Secret value very long (>10KB) — rejected with error
- [ ] Daemon restart — secrets survive (encrypted in SQLite, key from token)
- [ ] Token changes — secrets unreadable (document this risk)
- [ ] Concurrent set/delete — last write wins

---

## Validation Commands

### Rust Tests
```bash
cargo test
```
EXPECT: All tests pass including encrypt/decrypt roundtrip

### Rust Clippy
```bash
cargo clippy -- -D warnings
```
EXPECT: No warnings

### Mobile Tests
```bash
cd mobile && npx jest
```
EXPECT: All tests pass

### Security Validation
- [ ] WS `list_secrets` response contains no `value` field
- [ ] WS `set_secret` response contains no `value` field
- [ ] Event stream from agent session contains no secret values
- [ ] Daemon logs contain no secret values (only count)
- [ ] SQLite `secrets` table contains only encrypted blobs
- [ ] Decrypted values only exist in agent process env

---

## Acceptance Criteria
- [ ] Secrets encrypted at rest in SQLite
- [ ] CRUD via WS (write-only — no read of plaintext)
- [ ] SecretsScreen shows masked values
- [ ] Session start can inject secrets as env vars
- [ ] Secrets never appear in logs, events, or WS responses
- [ ] All tests pass

## Completion Checklist
- [ ] AES-256-GCM encryption with HKDF key derivation
- [ ] No plaintext secrets in WS messages
- [ ] No plaintext secrets in tracing logs
- [ ] No plaintext secrets in event stream
- [ ] secureTextEntry for value input
- [ ] Write-only design (no "show secret" feature)

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Daemon token change makes secrets unreadable | Low | High | Document that changing token invalidates secrets; provide re-encrypt migration |
| WS transport leaks secrets during set_secret | Medium | Medium | WS is same-network; document that Tailscale/SSH tunnel recommended |
| Env var secrets visible via /proc/PID/environ | Low | Medium | Standard Unix risk; document that server must be trusted |
| ring crate adds build complexity | Low | Low | ring is well-maintained; may need C compiler for some platforms |

## Notes
- Design is intentionally write-only: secrets go in, they never come back out via the API. Only the daemon reads them when spawning processes.
- Future enhancement: per-session secret selection (pick which secrets to inject)
- Future enhancement: secret groups / profiles (e.g., "production" vs "staging")
- ClawTab uses macOS Keychain + gopass; our approach is simpler (SQLite + app-level encryption) but cross-platform

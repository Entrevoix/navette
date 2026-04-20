# Plan: Roadmap Delivery Loop — Sprints 4–8

## Summary
Execute the clauded roadmap sequentially: multi-provider agent support (S4), mobile diff review (S5), session dashboard (S6), Apple Watch approvals (S7), and mosh transport (S8). Each sprint follows the automated delivery loop: GitHub issue → feature branch → implement → test → verify → PR → squash merge → close issue.

## User Story
As a developer running AI coding agents remotely, I want clauded to support multiple agent CLIs, show visual diffs on approval, have a session dashboard, approve from my watch, and maintain connection across network changes, so that clauded is the best self-hosted agent remote control available.

## Problem → Solution
Single-provider, no-diff, flat-list, iOS-only, WebSocket-drop → multi-agent, visual diff, card dashboard, watchOS approvals, mosh resilience.

## Metadata
- **Complexity**: XL (5 sprints, 20+ files)
- **Source PRD**: `ROADMAP.md`
- **PRD Phase**: Sprints 4–8 (Next Up section)
- **Estimated Files**: ~22 files across Rust daemon + React Native mobile

---

## Delivery Loop Protocol

For EVERY sprint:
1. `gh issue create` with acceptance criteria
2. `git checkout -b feature/<name>`
3. Implement — atomic commits with conventional messages
4. `cargo test` (Rust) + `npx tsc --noEmit` (mobile TS) 
5. Self-review diff — no console.log, no TODOs, no hardcoded values
6. `gh pr create --title "feat: <name>"` linked to issue
7. `gh pr merge --squash` → `git branch -d` → `gh issue close`

---

## UX Design

### Before (current state)
```
┌─────────────────────────────────────────┐
│  [Claude Code only]  [pill switcher]    │
│  [Raw terminal ANSI approval cards]     │
│  [Flat session list, no status colors]  │
│  [iOS only]  [WebSocket drops on roam]  │
└─────────────────────────────────────────┘
```

### After (all sprints shipped)
```
┌─────────────────────────────────────────┐
│  [claude|codex|gemini|aider picker]     │
│  [Red/green diff in approval card]      │
│  [Card dashboard: status+elapsed+agent] │
│  [Watch: Permit/Deny on wrist]          │
│  [Mosh: session survives roam]          │
└─────────────────────────────────────────┘
```

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/ws.rs` | 188–248 | `run` message handler — where `command` field goes |
| P0 | `src/claude.rs` | 18–83 | `spawn_and_process` — where agent binary is invoked |
| P0 | `src/config.rs` | 1–168 | Config struct and TOML parsing pattern |
| P0 | `mobile/src/hooks/useClaudedWS.ts` | 73–84 | `run()` callback pattern |
| P0 | `mobile/src/types/index.ts` | 73–101 | Type definitions — follow exactly |
| P1 | `mobile/src/hooks/useClaudedWS.ts` | 115–207 | `processEvent` — add new event types here |
| P1 | `src/ws.rs` | 267–276 | `get_notify_config` handler — pattern for new msg types |
| P2 | `mobile/src/components/ApprovalCard.tsx` | all | Extend for diff view |
| P2 | `mobile/src/screens/MainScreen.tsx` | all | Extend for dashboard |

---

## Patterns to Mirror

### RUST_WS_MESSAGE_HANDLER
```rust
// SOURCE: src/ws.rs:267-276
} else if msg_type == "get_notify_config" {
    let reply = serde_json::to_string(&serde_json::json!({
        "type": "notify_config",
        "topic": cfg.notify.ntfy_topic,
        "base_url": cfg.notify.ntfy_base_url,
    })).unwrap_or_default();
    if sink.send(Message::Text(reply)).await.is_err() {
        break;
    }
}
```

### RUST_RUN_FIELD_EXTRACTION
```rust
// SOURCE: src/ws.rs:198-213
let container = v
    .get("container")
    .and_then(|v| v.as_str())
    .filter(|s| !s.is_empty())
    .map(|s| s.to_string());
let dangerously_skip_permissions = v
    .get("dangerously_skip_permissions")
    .and_then(|v| v.as_bool())
    .unwrap_or(false);
```

### RUST_ERROR_HANDLING
```rust
// SOURCE: src/claude.rs:44-46
let pair = pty_system
    .openpty(PtySize { ... })
    .context("failed to open PTY")?;
```

### RUST_TRACING
```rust
// SOURCE: src/claude.rs:52-53
tracing::info!(container = c, dangerously_skip_permissions, "spawning claude inside distrobox container");
```

### MOBILE_PROCESS_EVENT
```typescript
// SOURCE: mobile/src/hooks/useClaudedWS.ts:115-207
if (event.type === 'approval_pending') {
  const { tool_use_id, expires_at } = event as { type: string; tool_use_id: string; expires_at: number };
  setPendingApprovals((prev: PendingApproval[]) =>
    prev.map((p: PendingApproval) =>
      p.tool_use_id === tool_use_id ? { ...p, expires_at } : p
    )
  );
}
```

### MOBILE_CALLBACK_PATTERN
```typescript
// SOURCE: mobile/src/hooks/useClaudedWS.ts:73-83
const run = useCallback((prompt: string, container?: string, dangerouslySkipPermissions?: boolean, workDir?: string) => {
  if (wsRef.current?.readyState === WebSocket.OPEN) {
    wsRef.current.send(JSON.stringify({
      type: 'run',
      prompt,
      container: container || null,
      dangerously_skip_permissions: dangerouslySkipPermissions ?? false,
      work_dir: workDir || null,
    }));
  }
}, []);
```

### MOBILE_TYPE_DEFINITION
```typescript
// SOURCE: mobile/src/types/index.ts:73-78
export interface SessionInfo {
  session_id: string;
  prompt: string;
  container?: string | null;
  started_at: number;
}
```

---

## Sprint 4 — Multi-Provider Agent Support

### Issue
**Title**: feat: multi-provider agent-agnostic support  
**Acceptance Criteria**:
- [ ] `run` WS message accepts optional `agent` field (string: `claude`, `codex`, `gemini`, `aider`, or custom)
- [ ] Daemon spawns the specified binary instead of always `claude`
- [ ] `CLAUDE_BIN` env var remains as fallback default
- [ ] `SessionInfo` includes `agent_type` field
- [ ] Mobile session-start UI has agent picker (Claude, Codex, Gemini, Aider, Custom)
- [ ] `run()` hook accepts `agentType` param
- [ ] `cargo check` passes; `npx tsc --noEmit` passes

### Files to Change

| File | Action | Change |
|---|---|---|
| `src/ws.rs` | UPDATE | Extract `agent` from `run` msg; pass to `run_session` |
| `src/main.rs` | UPDATE | `SessionEntry` gets `agent_type: String`; `RunRequest` gets `agent: String` |
| `src/claude.rs` | UPDATE | `spawn_and_process` takes `agent: &str`; uses it as binary name |
| `mobile/src/types/index.ts` | UPDATE | Add `agent_type?: string` to `SessionInfo` |
| `mobile/src/hooks/useClaudedWS.ts` | UPDATE | `run()` accepts `agentType?: string`; sends in WS message |
| `mobile/src/screens/MainScreen.tsx` | UPDATE | Add agent picker to RunModal |

### Tasks

#### Task S4-1: Daemon — accept `agent` in `run` message
- **ACTION**: In `src/ws.rs` run handler (line ~198), extract `agent` field
- **IMPLEMENT**:
  ```rust
  let agent = v
      .get("agent")
      .and_then(|v| v.as_str())
      .filter(|s| !s.is_empty())
      .unwrap_or("claude")
      .to_string();
  ```
  Add `agent: String` to `RunRequest` struct in `src/main.rs`. Pass through to `run_session` and `spawn_and_process`.
- **MIRROR**: RUST_RUN_FIELD_EXTRACTION
- **GOTCHA**: `CLAUDE_BIN` env var currently overrides the binary name in `claude.rs:33`. New logic: `agent` field from WS takes precedence over `CLAUDE_BIN`, which stays as fallback for `claude` agent only.
- **VALIDATE**: `cargo check` passes

#### Task S4-2: `spawn_and_process` — use configurable agent binary
- **ACTION**: In `src/claude.rs`, replace hardcoded `claude_bin` logic
- **IMPLEMENT**: Signature becomes `spawn_and_process(agent: &str, ...)`. If `agent == "claude"`, use `CLAUDE_BIN` env (existing behavior). Otherwise use `agent` directly as the binary name. Pass `agent` to `SessionEntry` so it appears in `session_list_changed` events.
- **MIRROR**: RUST_TRACING — log `agent` field in tracing::info
- **GOTCHA**: `distrobox-enter` wrapper still works — it just calls whatever binary the user specified inside the container. No changes needed for container path.
- **VALIDATE**: `cargo check` passes; `cargo test` passes

#### Task S4-3: `SessionEntry` and broadcast — include `agent_type`
- **ACTION**: In `src/main.rs`, add `agent_type: String` to `SessionEntry`. In `sessions_snapshot()`, include it in the JSON.
- **IMPLEMENT**:
  ```rust
  serde_json::json!({
      "session_id": id,
      "prompt": e.prompt,
      "container": e.container,
      "started_at": e.started_at,
      "agent_type": e.agent_type,   // NEW
  })
  ```
- **VALIDATE**: `cargo check` passes

#### Task S4-4: Mobile types and hook
- **ACTION**: Add `agent_type?: string` to `SessionInfo` in `mobile/src/types/index.ts`. Update `run()` in `useClaudedWS.ts` to accept and send `agentType`.
- **IMPLEMENT**:
  ```typescript
  // types/index.ts
  export interface SessionInfo {
    session_id: string;
    prompt: string;
    container?: string | null;
    started_at: number;
    agent_type?: string;  // NEW
  }
  
  // useClaudedWS.ts run signature:
  run: (prompt: string, container?: string, dangerouslySkipPermissions?: boolean, workDir?: string, agentType?: string) => void;
  
  // useClaudedWS.ts send:
  wsRef.current.send(JSON.stringify({
    type: 'run', prompt,
    container: container || null,
    dangerously_skip_permissions: dangerouslySkipPermissions ?? false,
    work_dir: workDir || null,
    agent: agentType || 'claude',  // NEW
  }));
  ```
- **MIRROR**: MOBILE_CALLBACK_PATTERN, MOBILE_TYPE_DEFINITION
- **VALIDATE**: `npx tsc --noEmit` passes

#### Task S4-5: Mobile UI — agent picker in RunModal
- **ACTION**: In `MainScreen.tsx` RunModal, add a row of agent pills before the prompt input
- **IMPLEMENT**: State `const [selectedAgent, setSelectedAgent] = useState<string>('claude')`. Pills: Claude / Codex / Gemini / Aider / Custom. When Custom is selected, show text input for binary name. Pass `selectedAgent` to `run()`.
- **VALIDATE**: Visual check — picker renders, selection updates, run sends correct agent

### Validation Commands
```bash
cargo check
cargo test
cd mobile && npx tsc --noEmit
```

---

## Sprint 5 — Visual Diff Review on Mobile

### Issue
**Title**: feat: visual diff viewer in ApprovalCard for Write/Edit/MultiEdit tools  
**Acceptance Criteria**:
- [ ] `ApprovalCard` detects `Write`, `Edit`, `MultiEdit` tool names
- [ ] For those tools, renders a unified diff view (red removed lines, green added lines)
- [ ] Diff is computed from `old_string`/`new_string` (Edit) or full `content` (Write — shows as new file)
- [ ] Non-diff tools (Bash, Read, Glob, etc.) continue to show existing raw input display
- [ ] Full-screen expandable diff viewer on tap
- [ ] `npx tsc --noEmit` passes

### Files to Change

| File | Action | Change |
|---|---|---|
| `mobile/src/components/DiffView.tsx` | CREATE | Unified diff renderer component |
| `mobile/src/components/ApprovalCard.tsx` | UPDATE | Use DiffView for Write/Edit/MultiEdit |
| `mobile/src/utils/diff.ts` | CREATE | Diff computation from tool_input |

### Tasks

#### Task S5-1: Diff utility
- **ACTION**: Create `mobile/src/utils/diff.ts`
- **IMPLEMENT**:
  ```typescript
  export type DiffLine = { type: 'add' | 'remove' | 'context'; text: string };
  
  export function computeDiff(oldText: string, newText: string): DiffLine[] {
    // Use a simple LCS-based diff.
    // Install `diff` npm package: npm install diff @types/diff
    // import { structuredPatch } from 'diff';
    const patch = structuredPatch('', '', oldText, newText, '', '', { context: 3 });
    const lines: DiffLine[] = [];
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) lines.push({ type: 'add', text: line.slice(1) });
        else if (line.startsWith('-')) lines.push({ type: 'remove', text: line.slice(1) });
        else lines.push({ type: 'context', text: line.slice(1) });
      }
    }
    return lines;
  }
  
  export function toolInputToDiff(toolName: string, input: Record<string, unknown>): DiffLine[] | null {
    if (toolName === 'Edit' || toolName === 'MultiEdit') {
      const old = (input.old_string as string) ?? '';
      const next = (input.new_string as string) ?? '';
      return computeDiff(old, next);
    }
    if (toolName === 'Write') {
      // New file — show all lines as additions
      const content = (input.content as string) ?? '';
      return content.split('\n').map(text => ({ type: 'add' as const, text }));
    }
    return null;
  }
  ```
- **GOTCHA**: `diff` package is a CommonJS module. Import as `const { structuredPatch } = require('diff')` if ESM interop fails. Add `"diff": "^5.2.0"` to package.json.
- **VALIDATE**: `npx tsc --noEmit` passes

#### Task S5-2: DiffView component
- **ACTION**: Create `mobile/src/components/DiffView.tsx`
- **IMPLEMENT**:
  ```typescript
  import React from 'react';
  import { ScrollView, Text, View, StyleSheet } from 'react-native';
  import { DiffLine } from '../utils/diff';
  
  interface DiffViewProps {
    lines: DiffLine[];
    maxLines?: number;
  }
  
  export function DiffView({ lines, maxLines = 80 }: DiffViewProps) {
    const visible = lines.slice(0, maxLines);
    return (
      <ScrollView style={styles.container} horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {visible.map((line, i) => (
            <View key={i} style={[styles.line, styles[line.type]]}>
              <Text style={[styles.lineText, styles[`${line.type}Text`]]}>
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}{line.text}
              </Text>
            </View>
          ))}
          {lines.length > maxLines && (
            <Text style={styles.truncated}>… {lines.length - maxLines} more lines</Text>
          )}
        </View>
      </ScrollView>
    );
  }
  
  const styles = StyleSheet.create({
    container: { maxHeight: 240, backgroundColor: '#0d1117' },
    line: { paddingHorizontal: 8 },
    add: { backgroundColor: '#0d4429' },
    remove: { backgroundColor: '#4a1720' },
    context: {},
    lineText: { fontFamily: 'monospace', fontSize: 12, color: '#c9d1d9' },
    addText: { color: '#3fb950' },
    removeText: { color: '#f85149' },
    truncated: { color: '#8b949e', fontSize: 11, padding: 4 },
  });
  ```
- **VALIDATE**: Component renders without error

#### Task S5-3: Integrate into ApprovalCard
- **ACTION**: In `ApprovalCard.tsx`, import `toolInputToDiff` and `DiffView`. Conditionally render diff instead of raw JSON.
- **IMPLEMENT**: Before the existing tool input display block, compute `const diffLines = toolInputToDiff(toolName, toolInput)`. If `diffLines !== null`, render `<DiffView lines={diffLines} />`. Otherwise render existing raw display.
- **VALIDATE**: Manual test — approve a Write/Edit tool call; confirm red/green diff appears

### Validation Commands
```bash
cd mobile && npm install diff @types/diff
cd mobile && npx tsc --noEmit
```

---

## Sprint 6 — Session Dashboard

### Issue
**Title**: feat: session card dashboard with status, elapsed time, and agent type  
**Acceptance Criteria**:
- [ ] Dashboard shows a scrollable card grid (2 columns) of all sessions
- [ ] Each card shows: agent type badge, first 8 words of prompt, status (running/waiting-approval/done), elapsed time (live counter)
- [ ] Status color-coded: running=blue, waiting-approval=amber, done=gray
- [ ] Tapping a card sets `activeSessionId`
- [ ] Active card has highlighted border
- [ ] Dashboard accessible via tab or button from MainScreen
- [ ] `npx tsc --noEmit` passes

### Files to Change

| File | Action | Change |
|---|---|---|
| `mobile/src/components/SessionCard.tsx` | CREATE | Individual session card |
| `mobile/src/components/SessionDashboard.tsx` | CREATE | Grid dashboard |
| `mobile/src/screens/MainScreen.tsx` | UPDATE | Add dashboard view toggle |
| `mobile/src/types/index.ts` | UPDATE | Add `status` field to `SessionInfo` (optional, derived client-side) |

### Tasks

#### Task S6-1: SessionCard component
- **ACTION**: Create `mobile/src/components/SessionCard.tsx`
- **IMPLEMENT**: Props: `session: SessionInfo`, `isActive: boolean`, `pendingCount: number`, `onPress: () => void`. Shows agent badge (colored pill per agent type), truncated prompt, status derived from `pendingCount > 0 ? 'approval' : 'running'`, elapsed time via `useEffect` + `setInterval(1000)`.
- **VALIDATE**: Renders without type errors

#### Task S6-2: SessionDashboard component
- **ACTION**: Create `mobile/src/components/SessionDashboard.tsx`
- **IMPLEMENT**: Props: `sessions: SessionInfo[]`, `activeSessionId: string | null`, `pendingApprovals: PendingApproval[]`, `onSelectSession: (id: string) => void`. Renders `FlatList` with `numColumns={2}` of `SessionCard`. Empty state: "No active sessions. Start one with ▶".
- **VALIDATE**: Renders with 0, 1, and 4 sessions

#### Task S6-3: Add dashboard toggle to MainScreen
- **ACTION**: In `MainScreen.tsx`, add a view toggle (list icon ↔ grid icon) in the top bar. State `const [showDashboard, setShowDashboard] = useState(false)`. When `showDashboard`, render `SessionDashboard` instead of pill row + ChatView.
- **VALIDATE**: Toggle switches views; tapping a card in dashboard returns to chat view for that session

### Validation Commands
```bash
cd mobile && npx tsc --noEmit
```

---

## Sprint 7 — Apple Watch Approval Companion

### Issue
**Title**: feat: Apple Watch approval companion via react-native-watch-connectivity  
**Acceptance Criteria**:
- [ ] Pending approvals pushed to paired Apple Watch
- [ ] Watch displays tool name + truncated input
- [ ] Permit and Deny actions work from watch face
- [ ] Approval decision propagates back to daemon via existing `decide()` path
- [ ] Works on iOS only; Android path is no-op

### Files to Change

| File | Action | Change |
|---|---|---|
| `mobile/package.json` | UPDATE | Add `react-native-watch-connectivity` |
| `mobile/src/hooks/useWatchApprovals.ts` | CREATE | Watch bridge hook |
| `mobile/src/screens/MainScreen.tsx` | UPDATE | Initialize watch hook |
| `mobile/watch/clauded Watch App/` | CREATE | WatchKit app target (Xcode) |

### Tasks

#### Task S7-1: Install watch connectivity package
- **ACTION**: `npm install react-native-watch-connectivity` then `expo prebuild`
- **GOTCHA**: `react-native-watch-connectivity` requires Xcode project configuration. After `expo prebuild`, open `mobile/ios/clauded.xcworkspace` in Xcode, add a WatchKit App target manually. The React Native bridge communicates via `WCSession`. This is iOS-native; skip for Android builds.
- **VALIDATE**: `npx tsc --noEmit` passes; iOS build compiles

#### Task S7-2: useWatchApprovals hook
- **ACTION**: Create `mobile/src/hooks/useWatchApprovals.ts`
- **IMPLEMENT**:
  ```typescript
  import { useEffect } from 'react';
  import WatchConnectivity from 'react-native-watch-connectivity';
  import { Platform } from 'react-native';
  import { PendingApproval } from '../types';
  
  export function useWatchApprovals(
    approvals: PendingApproval[],
    decide: (id: string, allow: boolean) => void
  ) {
    useEffect(() => {
      if (Platform.OS !== 'ios') return;
      // Push current approvals to watch
      WatchConnectivity.updateApplicationContext({
        pendingApprovals: approvals.slice(0, 5).map(a => ({
          id: a.tool_use_id,
          name: a.tool_name,
          preview: JSON.stringify(a.tool_input).slice(0, 100),
        })),
      }).catch(() => {});
    }, [approvals]);
  
    useEffect(() => {
      if (Platform.OS !== 'ios') return;
      const sub = WatchConnectivity.subscribeToMessages((msg: Record<string, unknown>) => {
        if (msg.type === 'decide' && typeof msg.id === 'string' && typeof msg.allow === 'boolean') {
          decide(msg.id, msg.allow);
        }
      });
      return () => sub.unsubscribe?.();
    }, [decide]);
  }
  ```
- **VALIDATE**: `npx tsc --noEmit` passes

#### Task S7-3: WatchKit app target
- **ACTION**: In Xcode, File → New Target → Watch App. Name: `clauded Watch App`. Add SwiftUI view listing approvals from `WCSession.applicationContext`. Buttons send `{ type: "decide", id: ..., allow: true/false }` via `WCSession.sendMessage`.
- **NOTE**: This is UI-only native code — no automated test possible. Manual verification required: install on paired device, verify approvals appear on watch.
- **VALIDATE**: Xcode build succeeds; watch simulator shows pending approvals

### Validation Commands
```bash
cd mobile && npx tsc --noEmit
# Manual: pair with Apple Watch simulator in Xcode
```

---

## Sprint 8 — Mosh Transport Option

### Issue
**Title**: feat: mosh-based transport for session resilience across network changes  
**Acceptance Criteria**:
- [ ] Daemon optionally starts a mosh server per session (`mosh-server` binary)
- [ ] `ws_port` for mosh control remains unchanged; mosh uses a separate UDP port range
- [ ] `run_accepted` reply includes `mosh_port` and `mosh_key` when mosh is available
- [ ] Mobile connection config has "Use mosh" toggle
- [ ] When mosh enabled, mobile connects via `mosh-client` (or JS mosh implementation)
- [ ] Graceful fallback to WebSocket if `mosh-server` binary not found
- [ ] `cargo check` passes

### Files to Change

| File | Action | Change |
|---|---|---|
| `src/config.rs` | UPDATE | Add `mosh_enabled: bool` (default false) |
| `src/claude.rs` | UPDATE | Optionally spawn `mosh-server` before PTY; capture port+key |
| `src/ws.rs` | UPDATE | Include `mosh_port`/`mosh_key` in `run_accepted` when available |
| `mobile/src/types/index.ts` | UPDATE | Add `mosh_port?: number`, `mosh_key?: string` to run_accepted event |
| `mobile/src/hooks/useClaudedWS.ts` | UPDATE | Handle mosh connection when run_accepted includes mosh fields |
| `mobile/src/screens/ConnectScreen.tsx` | UPDATE | Add mosh toggle to connection config |
| `mobile/src/types/index.ts` | UPDATE | Add `useMosh?: boolean` to `ServerConfig` |

### Tasks

#### Task S8-1: Config — mosh_enabled flag
- **ACTION**: Add `mosh_enabled: bool` to `Config` struct in `src/config.rs`
- **IMPLEMENT**: Read from TOML: `table.get("mosh_enabled").and_then(|v| v.as_bool()).unwrap_or(false)`. Add to generated config string: `mosh_enabled = false\n`.
- **MIRROR**: Config pattern from `approval_ttl_secs` (line 44–48 in config.rs)
- **VALIDATE**: `cargo check` passes

#### Task S8-2: Daemon — spawn mosh-server per session
- **ACTION**: In `src/claude.rs`, before spawning the Claude PTY, optionally launch `mosh-server`
- **IMPLEMENT**:
  ```rust
  // After write_hook_settings(), before opening PTY:
  let mosh_info: Option<(u16, String)> = if cfg.mosh_enabled {
      match spawn_mosh_server() {
          Ok(info) => Some(info),
          Err(e) => {
              tracing::warn!("mosh-server unavailable: {e:#}; falling back to WebSocket");
              None
          }
      }
  } else {
      None
  };
  
  // spawn_mosh_server() runs: mosh-server new -s -c 256
  // Parses stdout for "MOSH CONNECT <port> <key>"
  fn spawn_mosh_server() -> anyhow::Result<(u16, String)> {
      let out = std::process::Command::new("mosh-server")
          .args(["new", "-s", "-c", "256"])
          .output()
          .context("failed to spawn mosh-server")?;
      let stdout = String::from_utf8_lossy(&out.stdout);
      // Parse: "MOSH CONNECT 60001 <base64key>"
      for line in stdout.lines() {
          if let Some(rest) = line.strip_prefix("MOSH CONNECT ") {
              let mut parts = rest.splitn(2, ' ');
              let port: u16 = parts.next().unwrap_or("0").parse().context("bad mosh port")?;
              let key = parts.next().unwrap_or("").to_string();
              return Ok((port, key));
          }
      }
      anyhow::bail!("mosh-server did not output MOSH CONNECT line")
  }
  ```
- **GOTCHA**: `mosh-server` must be installed on the host (`sudo dnf install mosh`). The binary is separate from the daemon — handle absence gracefully.
- **VALIDATE**: `cargo check` passes; unit test: mock mosh-server output, parse correctly

#### Task S8-3: WS — include mosh fields in run_accepted
- **ACTION**: Pass `mosh_info: Option<(u16, String)>` from `run_session` back to ws.rs run_accepted reply
- **IMPLEMENT**: `run_session` returns `Option<(u16, String)>` (or stores in `SessionEntry`). `run_accepted` reply:
  ```rust
  let mut reply_obj = serde_json::json!({"type": "run_accepted", "session_id": session_id});
  if let Some((port, key)) = mosh_info {
      reply_obj["mosh_port"] = port.into();
      reply_obj["mosh_key"] = key.into();
  }
  ```
- **VALIDATE**: `cargo check` passes

#### Task S8-4: Mobile — handle mosh in run_accepted
- **ACTION**: In `useClaudedWS.ts` `processEvent`, when `run_accepted` includes `mosh_port`/`mosh_key` and user has `useMosh` enabled, initiate mosh connection.
- **NOTE**: Pure JS mosh client (`moshjs` / `mosh.js`) is experimental. Recommended approach for MVP: display `mosh_key` and `mosh_port` in UI so user can connect via Blink Shell / Moshi on the same device. Full in-app mosh is a follow-up.
- **IMPLEMENT**:
  ```typescript
  if (event.type === 'run_accepted') {
    const e = event as unknown as { session_id?: string; mosh_port?: number; mosh_key?: string };
    if (e.session_id) setActiveSessionId(e.session_id);
    if (e.mosh_port && e.mosh_key) {
      setMoshInfo({ port: e.mosh_port, key: e.mosh_key });
    }
    return;
  }
  ```
  Add `moshInfo: { port: number; key: string } | null` state and expose in hook result.
- **VALIDATE**: `npx tsc --noEmit` passes

#### Task S8-5: ConnectScreen — mosh toggle
- **ACTION**: Add "Use mosh (requires mosh-server on host)" toggle to `ConnectScreen.tsx`. Store in `ServerConfig.useMosh`. Pass to `run()` call site.
- **VALIDATE**: Toggle persists in AsyncStorage; visual check

### Validation Commands
```bash
cargo check
cargo test
cd mobile && npx tsc --noEmit
```

---

## Testing Strategy

### Rust Unit Tests

| Test | Location | What to Test |
|---|---|---|
| `agent_defaults_to_claude` | `src/ws.rs` `#[cfg(test)]` | Missing `agent` field → defaults to `"claude"` |
| `agent_passed_through` | `src/claude.rs` `#[cfg(test)]` | `agent="codex"` → binary name is `"codex"` |
| `mosh_server_output_parsed` | `src/claude.rs` `#[cfg(test)]` | Parse `"MOSH CONNECT 60001 abc123"` → `(60001, "abc123")` |
| `mosh_server_missing_graceful` | `src/claude.rs` `#[cfg(test)]` | Binary not found → `None`, no panic |

### Mobile Type Tests
- `npx tsc --noEmit` is the primary TypeScript validator — no runtime test framework in current mobile setup.

### Edge Cases Checklist
- [ ] `agent=""` (empty string) → treated as missing → defaults to `claude`
- [ ] `agent="../../evil"` (path traversal) → validate: only alphanumeric + `-_` allowed
- [ ] Diff with 0 lines (empty file) → DiffView renders empty state
- [ ] Diff with 5000 lines → DiffView truncates at `maxLines`
- [ ] mosh-server not installed → fallback logged, session proceeds normally
- [ ] Watch not paired → `useWatchApprovals` is no-op
- [ ] Sprint 7 on Android → `Platform.OS !== 'ios'` guard prevents crash

---

## Validation Commands (Full Suite)

```bash
# Rust — run from repo root
cargo fmt --check
cargo clippy -- -D warnings
cargo check
cargo test

# Mobile TypeScript
cd mobile && npx tsc --noEmit

# APK build (standalone)
cd mobile/android && ./gradlew assembleDebug -PbundleInDebug=true --no-daemon

# Flatpak (Rust daemon)
flatpak-builder --force-clean build-dir flatpak/io.github.bearyjd.relay.json
```

---

## Acceptance Criteria (All Sprints)
- [ ] S4: `agent` field in WS `run` message routes to correct binary; mobile picker works
- [ ] S5: Write/Edit/MultiEdit approvals show red/green diff; other tools unchanged
- [ ] S6: Dashboard grid with status/elapsed/agent; tap switches active session
- [ ] S7: Watch shows pending approvals; Permit/Deny resolves them; Android is no-op
- [ ] S8: `mosh-server` spawned per session when enabled; fallback when unavailable; mobile shows mosh info

## Completion Checklist
- [ ] No `console.log` in mobile code
- [ ] No `unwrap()` in new Rust code (use `?` + `.context()`)
- [ ] All new types in `mobile/src/types/index.ts`
- [ ] All new WS message types follow pattern in `src/ws.rs:267-276`
- [ ] `cargo fmt` run before each PR
- [ ] Each sprint's PR body links to its issue
- [ ] ROADMAP.md updated after each sprint ships

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| S7: Apple Watch requires paid Apple Developer account | High | Blocks Watch deploy | Implement hook + UI; note manual Xcode deploy needed |
| S7: react-native-watch-connectivity expo compatibility | Medium | Build breaks | Test with `expo prebuild` before writing hook code |
| S8: mosh-server UDP ports blocked by firewall | Medium | Mosh unusable | Fallback to WS is always available; document port range |
| S8: JS mosh client not production-ready | High | In-app mosh deferred | MVP shows mosh credentials for external client; full mosh is a follow-up |
| S4: `agent` path traversal (binary injection) | Medium | Security | Validate `agent` matches `^[a-zA-Z0-9_-]+$` before exec |

## Notes
- Sprint order is fixed: S4 (market unlock) → S5 (UX completeness) → S6 (dashboard) → S7 (watch) → S8 (mosh)
- S7 and S8 have hard external dependencies (Apple Developer account, mosh-server installed). If blocked, note explicitly and open follow-up issues rather than pausing the loop.
- The `diff` npm package (S5) is the only new mobile dependency; mosh and watch are native or daemon-side.
- Sprint 4's agent validation (`^[a-zA-Z0-9_-]+$`) is security-critical — do not skip.

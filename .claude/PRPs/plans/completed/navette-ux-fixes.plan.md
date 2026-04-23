# Plan: Navette — Bug Fixes and UX Improvements

## Summary
Comprehensive mobile UX pass across the navette app: transcript copy/share, input area redesign, file attachments, container awareness, Aider removal, advanced tab fixes, skills browsing, context window management, MCP server view, build notifications, and a sweep of low-effort high-value improvements. Touches both the Rust daemon (new WS message types) and the React Native mobile app (new screens, component rewrites, new hooks).

## User Story
As a developer using navette on my phone to control AI coding CLIs on a remote workstation,
I want a polished, feature-complete mobile interface with text selection, file attachments, container awareness, and context management,
So that I can work effectively from my phone without switching to a desktop.

## Problem → Solution
Current state: functional but rough — no text selection, cramped input, no file attach, no container picker, dead Aider option, broken event log share, no context meter, no MCP visibility.
Desired state: polished mobile-first experience with all 12 items addressed plus high-value quick wins from the additional list.

## Metadata
- **Complexity**: XL
- **Source PRD**: N/A (free-form feature request)
- **PRD Phase**: standalone
- **Estimated Files**: ~35 (20 mobile, 5 Rust daemon, 10 new)

---

## Ambiguity Gate — Questions & Decisions

Before implementing, several items need clarification or design decisions. Rather than block the plan, I've documented the decision I'd make and flagged where the user should confirm.

### Q1: File attachments (#3) — CLI behavior
**Decision**: For Claude Code, copy file to work_dir and append `@path/to/file` to the prompt. For Codex/Gemini, same pattern (copy + path reference). Document per-CLI in code comments. No piping — all CLIs support file path references.
**Risk**: If the CLI doesn't have filesystem access to the copied file (e.g., different container). Mitigation: copy to the container's work_dir via the WS `upload_file` message (new daemon endpoint).

### Q2: Container picker (#4) — `distrobox list` output parsing
**Decision**: Add a `list_containers` WS message type. Daemon runs `distrobox list --no-color` and parses the table output (NAME, STATUS, IMAGE columns). Returns JSON array. Mobile renders as a picker sheet.
**Confirm**: Is distrobox always available on the host, or should we also support podman/docker directly?

### Q3: Context window (#8) — token limits
**Decision**: Claude Code doesn't expose max context window size via stream-json. We'll hardcode known limits (200k for Claude 4) and let the user override in settings. Poll `get_token_usage` every 5s during active sessions.
**Confirm**: Is 200k the right default? Should auto-compact send `/compact` as input to the PTY?

### Q4: MCP servers (#9) — data source
**Decision**: Add a `list_mcp_servers` WS message. Daemon reads `~/.claude/settings.json` → `mcpServers` key, and project-level `.mcp.json`. Returns server names + status. Tool lists require actually querying MCP, which is complex — v1 shows config only, marks TODO for live status.

### Q5: Build notifications (#11) — detection heuristic
**Decision**: Watch for `session_ended` events. On session end, if duration > 60s, fire a local notification with success/failure based on the `ok` field. For webhook, POST to configured URL. Pattern matching on build output (gradle, cargo) is a follow-up — the exit code heuristic covers 90% of cases.

---

## UX Design

### Before — Input Area
```
┌────────────────────────────────┐
│ [Agent ▾] [Container___]       │
│ [Work dir ▾] [Advanced ▾]     │
│ ┌──────────────────────┐ [🎤] │
│ │ Enter prompt...      │      │
│ └──────────────────────┘      │
│            [Run ▶]             │
└────────────────────────────────┘
```

### After — Input Area
```
┌────────────────────────────────┐
│ ⬡ claude │ 📦 devbox │ 42%    │  ← status bar: CLI, container, context %
│────────────────────────────────│
│ [attached: schema.sql ✕]       │  ← file chips (when attached)
│ ┌────────────────────────────┐ │
│ │ Enter prompt...            │ │  ← auto-growing TextInput
│ │                            │ │
│ └────────────────────────────┘ │
│  [📎]  [🎤]           [Send ▶]│  ← attach, voice, send — 44pt targets
└────────────────────────────────┘
```

### After — Chat Messages
```
┌────────────────────────────────┐
│ 🤖 assistant            [📋]  │  ← copy button per message
│ Here's the fix:                │
│ ┌──────────────────────── 📋 ┐ │  ← code block with copy
│ │ fn main() { ... }          │ │
│ └────────────────────────────┘ │
│                                │
│ Long-press any text to select  │
└────────────────────────────────┘
│ [Copy All] [Share 📤] [⋯]     │  ← session action bar
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Message text | Not selectable | Long-press selectable + per-message copy | `selectable={true}` on Text |
| Code blocks | Plain text | Syntax highlighted + copy button | Use simple regex highlighter |
| Session transcript | No export | Copy All + Share as Markdown | OS share sheet |
| Input area | Cramped, agent picker inline | Clean row: attach + voice + send, 44pt targets | Redesigned layout |
| File attach | Not available | Attach button → file picker → chips | New feature |
| Container | Free-text input | Picker from `distrobox list` + status indicator | New WS message |
| Aider | Listed in agent picker | Removed | Breaking change (migration) |
| Event log | No share/clear | Share + Clear buttons | Fix + new |
| Work dir | Doesn't apply to session | Applied via `cmd.cwd()` + sticky default | Bug fix |
| Skills | Basic list in modal | Searchable, browsable, detail view + web search | Enhanced |
| Context window | Not visible | Meter + Compact + Clear + Auto-compact | New feature |
| MCP servers | Not visible | New screen listing configured servers | New screen |
| Build notifications | None | Local notification on long session end + webhook | New feature |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `mobile/src/screens/MainScreen.tsx` | 100-150 | Agent picker, state, run flow |
| P0 | `mobile/src/components/ChatView.tsx` | all | Current chat rendering + input |
| P0 | `mobile/src/hooks/useNavettedWS.ts` | all | All WS message handling |
| P0 | `mobile/src/types/index.ts` | all | All TypeScript interfaces |
| P0 | `src/ws.rs` | all | All WS message handlers |
| P0 | `src/claude.rs` | 60-100 | CLI spawning, work_dir, container |
| P1 | `mobile/src/components/EventLog.tsx` | all | Event rendering, ToolCallRow |
| P1 | `mobile/src/components/EventFeed.tsx` | all | Live event feed |
| P1 | `mobile/src/screens/SkillsScreen.tsx` | all | Current skills implementation |
| P1 | `mobile/src/screens/SettingsScreen.tsx` | all | Current settings |
| P1 | `mobile/src/components/VoiceButton.tsx` | all | Voice input, layout reference |
| P1 | `mobile/src/components/DirPicker.tsx` | all | Directory browsing pattern |
| P2 | `src/config.rs` | all | Config schema, defaults |
| P2 | `src/db.rs` | all | SQLite schema, queries |
| P2 | `src/notify.rs` | all | ntfy/Telegram notification pattern |
| P2 | `mobile/src/components/ApprovalCard.tsx` | all | Swipe gesture pattern |

---

## Patterns to Mirror

### NAMING_CONVENTION
```typescript
// SOURCE: mobile/src/screens/MainScreen.tsx:108-109
const AGENTS = ['claude', 'codex', 'gemini', 'aider'] as const;
type AgentName = typeof AGENTS[number];
```
Pattern: const array `as const` + derived type. PascalCase components, camelCase state.

### ERROR_HANDLING
```typescript
// SOURCE: mobile/src/hooks/useNavettedWS.ts (reconnect pattern)
// Exponential backoff: 1s → 2s → 4s → ... → 30s max
// On error: set status to 'error', schedule reconnect
```

### WS_MESSAGE_PATTERN
```rust
// SOURCE: src/ws.rs:400-420 (handling a new message type)
"list_skills" => {
    let skills_dir = dirs::home_dir()
        .map(|h| h.join(".claude").join("skills"));
    // ... enumerate, build JSON, send response
    let resp = serde_json::json!({ "type": "skills_list", "skills": skills });
    let _ = ws_tx.send(Message::Text(serde_json::to_string(&resp).unwrap())).await;
}
```
Pattern: match on `msg_type`, build JSON response, send via `ws_tx`.

### COMPONENT_PATTERN
```typescript
// SOURCE: mobile/src/components/ApprovalCard.tsx
// Props interface → function component → styles at bottom
interface ApprovalCardProps {
  approval: PendingApproval;
  onDecide: (tool_use_id: string, allow: boolean) => void;
}
export function ApprovalCard({ approval, onDecide }: ApprovalCardProps) { ... }
const styles = StyleSheet.create({ ... });
```

### TEST_STRUCTURE
```typescript
// SOURCE: mobile/src/components/__tests__/DiffView.test.tsx
import { render } from '@testing-library/react-native';
import { DiffView } from '../DiffView';
describe('DiffView', () => {
  it('renders added lines in green', () => { ... });
});
```

---

## Files to Change

### Rust Daemon
| File | Action | Justification |
|---|---|---|
| `src/ws.rs` | UPDATE | Add `list_containers`, `upload_file`, `list_mcp_servers` handlers |
| `src/claude.rs` | UPDATE | Ensure work_dir flows correctly, add container verification |
| `src/config.rs` | UPDATE | Add `webhook_url`, `auto_compact_threshold` fields |
| `src/notify.rs` | UPDATE | Add webhook POST on session end |
| `src/main.rs` | UPDATE | Wire new WS message types |

### Mobile App — Updated Files
| File | Action | Justification |
|---|---|---|
| `mobile/src/screens/MainScreen.tsx` | UPDATE | Remove Aider, add status bar, rewire input area |
| `mobile/src/components/ChatView.tsx` | UPDATE | Redesign input area, add attach button, selectable text |
| `mobile/src/components/EventFeed.tsx` | UPDATE | Add per-message copy, selectable text |
| `mobile/src/components/EventLog.tsx` | UPDATE | Add share + clear buttons |
| `mobile/src/hooks/useNavettedWS.ts` | UPDATE | Add handlers for new WS types, token polling |
| `mobile/src/types/index.ts` | UPDATE | Add new interfaces |
| `mobile/src/screens/SettingsScreen.tsx` | UPDATE | Add webhook URL, auto-compact toggle, theme |
| `mobile/src/screens/SkillsScreen.tsx` | UPDATE | Add search, detail view, web search button |
| `mobile/src/components/VoiceButton.tsx` | UPDATE | Layout adjustments for new input row |
| `mobile/App.tsx` | UPDATE | Add notification listeners |

### Mobile App — New Files
| File | Action | Justification |
|---|---|---|
| `mobile/src/components/StatusBar.tsx` | CREATE | Container + CLI + context % indicator |
| `mobile/src/components/FileChip.tsx` | CREATE | Attached file preview chip |
| `mobile/src/components/ContextMeter.tsx` | CREATE | Token usage meter |
| `mobile/src/components/MessageBubble.tsx` | CREATE | Selectable message with copy button |
| `mobile/src/components/CodeBlock.tsx` | CREATE | Syntax-highlighted code with copy |
| `mobile/src/screens/ContainerPickerScreen.tsx` | CREATE | Distrobox container selector |
| `mobile/src/screens/McpServersScreen.tsx` | CREATE | MCP server list (read-only) |
| `mobile/src/hooks/useTokenPolling.ts` | CREATE | Poll get_token_usage periodically |
| `mobile/src/hooks/useNotifications.ts` | CREATE | Local notification + webhook firing |
| `mobile/src/utils/transcript.ts` | CREATE | Markdown export of session transcript |

### Tests
| File | Action | Justification |
|---|---|---|
| `mobile/src/components/__tests__/MessageBubble.test.tsx` | CREATE | Text selection, copy |
| `mobile/src/components/__tests__/CodeBlock.test.tsx` | CREATE | Highlight, copy |
| `mobile/src/components/__tests__/StatusBar.test.tsx` | CREATE | Container/CLI display |
| `mobile/src/components/__tests__/ContextMeter.test.tsx` | CREATE | Token display |
| `mobile/src/utils/__tests__/transcript.test.ts` | CREATE | Markdown export |

## NOT Building
- Full syntax highlighting library (use simple regex-based coloring for keywords/strings)
- MCP server enable/disable toggles (v1 is read-only, TODO noted)
- Build output pattern matching (use exit code heuristic only)
- Camera/photo library picker for attachments (file picker only in v1)
- Landscape/tablet split-view layout
- Share sheet integration (receiving files from other apps)
- Settings import/export
- Onboarding flow
- Cost/token tracking for non-Claude CLIs
- Multiple concurrent session tabs (existing multi-session via session list is sufficient)

---

## Step-by-Step Tasks

### Task 1: Remove Aider from agent picker
- **ACTION**: Remove 'aider' from AGENTS array and all related UI
- **IMPLEMENT**: In `MainScreen.tsx:108`, change to `['claude', 'codex', 'gemini'] as const`. Search for any Aider-specific code paths (there are none in daemon — Aider was UI-only).
- **MIRROR**: NAMING_CONVENTION pattern
- **IMPORTS**: None new
- **GOTCHA**: Saved configs may have `aider` as selected agent. Add migration: if stored agent is 'aider', reset to 'claude'.
- **VALIDATE**: Build mobile, verify 3 agents in picker, no Aider references in codebase

### Task 2: Transcript utility — Markdown export
- **ACTION**: Create `mobile/src/utils/transcript.ts` with functions to convert EventFrame[] to Markdown
- **IMPLEMENT**: `exportTranscriptMarkdown(events: EventFrame[], sessionId: string): string` — walks events, formats assistant text blocks with `## Assistant` headers, tool calls as fenced code blocks, timestamps as comments. Also `copyMessageText(event: ClaudeEvent): string` for single-message copy.
- **MIRROR**: Type patterns from `types/index.ts`
- **IMPORTS**: `EventFrame, AssistantEvent, TextBlock, ToolUseBlock` from `../types`
- **GOTCHA**: Tool results can be huge (50k+). Truncate at 10k chars in export with `…[truncated]` marker.
- **VALIDATE**: Unit test with sample events → expected Markdown output

### Task 3: MessageBubble — selectable text with copy
- **ACTION**: Create `mobile/src/components/MessageBubble.tsx`
- **IMPLEMENT**: Wraps assistant text in `<Text selectable={true}>`. Adds a copy icon button (top-right) that copies text via `expo-clipboard`. For tool_use blocks, renders tool name + summary. For code blocks within text, extracts fenced code and renders with CodeBlock component.
- **MIRROR**: COMPONENT_PATTERN from ApprovalCard
- **IMPORTS**: `Clipboard` from `expo-clipboard`, `Pressable, Text, View, StyleSheet` from RN
- **GOTCHA**: `selectable={true}` on Android can interfere with ScrollView touch. Wrap in `<View>` with `onStartShouldSetResponder` returning false.
- **VALIDATE**: Long-press selects text, copy button copies to clipboard

### Task 4: CodeBlock — syntax-highlighted code with copy
- **ACTION**: Create `mobile/src/components/CodeBlock.tsx`
- **IMPLEMENT**: Simple regex-based highlighting: keywords (function, const, let, if, else, return, import, export, for, while, class, struct, fn, pub, use, mod) in blue, strings in green, comments in gray, numbers in orange. Copy button copies raw code. Language label from fence info string.
- **MIRROR**: COMPONENT_PATTERN
- **IMPORTS**: `expo-clipboard`, basic RN
- **GOTCHA**: Don't add a heavy dependency like `react-native-syntax-highlighter`. Keep it simple — regex on lines.
- **VALIDATE**: Renders code with colors, copy works

### Task 5: Redesign ChatView input area
- **ACTION**: Rewrite input section of `ChatView.tsx`
- **IMPLEMENT**: 
  - TextInput: `multiline`, `maxHeight={120}`, grows with content
  - Bottom row: `[📎 Attach] [🎤 Voice] [spacer] [Send ▶]` — all 44pt min touch targets
  - Attach button opens `DocumentPicker.getDocumentAsync()` (expo-document-picker)
  - File chips row above input when files attached (FileChip component)
  - Move agent picker + container to StatusBar (Task 7)
  - Keep Advanced toggle but move to header menu (⋯)
- **MIRROR**: Current ChatView structure, COMPONENT_PATTERN
- **IMPORTS**: `expo-document-picker`, new FileChip component
- **GOTCHA**: `KeyboardAvoidingView` behavior differs iOS/Android. Use `behavior="padding"` on iOS, `behavior="height"` on Android. Test both.
- **VALIDATE**: Input grows to 4 lines then scrolls. Buttons have 44pt targets. Keyboard doesn't cover input.

### Task 6: FileChip component
- **ACTION**: Create `mobile/src/components/FileChip.tsx`
- **IMPLEMENT**: Shows filename + size + remove (✕) button. Props: `{ name: string, size: number, onRemove: () => void }`. Styled as a pill/chip.
- **MIRROR**: COMPONENT_PATTERN
- **IMPORTS**: Basic RN
- **GOTCHA**: Filename may be long — truncate with ellipsis at 20 chars
- **VALIDATE**: Renders chip, remove button works

### Task 7: StatusBar — container, CLI, context meter
- **ACTION**: Create `mobile/src/components/StatusBar.tsx`
- **IMPLEMENT**: Horizontal bar below header: `[CLI icon + name] [container name or "host"] [context % meter]`. CLI name from selectedAgent state. Container from session or picker. Context % from useTokenPolling hook. Tapping container opens ContainerPicker. Tapping context meter shows detail popup.
- **MIRROR**: COMPONENT_PATTERN
- **IMPORTS**: New `useTokenPolling` hook, `ContextMeter` component
- **GOTCHA**: When no session running, show "idle" state. Don't poll tokens when idle.
- **VALIDATE**: Shows correct CLI, container, percentage updates during session

### Task 8: ContextMeter component
- **ACTION**: Create `mobile/src/components/ContextMeter.tsx`
- **IMPLEMENT**: Horizontal progress bar showing `used / total` tokens. Color: green <60%, yellow 60-80%, red >80%. Props: `{ inputTokens: number, outputTokens: number, cacheTokens: number, maxTokens: number }`. Display: `{totalUsed}k / {max}k ({pct}%)`.
- **MIRROR**: COMPONENT_PATTERN
- **IMPORTS**: Basic RN + `Animated` for smooth bar transitions
- **GOTCHA**: Total used = input + output (cache_read doesn't count toward limit). Max defaults to 200000.
- **VALIDATE**: Bar fills proportionally, color changes at thresholds

### Task 9: useTokenPolling hook
- **ACTION**: Create `mobile/src/hooks/useTokenPolling.ts`
- **IMPLEMENT**: Accepts WS send function + activeSessionId. Every 5s when session is running, sends `get_token_usage` message. Stores latest response in state. Returns `{ inputTokens, outputTokens, cacheTokens }`. Clears on session end.
- **MIRROR**: Custom hook pattern from useNavettedWS
- **IMPORTS**: `useState, useEffect, useRef` from React
- **GOTCHA**: Don't poll when session is idle. Clear interval on unmount. Deduplicate — don't send if previous request still pending.
- **VALIDATE**: Tokens update every 5s during active session, stop on idle

### Task 10: Add `list_containers` WS handler to daemon
- **ACTION**: Add new message type in `src/ws.rs`
- **IMPLEMENT**: On `"list_containers"` message, run `distrobox list --no-color` via `tokio::process::Command`. Parse output table (skip header row, split on `|`, extract NAME column). Return `{ "type": "containers_list", "containers": [{"name": "...", "status": "...", "image": "..."}] }`. Include a `{"name": "", "display": "host (no container)"}` entry.
- **MIRROR**: WS_MESSAGE_PATTERN (like `list_skills`)
- **IMPORTS**: `tokio::process::Command`
- **GOTCHA**: `distrobox` may not be installed. If command fails, return empty list with `error` field. Parse carefully — output format may vary.
- **VALIDATE**: `cargo test`, manual test with `wscat`

### Task 11: ContainerPickerScreen
- **ACTION**: Create `mobile/src/screens/ContainerPickerScreen.tsx`
- **IMPLEMENT**: Modal sheet (like SkillsScreen pattern). On open, sends `list_containers` WS message. Renders FlatList of containers with name, status, image. "Host (no container)" option at top. Selected container highlighted. On select, updates container state and closes. Shows loading spinner while fetching. Error state if daemon can't list containers.
- **MIRROR**: SkillsScreen modal pattern
- **IMPORTS**: `FlatList, Modal, Pressable, Text, View` from RN
- **GOTCHA**: Add `containers` and `onListContainers` to useNavettedWS return type + MainScreen props
- **VALIDATE**: Opens, shows containers, selection persists

### Task 12: Container verification on session start
- **ACTION**: Update daemon `src/claude.rs` to verify container before spawning
- **IMPLEMENT**: Before spawning the CLI, if container is set, run `distrobox-enter --name {container} -- hostname` with a 10s timeout. If it fails or times out, emit a `session_error` event with the error message and don't spawn the CLI. Return `{ "type": "run_error", "error": "Container 'xyz' is not running or not accessible" }`.
- **MIRROR**: Error handling in claude.rs
- **IMPORTS**: `tokio::process::Command`, `tokio::time::timeout`
- **GOTCHA**: Don't block the WS handler — spawn verification as a task. Container might need to be started first (`distrobox-enter` auto-starts stopped containers, so this may "just work").
- **VALIDATE**: Attempt to run in non-existent container → get error in mobile UI

### Task 13: Fix work directory application
- **ACTION**: Verify and fix work_dir handling in daemon + mobile
- **IMPLEMENT**: In `claude.rs:88-89`, `cmd.cwd(dir)` is already implemented and should work. The bug is likely on the mobile side — verify `workDir` is passed in the `run` WS message. In `MainScreen.tsx`, verify `onRun` sends `work_dir`. Add sticky persistence: save last-used work_dir to AsyncStorage per container. Auto-populate from `list_dir` response for container home.
- **MIRROR**: AsyncStorage pattern used for `navette_last_config`
- **IMPORTS**: `AsyncStorage` from `@react-native-async-storage/async-storage`
- **GOTCHA**: Work dir must exist on the remote host (or inside the container). Validate before run by sending `list_dir` — if it fails, show warning.
- **VALIDATE**: Set work dir → run session → verify `cwd` is correct in the session

### Task 14: Event log share button
- **ACTION**: Add Share + Clear buttons to EventLog.tsx
- **IMPLEMENT**: 
  - Share: Convert visible events to plain text (timestamp + type + summary per line). Use `Share.share({ message: text })` from React Native.
  - Clear: Confirmation Alert, then call a callback to clear events from parent state.
  - Layout: Button row at top of EventLog: `[Share 📤] [Clear 🗑]`
- **MIRROR**: Share API usage, COMPONENT_PATTERN
- **IMPORTS**: `Share, Alert` from `react-native`
- **GOTCHA**: On Android, `Share.share` requires `message` (not `url`). Large event logs may hit share limits — truncate to last 500 events.
- **VALIDATE**: Share opens OS share sheet with event text. Clear shows confirmation then empties log.

### Task 15: Session-level Copy All + Share
- **ACTION**: Add action bar to ChatView with Copy All and Share buttons
- **IMPLEMENT**: Below the event feed, add a sticky bottom bar: `[Copy All] [Share 📤]`. Copy All uses `Clipboard.setStringAsync(exportTranscriptMarkdown(events))`. Share uses `Share.share({ message: exportTranscriptMarkdown(events) })`. Both use the transcript utility from Task 2.
- **MIRROR**: COMPONENT_PATTERN
- **IMPORTS**: `expo-clipboard`, `Share` from RN, `exportTranscriptMarkdown` from utils
- **GOTCHA**: Don't show bar when no events. Haptic feedback on copy.
- **VALIDATE**: Copy All → paste shows Markdown transcript. Share opens OS sheet.

### Task 16: Update ChatView to use MessageBubble + CodeBlock
- **ACTION**: Replace inline text rendering in ChatView with MessageBubble
- **IMPLEMENT**: In the event rendering loop, wrap assistant text in `<MessageBubble>`. Parse text content for fenced code blocks (` ```lang\n...\n``` `) and render those segments as `<CodeBlock>`. Non-code segments as `<Text selectable>`.
- **MIRROR**: Current rendering in ChatView lines 80-130
- **IMPORTS**: MessageBubble, CodeBlock
- **GOTCHA**: Preserve existing ToolCallRow rendering for tool_use blocks. Only change text block rendering.
- **VALIDATE**: Messages show with copy buttons, code blocks highlighted, text selectable

### Task 17: Enhanced SkillsScreen — search + detail + web
- **ACTION**: Upgrade SkillsScreen with search bar, detail view, web search
- **IMPLEMENT**: 
  - Add TextInput search bar at top that filters skills by name/description
  - On tap, show detail modal with full description (currently only shows name + one-line desc)
  - Add "Search the web" button in detail that opens `Linking.openURL('https://www.google.com/search?q=claude+code+skill+' + encodeURIComponent(skill.name))`
  - Sort skills alphabetically
- **MIRROR**: Current SkillsScreen pattern
- **IMPORTS**: `Linking` from RN, `TextInput` from RN
- **GOTCHA**: Skill description comes from first non-comment line of SKILL.md — may be empty. Show "No description" fallback.
- **VALIDATE**: Search filters list, detail shows full desc, web search opens browser

### Task 18: Context window actions — Compact + Clear
- **ACTION**: Add Compact and Clear Context buttons to StatusBar/ContextMeter
- **IMPLEMENT**: 
  - Compact: Sends `/compact` as input to the active PTY session via `sendInput` (existing WS `input` message type — but this is for approvals, not text input). **Alternative**: Add a new `send_text` WS message that writes text to the PTY stdin. Daemon handler: `pty_writer.write_all(b"/compact\n")`.
  - Clear Context: Kills current session and starts a new one with same prompt/container/workdir. Previous transcript preserved in ChatView (already works — events persist in SQLite).
  - Auto-compact: In settings, toggle + threshold slider (default 80%). useTokenPolling checks threshold and auto-fires compact.
- **MIRROR**: WS_MESSAGE_PATTERN for new daemon handler
- **IMPORTS**: None new on daemon side (reuse PTY writer channel)
- **GOTCHA**: `/compact` is a Claude Code slash command — must be sent as text input, not a WS control message. Need to add `send_text` WS type that writes to PTY stdin.
- **VALIDATE**: Compact button sends `/compact`, context % drops. Clear starts fresh session.

### Task 19: Add `send_text` WS handler to daemon
- **ACTION**: Add handler in `src/ws.rs` for sending arbitrary text to PTY stdin
- **IMPLEMENT**: On `"send_text"` message with `{ "text": "...", "session_id": "..." }`, look up the session's PTY writer channel, send text + newline. This enables the mobile app to send slash commands like `/compact`.
- **MIRROR**: WS_MESSAGE_PATTERN, similar to how `input` (approval) is handled
- **IMPORTS**: Need to expose PTY writer handle from session — add `pty_tx: mpsc::Sender<String>` to SessionEntry
- **GOTCHA**: This is essentially a raw terminal input. Validate that the session exists and is running. Rate-limit to prevent abuse.
- **VALIDATE**: Send `/compact` via WS → Claude processes it

### Task 20: McpServersScreen
- **ACTION**: Create `mobile/src/screens/McpServersScreen.tsx`
- **IMPLEMENT**: Modal screen. Sends `list_mcp_servers` WS message. Displays FlatList of servers with name, status badge (configured/unknown), and tool count (if available). Status is just "configured" for v1 since we can't query live MCP status without more daemon work. Add TODO comment for live status + enable/disable toggles.
- **MIRROR**: SkillsScreen modal pattern
- **IMPORTS**: Standard RN components
- **GOTCHA**: Need to add `list_mcp_servers` handler to daemon that reads `~/.claude/settings.json`. JSON parsing of Claude settings file — may not exist, handle gracefully.
- **VALIDATE**: Shows configured MCP servers from settings.json

### Task 21: Add `list_mcp_servers` WS handler to daemon
- **ACTION**: Add handler in `src/ws.rs`
- **IMPLEMENT**: Read `~/.claude/settings.json`, parse JSON, extract `mcpServers` object. For each key, return `{ name, command, args, env_count }`. Also check for project-level `.mcp.json` if work_dir is set. Return `{ "type": "mcp_servers_list", "servers": [...] }`.
- **MIRROR**: WS_MESSAGE_PATTERN
- **IMPORTS**: `std::fs`, `serde_json`
- **GOTCHA**: File may not exist. `mcpServers` structure: `{ "name": { "command": "...", "args": [...], "env": {...} } }`. Don't send env values (may contain secrets) — just the count.
- **VALIDATE**: Returns server list matching ~/.claude/settings.json

### Task 22: Build completion notifications
- **ACTION**: Create `mobile/src/hooks/useNotifications.ts` + update daemon notify.rs
- **IMPLEMENT**: 
  - Mobile: Listen for `session_ended` events. If session duration > 60s, trigger local notification via `expo-notifications`. Title: "Session complete", body: success/failure + duration.
  - Daemon: On `session_ended`, if `webhook_url` is configured, POST JSON `{ "status": ok ? "success" : "failure", "session_id", "duration_secs", "prompt" }`.
  - Settings: Add webhook URL field in SettingsScreen.
- **MIRROR**: notify.rs pattern for HTTP POST
- **IMPORTS**: `expo-notifications` (mobile), `reqwest` (daemon, already a dep)
- **GOTCHA**: `expo-notifications` requires setup in app.json (notification permissions, icon). On Android, need a notification channel. Test on real device — emulators may not show notifications.
- **VALIDATE**: Long session ends → notification appears. Webhook URL receives POST.

### Task 23: Config migration for Aider removal + new fields
- **ACTION**: Update `src/config.rs` to add new fields with defaults
- **IMPLEMENT**: Add `webhook_url: Option<String>` and `auto_compact_threshold: Option<u8>` (default None/80) to Config struct. Existing configs without these fields will deserialize fine (Option fields default to None). No migration needed for Aider — it was never in the daemon config.
- **MIRROR**: Existing config.rs deserialization pattern
- **IMPORTS**: None new
- **GOTCHA**: Use `#[serde(default)]` on new Option fields
- **VALIDATE**: Old config.toml loads without error, new fields accessible

### Task 24: Quick wins from additional improvements list
- **ACTION**: Implement low-effort, high-value items from list #12
- **IMPLEMENT**:
  - **Syntax highlighting**: Done in Task 4 (CodeBlock)
  - **Pull-to-refresh**: Add `refreshControl` prop to ChatView ScrollView → triggers reconnect
  - **Connection status indicator**: StatusBar already shows status; add pulsing dot (green/yellow/red) based on WS connection state
  - **Haptic feedback**: Already exists on ApprovalCard. Add to Send button (`expo-haptics` `impactAsync(ImpactFeedbackStyle.Light)`)
  - **Theme toggle**: Add setting for system/light/dark. Wrap app in ThemeContext. Apply to StyleSheet. Use `useColorScheme()` for system default.
  - **Prompt templates**: Add a `[⚡]` button next to input that shows a modal with user-defined snippets (stored in AsyncStorage). Ship 5 defaults: "fix the build", "run tests", "explain this file", "refactor for clarity", "add tests for".
- **TODOs** (leave as code comments with rationale):
  - Multiple concurrent session tabs — needs significant navigation refactor
  - Swipe gestures on messages — risk of conflict with ScrollView
  - Background task handling / foreground service — complex Android native module
  - Landscape/tablet layout — needs responsive breakpoint system
  - Share sheet integration — requires native module for intent filters
  - Settings import/export — low demand, easy to add later
  - Onboarding — valuable but large UX effort
  - Crash reporting — evaluate Sentry vs self-hosted, separate decision
  - Cost/token tracking for non-Claude — no standardized API across CLIs
  - Keyboard shortcuts — add after hardware keyboard user feedback
  - Accessibility pass — important but deserves its own focused PR

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `exportTranscriptMarkdown` | 3 events (text, tool_use, result) | Markdown with headers + code blocks | ✓ empty events |
| `exportTranscriptMarkdown` | event with >10k result | Truncated with marker | ✓ large content |
| `copyMessageText` | assistant event | Plain text | |
| `CodeBlock` render | `fn main() {}` | Keywords highlighted | |
| `ContextMeter` | 150k/200k | 75%, yellow bar | |
| `ContextMeter` | 0/200k | 0%, green bar | ✓ zero tokens |
| `StatusBar` | idle state | Shows "idle", no context | |
| `FileChip` | long filename | Truncated at 20 chars | ✓ edge case |
| `MessageBubble` | text with code fence | Text + CodeBlock children | |

### Edge Cases Checklist
- [ ] Empty event list → no crash, empty transcript
- [ ] Session with 10k+ events → share/copy doesn't OOM
- [ ] Container list when distrobox not installed → graceful error
- [ ] MCP settings.json missing → empty server list
- [ ] Work dir that doesn't exist → error shown before run
- [ ] Network drop during token polling → graceful timeout
- [ ] Notification when app is backgrounded → should still fire
- [ ] Theme toggle while session running → no visual glitch

---

## Validation Commands

### Static Analysis
```bash
cd mobile && npx tsc --noEmit
```
EXPECT: Zero type errors

### Unit Tests
```bash
cd mobile && npx jest --forceExit
```
EXPECT: All tests pass including new ones

### Rust Build
```bash
cargo build
```
EXPECT: Clean build

### Rust Tests
```bash
cargo test
```
EXPECT: All tests pass

### Full Lint
```bash
cargo clippy -- -D warnings
```
EXPECT: No warnings

### Manual Validation
- [ ] Open app, verify 3 agents (no Aider) in picker
- [ ] Long-press message text → native selection appears
- [ ] Tap copy button on message → text in clipboard
- [ ] Tap Copy All → full Markdown transcript in clipboard
- [ ] Tap Share → OS share sheet with transcript
- [ ] Type in input → field grows up to 4 lines, then scrolls
- [ ] Attach button → file picker → chip appears → remove chip works
- [ ] Status bar shows CLI name + container + context %
- [ ] Tap container in status bar → picker modal with distrobox containers
- [ ] Select container → status bar updates
- [ ] Run session with work dir set → verify cwd in session
- [ ] Event log → Share button → OS share sheet
- [ ] Event log → Clear button → confirmation → events cleared
- [ ] Skills → search filters list → tap skill → detail → web search opens browser
- [ ] Context meter fills during session, color changes at thresholds
- [ ] Compact button → `/compact` sent → context drops
- [ ] Settings → MCP Servers → shows configured servers
- [ ] Long session ends → local notification fires
- [ ] Webhook URL set → POST received on session end
- [ ] Theme toggle → visual switch works
- [ ] Pull-to-refresh → reconnects WS

---

## Acceptance Criteria
- [ ] All 12 numbered items addressed (some with TODOs for follow-up)
- [ ] All validation commands pass
- [ ] New tests written and passing
- [ ] No type errors in mobile or Rust
- [ ] No lint warnings
- [ ] Aider fully removed
- [ ] Config migration backward-compatible
- [ ] README updated for container picker, webhook, removed Aider

## Completion Checklist
- [ ] Code follows discovered patterns (COMPONENT_PATTERN, WS_MESSAGE_PATTERN)
- [ ] Error handling matches codebase style (anyhow in Rust, try/catch in TS)
- [ ] No hardcoded values (token limits configurable, webhook URL in settings)
- [ ] Tests follow test patterns (__tests__/ directory, describe/it blocks)
- [ ] Documentation updated (README, code comments for CLI behavior per #3)
- [ ] No unnecessary scope additions
- [ ] PR description maps each commit to numbered item

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `expo-document-picker` not working in Expo Go | Medium | High | Test on dev build, may need `expo prebuild` |
| `expo-notifications` requires native setup | High | Medium | Document setup steps, test on real device |
| `distrobox list` output format varies | Low | Medium | Parse defensively, handle empty/malformed output |
| PTY stdin write for `/compact` races with Claude output | Low | High | Use mpsc channel with proper ordering |
| Large transcript export OOMs on old devices | Low | Medium | Truncate at 500 events / 1MB |
| Theme toggle breaks existing dark-only styles | Medium | Medium | Start with dark-only, add light theme CSS vars |

## Notes
- The daemon already supports `get_token_usage`, `list_skills`, `list_dir` — most new features leverage existing WS infrastructure
- `send_text` (Task 19) is the biggest daemon change — it enables Compact and future slash command support from mobile
- The input area redesign (Task 5) is the highest-risk UI change — test thoroughly on small screens (320px width)
- PR should be organized as: one commit per numbered item where practical, with the quick wins from #12 bundled into a single "mobile UX pass" commit
- New dependencies needed: `expo-document-picker`, `expo-notifications` — both are standard Expo packages, justified in PR description

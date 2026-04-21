# Plan: Session UX Improvements

## Summary
Three related UX fixes: (1) a 5-minute grace period before the lock screen re-appears when the app backgrounds, (2) a "fresh view" on connect that hides old session events by default with a Show History toggle, and (3) a server-side directory explorer that lets the user browse the filesystem and pick a project directory before running Claude.

## User Story
As a developer using Relay on mobile, I want to switch apps without being locked out every time, see a clean slate when I connect, and browse my filesystem to pick a project — so that the daily workflow doesn't require constant re-auth and mental context-switching.

## Problem → Solution
- **Lock**: Switching away briefly (notifications, Slack) triggers full biometric re-auth → 5-min grace period; lock only after prolonged background.
- **Replay**: Old session events replay on connect and look like re-running commands → record `head_seq` at connect time; only show events newer than that by default.
- **Directory**: Container text field requires knowing the exact dir path from memory → server-side `list_dir` WS message + DirPicker modal with breadcrumb nav.

## Metadata
- **Complexity**: Large
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 7 (1 new)

---

## UX Design

### Before
```
┌─────────────────────────────────────────┐
│ Switch away for 2 seconds               │
│ → Return → LockScreen (biometric again) │
│                                         │
│ Connect → old session events fill view  │
│ (looks like commands are re-running)    │
│                                         │
│ Run panel: [container text field ____]  │
│ (must type exact path from memory)      │
└─────────────────────────────────────────┘
```

### After
```
┌─────────────────────────────────────────┐
│ Switch away for 2 seconds               │
│ → Return → no lock (within 5 min)       │
│ → Away > 5 min → LockScreen             │
│                                         │
│ Connect → clean ChatView (no old msgs)  │
│           [Show history ▼] toggle       │
│                                         │
│ Run panel: [📁 /home/user/projects]     │
│           DirPicker modal on tap        │
└─────────────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| App background → foreground | Always shows LockScreen | LockScreen only if away > 5 min | Timer set on background, cancelled on foreground |
| Connect | Shows all replayed events | Shows only new events | "Show history" toggle reveals old events |
| Run panel container field | Free-text input | Browse button + DirPicker modal | Selected path sent as `work_dir` in run request |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `mobile/App.tsx` | 42–57 | AppState lock logic to modify |
| P0 | `mobile/src/hooks/useClaudedWS.ts` | 174–265 | connect() + welcome handler + processEvent |
| P0 | `src/ws.rs` | 221–294 | handle_input pattern to extend with list_dir |
| P1 | `mobile/src/components/ChatView.tsx` | 144–242 | Event filter loop to add viewStartSeq guard |
| P1 | `src/claude.rs` | 40–80 | CommandBuilder usage — add .cwd() call |
| P1 | `mobile/src/screens/MainScreen.tsx` | 180–240 | Run panel — add Browse button |
| P2 | `mobile/src/types/index.ts` | all | Type definitions to extend |

## External Documentation
| Topic | Source | Key Takeaway |
|---|---|---|
| portable_pty CommandBuilder | crate docs | `cmd.cwd(path)` sets working directory before spawn |
| std::fs::read_dir | std docs | Returns `io::Result<ReadDir>`; each `DirEntry` has `.path()`, `.file_type()` |

---

## Patterns to Mirror

### APPSTATE_LISTENER
```typescript
// SOURCE: mobile/App.tsx:43–56
useEffect(() => {
  const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
    const prev = appStateRef.current;
    appStateRef.current = next;
    if (prev === 'active' && next === 'background') { ... }
    if (next === 'active' && prev !== 'active' && ...) { ... }
  });
  return () => sub.remove();
}, [connect]);
```

### WS_SEND_PATTERN
```typescript
// SOURCE: mobile/src/hooks/useClaudedWS.ts (run/getNotifyConfig functions)
const listDir = useCallback((path: string) => {
  wsRef.current?.send(JSON.stringify({ type: 'list_dir', path }));
}, []);
```

### PROCESSEVENT_HANDLER
```typescript
// SOURCE: mobile/src/hooks/useClaudedWS.ts:95–160 (processEvent)
if (event.type === 'dir_listing') {
  const ev = event as DirListingEvent;
  // resolve pending promise or update state
}
```

### RUST_WS_HANDLER
```rust
// SOURCE: src/ws.rs:232–293 (handle_input match arms)
"list_dir" => {
    let path = msg.get("path").and_then(|v| v.as_str()).unwrap_or("~");
    // resolve ~, read dir, send response directly to this client's tx
}
```

### RUST_SEND_TO_CLIENT
```rust
// SOURCE: src/ws.rs — tx is the per-client sender, used in broadcast loop
// Pass tx: &mpsc::UnboundedSender<Message> into handle_input for direct responses
let _ = tx.send(Message::Text(json_str.into()));
```

### COMMANDBUILDER_CWD
```rust
// SOURCE: src/claude.rs:62–68
let mut cmd = CommandBuilder::new(&claude_bin);
cmd.cwd("/home/user/myproject");  // add after existing setup
```

### MODAL_PATTERN
```typescript
// SOURCE: mobile/src/screens/SettingsScreen.tsx (Modal usage pattern)
<Modal visible={visible} animationType="slide" onRequestClose={onClose}>
  <SafeAreaView style={styles.container}>...</SafeAreaView>
</Modal>
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `mobile/App.tsx` | UPDATE | Replace immediate lock with deferred 5-min timer |
| `mobile/src/hooks/useClaudedWS.ts` | UPDATE | Add viewStartSeq, listDir, handle dir_listing |
| `mobile/src/types/index.ts` | UPDATE | Add DirEntry, DirListingEvent types |
| `mobile/src/components/ChatView.tsx` | UPDATE | Filter by viewStartSeq, add Show History toggle |
| `mobile/src/screens/MainScreen.tsx` | UPDATE | Pass viewStartSeq, add Browse button + DirPicker |
| `mobile/src/components/DirPicker.tsx` | CREATE | Directory browser modal |
| `src/ws.rs` | UPDATE | Add list_dir handler; pass tx into handle_input |
| `src/main.rs` | UPDATE | Add work_dir to RunRequest |
| `src/claude.rs` | UPDATE | Apply work_dir via cmd.cwd() |

## NOT Building
- Saving the selected directory across reconnects (future)
- Container-aware directory listing (distrobox fs browsing)
- File preview or file selection (dirs only for project picking)
- Pagination of large directories (truncate at 200 entries)
- Search/filter within the directory picker

---

## Step-by-Step Tasks

### Task 1: Deferred background lock (App.tsx)
- **ACTION**: Replace immediate `setIsLocked(true)` with a 5-minute deferred timer.
- **IMPLEMENT**:
```typescript
const LOCK_DELAY_MS = 5 * 60 * 1000;
const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// In AppState listener:
if (prev === 'active' && next === 'background') {
  if (configRef.current) {
    lockTimerRef.current = setTimeout(() => {
      setIsLocked(true);
      lockTimerRef.current = null;
    }, LOCK_DELAY_MS);
  }
}
if (next === 'active' && prev !== 'active') {
  if (lockTimerRef.current !== null) {
    clearTimeout(lockTimerRef.current);
    lockTimerRef.current = null;
  }
  if (configRef.current && !isConnectedRef.current) {
    connect(configRef.current);
  }
}
```
- **MIRROR**: APPSTATE_LISTENER
- **IMPORTS**: No new imports; `ReturnType<typeof setTimeout>` is built-in TS.
- **GOTCHA**: Clear `lockTimerRef` in the cleanup return of the `useEffect` to avoid firing after unmount.
- **VALIDATE**: Switch away for 4 min → return → no lock. Switch away for 6 min → return → LockScreen.

### Task 2: Add DirEntry + DirListingEvent types (types/index.ts)
- **ACTION**: Append two new exported types.
- **IMPLEMENT**:
```typescript
export interface DirEntry {
  name: string;
  is_dir: boolean;
}
export interface DirListingEvent {
  type: 'dir_listing';
  path: string;
  entries: DirEntry[];
  error?: string;
}
```
- **MIRROR**: Existing type definitions in types/index.ts
- **IMPORTS**: None.
- **GOTCHA**: `error` field is optional — server sends it when `read_dir` fails (permission denied, path not found).
- **VALIDATE**: Import resolves without TS errors in DirPicker and useClaudedWS.

### Task 3: Add viewStartSeq + listDir to useClaudedWS
- **ACTION**: Three changes to the hook: (a) add `viewStartSeq` state, (b) set it from welcome `head_seq`, (c) add `listDir` send function + handle `dir_listing` events.
- **IMPLEMENT**:

  a) Add state + pending resolver ref near other state declarations (line ~30):
  ```typescript
  const [viewStartSeq, setViewStartSeq] = useState(0);
  const dirListingCallbackRef = useRef<((ev: DirListingEvent) => void) | null>(null);
  ```

  b) In the welcome handler (line ~207, after `setEvents([])`):
  ```typescript
  setViewStartSeq(welcome.head_seq ?? 0);
  ```

  c) In `processEvent`, add after the `session_ended` handler:
  ```typescript
  if (event.type === 'dir_listing') {
    const ev = event as DirListingEvent;
    dirListingCallbackRef.current?.(ev);
    return;
  }
  ```

  d) Add `listDir` function (alongside `run`, `kill`):
  ```typescript
  const listDir = useCallback((path: string, cb: (ev: DirListingEvent) => void) => {
    dirListingCallbackRef.current = cb;
    wsRef.current?.send(JSON.stringify({ type: 'list_dir', path }));
  }, []);
  ```

  e) Add `viewStartSeq` and `listDir` to the return object.

- **MIRROR**: WS_SEND_PATTERN, PROCESSEVENT_HANDLER
- **IMPORTS**: `DirListingEvent` from `'../types'`
- **GOTCHA**: `dirListingCallbackRef` is a single slot — concurrent `listDir` calls overwrite the callback. This is fine for the modal (only one open at a time). Do NOT use a Promise here; the response comes through `processEvent` which is in the React render cycle.
- **VALIDATE**: Call `listDir('~', cb)` from DirPicker; verify cb fires with entries.

### Task 4: Update ChatView — fresh view + Show History toggle
- **ACTION**: Accept `viewStartSeq: number` prop; filter events; add toggle button.
- **IMPLEMENT**:

  Props interface change:
  ```typescript
  interface ChatViewProps {
    events: EventFrame[];
    pendingApprovals: PendingApproval[];
    onDecide: (tool_use_id: string, allow: boolean) => void;
    viewStartSeq: number;
  }
  ```

  Add state inside ChatView:
  ```typescript
  const [showHistory, setShowHistory] = useState(false);
  const visibleEvents = showHistory ? events : events.filter(f => f.seq > viewStartSeq);
  ```

  Replace `for (const frame of events)` with `for (const frame of visibleEvents)`.

  Add toggle above the ScrollView (inside the return, before `<ScrollView>`):
  ```tsx
  {events.some(f => f.seq <= viewStartSeq) && (
    <Pressable onPress={() => setShowHistory(x => !x)} style={styles.historyToggle}>
      <Text style={styles.historyToggleText}>
        {showHistory ? '▲ Hide history' : '▼ Show history'}
      </Text>
    </Pressable>
  )}
  ```

  Add styles:
  ```typescript
  historyToggle: { alignItems: 'center', paddingVertical: 6 },
  historyToggleText: { color: '#52525b', fontSize: 11 },
  ```

- **MIRROR**: existing `expandHint` style pattern (same color/size family)
- **IMPORTS**: None new.
- **GOTCHA**: Reset `showHistory` to `false` when `viewStartSeq` changes (new connect). Add `useEffect(() => { setShowHistory(false); }, [viewStartSeq])`.
- **VALIDATE**: Connect → ChatView empty. Tap "Show history" → old events appear. New session message appears immediately without toggling.

### Task 5: Create DirPicker modal component
- **ACTION**: New file `mobile/src/components/DirPicker.tsx`.
- **IMPLEMENT**:
```typescript
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DirEntry, DirListingEvent } from '../types';

interface DirPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  listDir: (path: string, cb: (ev: DirListingEvent) => void) => void;
  initialPath?: string;
}

export function DirPicker({ visible, onClose, onSelect, listDir, initialPath = '~' }: DirPickerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const navigate = (path: string) => {
    setLoading(true);
    setError(null);
    listDir(path, (ev) => {
      setLoading(false);
      if (ev.error) {
        setError(ev.error);
      } else {
        setCurrentPath(ev.path);  // server returns resolved path (~ expanded)
        setEntries(ev.entries.sort((a, b) =>
          a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1
        ));
      }
    });
  };

  useEffect(() => {
    if (visible) navigate(initialPath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pathParts = currentPath.split('/').filter(Boolean);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>Choose Directory</Text>
          <Pressable onPress={() => { onSelect(currentPath); onClose(); }} style={styles.selectBtn}>
            <Text style={styles.selectText}>Select</Text>
          </Pressable>
        </View>

        {/* Breadcrumb */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.breadcrumb}>
          <Pressable onPress={() => navigate('/')} style={styles.crumb}>
            <Text style={styles.crumbText}>/</Text>
          </Pressable>
          {pathParts.map((part, i) => (
            <Pressable
              key={i}
              onPress={() => navigate('/' + pathParts.slice(0, i + 1).join('/'))}
              style={styles.crumb}
            >
              <Text style={[styles.crumbText, i === pathParts.length - 1 && styles.crumbActive]}>
                {part}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Entries */}
        {loading && <Text style={styles.status}>Loading…</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
        <ScrollView style={styles.list}>
          {currentPath !== '/' && (
            <Pressable onPress={() => navigate(currentPath + '/..')} style={styles.entry}>
              <Text style={styles.entryIcon}>📁</Text>
              <Text style={styles.entryName}>..</Text>
            </Pressable>
          )}
          {entries.map(entry => (
            <Pressable
              key={entry.name}
              style={styles.entry}
              onPress={() => entry.is_dir ? navigate(currentPath + '/' + entry.name) : undefined}
            >
              <Text style={styles.entryIcon}>{entry.is_dir ? '📁' : '📄'}</Text>
              <Text style={[styles.entryName, !entry.is_dir && styles.entryFile]}>
                {entry.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Current path */}
        <View style={styles.footer}>
          <Text style={styles.footerPath} numberOfLines={1}>{currentPath}</Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  cancelBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  cancelText: { color: '#9ca3af', fontSize: 15 },
  title: { color: '#e2e8f0', fontSize: 15, fontWeight: '600', flex: 1, textAlign: 'center' },
  selectBtn: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#14532d', borderRadius: 6 },
  selectText: { color: '#4ade80', fontSize: 15, fontWeight: '700' },
  breadcrumb: { flexGrow: 0, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  crumb: { paddingHorizontal: 6, paddingVertical: 2 },
  crumbText: { color: '#71717a', fontSize: 13 },
  crumbActive: { color: '#e2e8f0', fontWeight: '600' },
  status: { color: '#6b7280', textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  error: { color: '#f87171', textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  list: { flex: 1 },
  entry: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#111' },
  entryIcon: { fontSize: 16, marginRight: 12 },
  entryName: { color: '#e2e8f0', fontSize: 14 },
  entryFile: { color: '#52525b' },
  footer: { padding: 12, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  footerPath: { color: '#6b7280', fontSize: 11, fontFamily: 'Menlo' },
});
```
- **MIRROR**: MODAL_PATTERN; dark color palette from ApprovalCard/MainScreen
- **IMPORTS**: `Modal`, `SafeAreaView`, `ScrollView` from `'react-native'`; `DirEntry`, `DirListingEvent` from `'../types'`
- **GOTCHA**: `navigate(currentPath + '/..')` — the server must resolve `..` and return the canonical path in `ev.path`. Client should NOT do path math itself; trust the server's resolved path.
- **VALIDATE**: Modal opens, shows home dir entries, breadcrumb nav works, Select closes and passes path up.

### Task 6: Wire DirPicker into MainScreen
- **ACTION**: Add `viewStartSeq` prop forwarding to ChatView; add Browse button + DirPicker state to run panel.
- **IMPLEMENT**:

  Add to `MainScreenProps`:
  ```typescript
  viewStartSeq: number;
  listDir: (path: string, cb: (ev: DirListingEvent) => void) => void;
  ```

  Add state:
  ```typescript
  const [workDir, setWorkDir] = useState<string>('');
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  ```

  Replace container-only run call with:
  ```typescript
  onRun(p, container.trim() || undefined, dangerouslySkipPermissions, workDir.trim() || undefined);
  ```

  In the run panel JSX, after the container input row add:
  ```tsx
  <Pressable onPress={() => setDirPickerOpen(true)} style={styles.dirBtn}>
    <Text style={styles.dirBtnText} numberOfLines={1}>
      {workDir || '📁 Choose project directory'}
    </Text>
  </Pressable>
  <DirPicker
    visible={dirPickerOpen}
    onClose={() => setDirPickerOpen(false)}
    onSelect={setWorkDir}
    listDir={listDir}
  />
  ```

  Pass `viewStartSeq` to `<ChatView>`.

  Add styles:
  ```typescript
  dirBtn: { borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#0d0d0d', padding: 10 },
  dirBtnText: { color: '#9ca3af', fontSize: 13, fontFamily: 'Menlo' },
  ```

- **MIRROR**: existing `runRow` / `containerInput` pattern
- **IMPORTS**: `DirPicker` from `'../components/DirPicker'`; `DirListingEvent` from `'../types'`
- **GOTCHA**: `workDir` should be cleared when a new session starts (or kept sticky — keep sticky for now since the user likely runs the same project repeatedly).
- **VALIDATE**: Browse button opens modal, selecting a dir populates the button text, Run sends work_dir.

### Task 7: Update App.tsx to forward new hook values
- **ACTION**: Destructure `viewStartSeq` and `listDir` from `useClaudedWS`; forward to `MainScreen`.
- **IMPLEMENT**:
  ```typescript
  const { ..., viewStartSeq, listDir } = useClaudedWS();
  // In <MainScreen>:
  viewStartSeq={viewStartSeq}
  listDir={listDir}
  ```
- **MIRROR**: existing destructuring pattern at line 15
- **IMPORTS**: None new.
- **VALIDATE**: TypeScript resolves without errors.

### Task 8: Server — add list_dir handler in ws.rs
- **ACTION**: Pass `tx` into `handle_input`; add `list_dir` match arm.
- **IMPLEMENT**:

  Change `handle_input` signature to include `tx`:
  ```rust
  async fn handle_input(
      msg: &Value,
      client_id: &str,
      tx: &tokio::sync::mpsc::UnboundedSender<axum::extract::ws::Message>,
      pending: &PendingApprovals,
      // ... rest unchanged
  )
  ```

  Add `list_dir` arm (before the closing `_ => {}`):
  ```rust
  "list_dir" => {
      let raw_path = msg.get("path").and_then(|v| v.as_str()).unwrap_or("~");
      let expanded = if raw_path == "~" || raw_path.starts_with("~/") {
          let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
          raw_path.replacen('~', &home, 1)
      } else {
          raw_path.to_string()
      };
      let canonical = std::fs::canonicalize(&expanded)
          .unwrap_or_else(|_| std::path::PathBuf::from(&expanded));

      let response = match std::fs::read_dir(&canonical) {
          Ok(rd) => {
              let mut entries: Vec<serde_json::Value> = rd
                  .filter_map(|e| e.ok())
                  .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                  .map(|e| {
                      let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                      serde_json::json!({ "name": e.file_name().to_string_lossy(), "is_dir": is_dir })
                  })
                  .collect();
              entries.sort_by(|a, b| {
                  let ad = a["is_dir"].as_bool().unwrap_or(false);
                  let bd = b["is_dir"].as_bool().unwrap_or(false);
                  bd.cmp(&ad).then_with(|| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")))
              });
              serde_json::json!({
                  "type": "dir_listing",
                  "path": canonical.to_string_lossy(),
                  "entries": entries
              })
          }
          Err(e) => serde_json::json!({
              "type": "dir_listing",
              "path": canonical.to_string_lossy(),
              "entries": [],
              "error": e.to_string()
          }),
      };
      if let Ok(s) = serde_json::to_string(&response) {
          let _ = tx.send(axum::extract::ws::Message::Text(s.into()));
      }
      tracing::debug!(%client_id, path = %canonical.display(), "list_dir");
  }
  ```

- **MIRROR**: RUST_WS_HANDLER, RUST_SEND_TO_CLIENT
- **IMPORTS**: No new crate deps; `std::fs`, `std::path::PathBuf`, `std::env` all in std.
- **GOTCHA**: Hidden files (dotfiles) are filtered out by default — projects under `.config/` won't show. This is intentional; the user can type the path manually for hidden dirs. Do NOT expose the entire filesystem without restriction — `canonicalize` prevents traversal but does not restrict scope. Consider adding a check that the path starts with `$HOME` before listing; log and reject otherwise.
- **SECURITY**: Add home-dir guard before `read_dir`:
  ```rust
  let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
  if !canonical.starts_with(&home) {
      let _ = tx.send(/* error: outside home */);
      return;
  }
  ```
- **VALIDATE**: Send `{ type: "list_dir", path: "~" }` via wscat → receive `dir_listing` with home dir contents.

### Task 9: Add work_dir to RunRequest and claude.rs
- **ACTION**: Extend `RunRequest` struct; extract from WS message; apply in CommandBuilder.
- **IMPLEMENT**:

  In `src/main.rs`, update `RunRequest`:
  ```rust
  struct RunRequest {
      prompt: String,
      container: Option<String>,
      dangerously_skip_permissions: bool,
      work_dir: Option<String>,
  }
  ```

  In `src/ws.rs` `run` handler, extract field:
  ```rust
  let work_dir = msg
      .get("work_dir")
      .and_then(|v| v.as_str())
      .filter(|s| !s.is_empty())
      .map(|s| s.to_string());
  let req = RunRequest { prompt: prompt.to_string(), container, dangerously_skip_permissions, work_dir };
  ```

  In `src/claude.rs`, in `spawn_and_process` function signature and body:
  ```rust
  // Add work_dir: Option<String> param
  // After cmd is built (both container and non-container branches):
  if let Some(ref dir) = work_dir {
      cmd.cwd(dir);
  }
  ```

  In mobile `useClaudedWS.ts`, update `run` function:
  ```typescript
  const run = useCallback((prompt: string, container?: string, dangerouslySkipPermissions?: boolean, workDir?: string) => {
    wsRef.current?.send(JSON.stringify({
      type: 'run', prompt, container, dangerously_skip_permissions: dangerouslySkipPermissions ?? false,
      work_dir: workDir,
    }));
  }, []);
  ```

  Update `onRun` prop type in `MainScreenProps`:
  ```typescript
  onRun: (prompt: string, container?: string, dangerouslySkipPermissions?: boolean, workDir?: string) => void;
  ```

- **MIRROR**: COMMANDBUILDER_CWD; existing RunRequest field pattern
- **IMPORTS**: None new.
- **GOTCHA**: `cmd.cwd()` must be called before `pty.spawn(&cmd)`. In `claude.rs`, `cwd` goes on the `CommandBuilder` immediately after args are set, before the spawn call.
- **VALIDATE**: Set workDir to a project path → Claude starts with CWD set to that dir (verify with a `Bash` tool call showing `pwd`).

---

## Testing Strategy

### Manual Validation
- [ ] Background app for 3 min → foreground → no lock screen
- [ ] Background app for 6 min → foreground → lock screen appears
- [ ] Connect → ChatView is empty (fresh view)
- [ ] Tap "Show history" → old session events appear
- [ ] Connect again → "Show history" resets to hidden
- [ ] Tap Browse → DirPicker opens on home dir
- [ ] Navigate into subdirectory → breadcrumb updates
- [ ] Tap `..` → navigates up
- [ ] Tap Select → path appears in run panel button
- [ ] Run with selected dir → Claude's first `pwd` shows correct path
- [ ] Navigate to restricted path (server rejects) → error shown in picker

### Edge Cases Checklist
- [ ] App backgrounded while LockScreen is showing (don't double-lock)
- [ ] Directory with 500+ entries (truncate at 200 server-side)
- [ ] Symlinks in directory listing (show as dir or file based on target type)
- [ ] Path with spaces or unicode (canonicalize handles this)
- [ ] listDir called before WS connected (wsRef.current is null — no-op)
- [ ] Two rapid listDir calls (second callback ref overwrites first — fine for serial modal nav)

---

## Validation Commands

### Static Analysis
```bash
cd mobile && npx tsc --noEmit 2>&1 | grep -v "moduleResolution"
```
EXPECT: Zero new type errors (ignore pre-existing moduleResolution false positives)

### Rust Build
```bash
cargo build --release 2>&1 | tail -5
```
EXPECT: `Finished release profile`

### Rust Clippy
```bash
cargo clippy -- -D warnings 2>&1 | grep -v "^warning: unused"
```
EXPECT: No new warnings

### Manual Validation
- [ ] wscat test: connect, send `{"type":"list_dir","path":"~"}`, receive `dir_listing`
- [ ] Run with work_dir set; verify Claude CWD with pwd in session

---

## Acceptance Criteria
- [ ] Backgrounding for < 5 min does not trigger lock screen
- [ ] Backgrounding for > 5 min does trigger lock screen
- [ ] Fresh connect shows empty ChatView; Show History reveals old events
- [ ] DirPicker navigates server filesystem, restricted to $HOME
- [ ] Selected dir is passed as work_dir; Claude spawns in that directory
- [ ] Rust build passes with no new warnings

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `cmd.cwd()` not available on `CommandBuilder` | Low | High | Check portable_pty docs; fallback: set env var `PWD` and let shell handle it |
| Axum WS sender type mismatch in handle_input | Medium | Medium | Check exact type from ws.rs imports before writing; may be `SplitSink` not `UnboundedSender` |
| iOS AppState timer fires before app fully backgrounds | Low | Low | Add 500ms debounce before starting the LOCK_DELAY timer |
| large dir listing freezing mobile scroll | Low | Low | Cap entries at 200 server-side before serializing |

## Notes
- The `tx` type in `ws.rs` depends on whether axum splits the WS into sink/stream or uses a unified handle — read `handle_ws` carefully before Task 8 to confirm the exact sender type.
- Hidden dirs (`.config`, `.local`) are excluded from listing by default. If the user wants to navigate to a hidden dir, they can still type the path manually in a future enhancement.
- `work_dir` is intentionally not saved to AsyncStorage — the user picks it fresh each session. Sticky behavior can be added later.

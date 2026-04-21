# Plan: Prompt Library + Templates

## Summary
Add a reusable prompt library that lets users save, organize, and quick-launch prompts from the mobile app. Prompts are stored daemon-side in SQLite (synced across devices) with CRUD via WS messages. Includes a PromptLibraryScreen accessible from the session-start UI and Settings.

## User Story
As a mobile user who repeatedly sends similar prompts (e.g., "review this PR", "run tests", "fix lint errors"),
I want a saved prompt library,
So that I can launch common workflows with one tap instead of retyping each time.

## Problem → Solution
Every session requires manually typing the full prompt on a phone keyboard → Save prompts to a library; tap to launch or insert into prompt field.

## Metadata
- **Complexity**: Medium
- **Source PRD**: Competitive gap analysis (Warp, Nimbalyst, AgentsRoom all have this)
- **PRD Phase**: N/A
- **Estimated Files**: 6-9

---

## UX Design

### Before
```
┌─────────────────────────────┐
│  [Prompt text field]        │
│  Type full prompt each time │
│  [Run]                      │
└─────────────────────────────┘
```

### After
```
┌─────────────────────────────┐
│  [Prompt text field]   [📚] │
│  Tap 📚 to open library     │
│  [Run]                      │
│                             │
│  ┌─ Prompt Library ───────┐ │
│  │ ★ Review PR        [▶] │ │
│  │ ★ Run tests        [▶] │ │
│  │ ★ Fix lint errors  [▶] │ │
│  │ ★ Deploy staging   [▶] │ │
│  │          [+ New Prompt] │ │
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Session start | Type prompt manually | Tap library icon → select prompt → auto-fill or direct-launch | Library icon next to prompt field |
| Prompt creation | N/A | Long-press prompt in history → "Save to library" OR manual create | Two entry points |
| Prompt management | N/A | Settings → Prompt Library → edit/delete/reorder | Full CRUD |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/ws.rs` | 190-536 | WS message handler pattern — new messages follow this pattern |
| P0 | `src/db.rs` | all | SQLite table creation and query patterns |
| P0 | `mobile/src/screens/MainScreen.tsx` | 1-55 | Session start UI — where library button goes |
| P1 | `mobile/src/screens/SkillsScreen.tsx` | all | FlatList modal pattern to mirror for PromptLibraryScreen |
| P1 | `mobile/src/hooks/useClaudedWS.ts` | all | WS hook pattern — new messages follow this pattern |
| P2 | `mobile/src/types/index.ts` | all | Type definitions |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| No external research needed | N/A | Feature uses established internal patterns |

---

## Patterns to Mirror

### WS_MESSAGE_HANDLER
// SOURCE: src/ws.rs:332-364 (list_skills handler)
```rust
} else if msg_type == "list_skills" {
    // read from filesystem, build JSON array, send response
    let response = serde_json::json!({ "type": "skills_list", "skills": skills });
    if let Ok(s) = serde_json::to_string(&response) {
        if sink.send(Message::Text(s)).await.is_err() { break; }
    }
}
```

### DB_TABLE_PATTERN
// SOURCE: src/db.rs:23-31 (scheduled_sessions table)
```rust
CREATE TABLE IF NOT EXISTS scheduled_sessions (
    id           TEXT    PRIMARY KEY,
    prompt       TEXT    NOT NULL,
    container    TEXT,
    command      TEXT,
    scheduled_at REAL    NOT NULL,
    created_at   REAL    NOT NULL,
    fired        INTEGER NOT NULL DEFAULT 0
);
```

### SCREEN_MODAL_PATTERN
// SOURCE: mobile/src/screens/SkillsScreen.tsx
FlatList inside Modal with header, refresh button, close button.

### SETTINGS_NAV_PATTERN
// SOURCE: mobile/src/screens/SettingsScreen.tsx:65-67
```tsx
const [skillsVisible, setSkillsVisible] = useState(false);
// ... button that sets visible to true, renders SkillsScreen in a modal
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db.rs` | UPDATE | Add `prompt_library` table + CRUD functions |
| `src/ws.rs` | UPDATE | Add `list_prompts`, `save_prompt`, `update_prompt`, `delete_prompt` WS handlers |
| `mobile/src/types/index.ts` | UPDATE | Add `SavedPrompt` interface |
| `mobile/src/screens/PromptLibraryScreen.tsx` | CREATE | FlatList modal with saved prompts |
| `mobile/src/screens/MainScreen.tsx` | UPDATE | Add library icon button next to prompt field |
| `mobile/src/screens/SettingsScreen.tsx` | UPDATE | Add "Prompt Library" nav button |
| `mobile/src/hooks/useClaudedWS.ts` | UPDATE | Add WS message handlers for prompt CRUD |

## NOT Building

- Prompt categories/folders (flat list for v1)
- Prompt variables/placeholders (e.g., `{{branch}}`) — future enhancement
- Sharing prompts between users
- Syncing with desktop Claude Code commands directory
- Prompt usage analytics

---

## Step-by-Step Tasks

### Task 1: Add prompt_library SQLite table
- **ACTION**: Add table creation in `db::open()` and CRUD functions
- **IMPLEMENT**:
  ```sql
  CREATE TABLE IF NOT EXISTS prompt_library (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      prompt     TEXT NOT NULL,
      container  TEXT,
      command    TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL
  );
  ```
  Functions: `list_prompts()`, `insert_prompt()`, `update_prompt()`, `delete_prompt()`
- **MIRROR**: DB_TABLE_PATTERN (scheduled_sessions)
- **IMPORTS**: `rusqlite::{Connection, params}`
- **GOTCHA**: Use `spawn_blocking` for DB access from async context (see existing pattern)
- **VALIDATE**: `cargo test` passes; table created on startup

### Task 2: Add WS message handlers
- **ACTION**: Add 4 new message types: `list_prompts`, `save_prompt`, `update_prompt`, `delete_prompt`
- **IMPLEMENT**:
  - `list_prompts` → query all, return `{type: "prompts_list", prompts: [...]}`
  - `save_prompt` → insert, return `{type: "prompt_saved", id, ...}`
  - `update_prompt` → update by id, return `{type: "prompt_updated", id}`
  - `delete_prompt` → delete by id, return `{type: "prompt_deleted", id}`
- **MIRROR**: WS_MESSAGE_HANDLER (list_skills, schedule_session patterns)
- **IMPORTS**: `crate::db`
- **GOTCHA**: Use `spawn_blocking` for DB calls; generate id with `new_session_id()`
- **VALIDATE**: `cargo test`; manual WS test with wscat

### Task 3: Add SavedPrompt type
- **ACTION**: Add TypeScript interface for saved prompts
- **IMPLEMENT**:
  ```typescript
  export interface SavedPrompt {
    id: string;
    title: string;
    prompt: string;
    container?: string | null;
    command?: string | null;
    sort_order: number;
    created_at: number;
    updated_at: number;
  }
  ```
- **MIRROR**: Existing types in `types/index.ts` (ScheduledSessionInfo pattern)
- **IMPORTS**: N/A
- **GOTCHA**: N/A
- **VALIDATE**: TypeScript compiles

### Task 4: Add WS handlers to useClaudedWS
- **ACTION**: Add prompt CRUD methods and state to the WS hook
- **IMPLEMENT**:
  - State: `prompts: SavedPrompt[]`
  - Methods: `listPrompts()`, `savePrompt(title, prompt, container?, command?)`, `updatePrompt(id, ...)`, `deletePrompt(id)`
  - Handle incoming `prompts_list`, `prompt_saved`, `prompt_updated`, `prompt_deleted` messages
- **MIRROR**: Existing skill/schedule handlers in useClaudedWS
- **IMPORTS**: SavedPrompt type
- **GOTCHA**: Refresh list after save/update/delete
- **VALIDATE**: Hook compiles; methods callable

### Task 5: Create PromptLibraryScreen
- **ACTION**: FlatList modal showing saved prompts with CRUD
- **IMPLEMENT**:
  - FlatList of prompts: title, truncated prompt text, run button [▶], edit/delete actions
  - "New Prompt" button at bottom → inline form (title + prompt text + optional container/command)
  - Edit mode: tap prompt → editable fields + save/cancel
  - Swipe-to-delete or long-press → delete
  - Run button: calls `onRun(prompt.prompt, prompt.container, ...)`
- **MIRROR**: SCREEN_MODAL_PATTERN (SkillsScreen)
- **IMPORTS**: FlatList, Modal, TextInput, Pressable
- **GOTCHA**: Keep prompt text multiline but not too tall on mobile
- **VALIDATE**: Renders with mock data; CRUD works

### Task 6: Add library button to MainScreen
- **ACTION**: Add a small library icon next to the prompt input field
- **IMPLEMENT**:
  - Icon button (📚 or list icon) positioned right of or above the prompt TextInput
  - Tapping opens PromptLibraryScreen modal
  - Selecting a prompt fills the prompt field (or optionally direct-launches)
  - Two modes: "Insert" (fills field) vs "Run" (launches immediately)
- **MIRROR**: Existing button patterns in MainScreen
- **IMPORTS**: PromptLibraryScreen
- **GOTCHA**: Don't crowd the existing prompt input area; keep it clean
- **VALIDATE**: Button visible; modal opens; prompt fills on select

### Task 7: Add Settings navigation
- **ACTION**: Add "Prompt Library" button in SettingsScreen
- **IMPLEMENT**: Follow existing pattern (like Skills, History, Schedule buttons)
- **MIRROR**: SETTINGS_NAV_PATTERN
- **IMPORTS**: PromptLibraryScreen
- **GOTCHA**: N/A
- **VALIDATE**: Navigation works from Settings

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| list_prompts returns empty | No saved prompts | `[]` | Yes |
| save_prompt creates entry | Title + prompt | prompt_saved with id | No |
| delete_prompt removes entry | Valid id | prompt_deleted | No |
| delete_prompt invalid id | Nonexistent id | No error (idempotent) | Yes |
| PromptLibraryScreen renders | Prompt list | FlatList visible | No |

### Edge Cases Checklist
- [ ] Empty library — shows "No saved prompts" + create button
- [ ] Very long prompt text — truncated in list, full in edit
- [ ] Special characters in prompt — handled correctly
- [ ] Concurrent saves from multiple devices — last write wins

---

## Validation Commands

### Rust Tests
```bash
cargo test
```
EXPECT: All tests pass

### Rust Build
```bash
cargo build
```
EXPECT: Compiles without errors

### Mobile Tests
```bash
cd mobile && npx jest
```
EXPECT: All tests pass

### Manual Validation
- [ ] Create prompt from library screen
- [ ] Edit existing prompt
- [ ] Delete prompt
- [ ] Tap run → session starts with saved prompt
- [ ] Insert into field → prompt text appears in input

---

## Acceptance Criteria
- [ ] Prompt library persisted in SQLite (daemon-side)
- [ ] CRUD via WS messages works
- [ ] PromptLibraryScreen renders and is navigable
- [ ] Library accessible from session-start and Settings
- [ ] Run button launches session with saved prompt
- [ ] All tests pass

## Completion Checklist
- [ ] Follows WS message handler pattern
- [ ] Follows DB table pattern
- [ ] Follows FlatList modal screen pattern
- [ ] No hardcoded values
- [ ] Error handling on all DB operations

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Prompt library grows large | Low | Low | Paginate if needed; 200 prompt cap like dir_listing |
| UI crowding around prompt input | Medium | Medium | Use subtle icon; test on small screens |

## Notes
- Future enhancement: support `{{variable}}` placeholders that prompt for input at launch time
- Future enhancement: import from `.claude/commands/` directory for desktop parity

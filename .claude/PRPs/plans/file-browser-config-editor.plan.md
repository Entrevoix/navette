# Plan: File Browser + CLAUDE.md Config Editor

## Summary
Add a file browser that lets users navigate the project tree and view files from the mobile app, plus an editor for CLAUDE.md and other `.claude/` config files. The daemon already has `list_dir` — this extends it with `read_file` and `write_file` WS messages, and adds a FileBrowserScreen + ConfigEditorScreen on mobile.

## User Story
As a mobile user monitoring an agent session,
I want to browse the project's file tree and edit CLAUDE.md from my phone,
So that I can review files the agent changed and adjust project instructions without SSH.

## Problem → Solution
Currently can only see diffs in event stream; no way to browse or edit arbitrary files → Add file browser + read/write WS messages + mobile screens.

## Metadata
- **Complexity**: Large
- **Source PRD**: Competitive gap analysis (Nimbalyst, Cursor both have file browsers)
- **PRD Phase**: N/A
- **Estimated Files**: 8-12

---

## UX Design

### Before
```
┌─────────────────────────────┐
│  Session events only        │
│  See diffs in tool_result   │
│  No way to browse files     │
│  No way to edit CLAUDE.md   │
└─────────────────────────────┘
```

### After
```
┌─────────────────────────────┐
│  [📁 Files] tab in session  │
│                             │
│  ┌─ File Browser ─────────┐ │
│  │ 📁 src/                │ │
│  │ 📁 mobile/             │ │
│  │ 📁 .claude/            │ │
│  │ 📄 Cargo.toml          │ │
│  │ 📄 CLAUDE.md     [✏️]  │ │
│  │ 📄 ROADMAP.md         │ │
│  └─────────────────────────┘ │
│                             │
│  ┌─ File Viewer ──────────┐ │
│  │ syntax-highlighted     │ │
│  │ read-only view         │ │
│  │ [Edit] for .claude/*   │ │
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| File browsing | Not possible | Tap folders to navigate; tap files to view | Hierarchical navigation |
| File viewing | Only via diffs | Full file content, syntax highlighted | Read-only by default |
| CLAUDE.md editing | SSH required | Tap edit icon → TextInput editor → save | Write restricted to .claude/ |
| Settings | N/A | "Project Files" nav button | Quick access |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/ws.rs` | 397-456 | Existing `list_dir` handler — extend with read_file/write_file |
| P0 | `mobile/src/components/DirPicker.tsx` | all | Existing directory picker — reuse navigation pattern |
| P1 | `mobile/src/components/DiffView.tsx` | all | Code display patterns — may reuse for file viewer |
| P1 | `mobile/src/hooks/useClaudedWS.ts` | all | WS hook for new messages |
| P1 | `mobile/src/types/index.ts` | all | DirEntry, DirListingEvent types |
| P2 | `mobile/src/screens/SkillsScreen.tsx` | all | FlatList modal pattern |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| No external research needed | N/A | Extends existing list_dir pattern |

---

## Patterns to Mirror

### LIST_DIR_HANDLER
// SOURCE: src/ws.rs:397-456
Reads directory entries, filters dotfiles, sorts dirs-first, truncates to 200, returns JSON with type/path/entries/error.

### DIR_PICKER_NAVIGATION
// SOURCE: mobile/src/components/DirPicker.tsx
Navigates directories by tapping folders; shows breadcrumb path; back button to parent.

### DIFF_VIEW_CODE_DISPLAY
// SOURCE: mobile/src/components/DiffView.tsx
Monospace font, line numbers, color-coded content display.

### SECURITY_CONSTRAINT
// SOURCE: src/ws.rs:408
Path must be within $HOME — `canonical.starts_with(&home)` check prevents directory traversal.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/ws.rs` | UPDATE | Add `read_file` and `write_file` WS message handlers |
| `mobile/src/types/index.ts` | UPDATE | Add `FileContent` and `FileWriteResult` interfaces |
| `mobile/src/screens/FileBrowserScreen.tsx` | CREATE | File tree navigation + file viewer |
| `mobile/src/components/FileViewer.tsx` | CREATE | Read-only file content display with syntax hints |
| `mobile/src/components/ConfigEditor.tsx` | CREATE | TextInput-based editor for .claude/ files |
| `mobile/src/hooks/useClaudedWS.ts` | UPDATE | Add readFile, writeFile WS methods |
| `mobile/src/screens/MainScreen.tsx` | UPDATE | Add Files button/tab |
| `mobile/src/screens/SettingsScreen.tsx` | UPDATE | Add "Project Files" nav button |

## NOT Building

- Full IDE / code editor (TextInput only, not Monaco/CodeMirror)
- File creation / deletion from mobile
- Git operations from mobile
- Binary file viewing (images, etc.)
- Syntax highlighting library (use monospace + basic line numbers for v1)
- File search / grep from mobile

---

## Step-by-Step Tasks

### Task 1: Add read_file WS handler (daemon)
- **ACTION**: New `read_file` message type that returns file contents
- **IMPLEMENT**:
  ```rust
  } else if msg_type == "read_file" {
      let raw_path = v.get("path").and_then(|p| p.as_str()).unwrap_or("");
      // Expand ~ , canonicalize, check starts_with(home)
      // Read file contents (cap at 500KB to prevent OOM)
      // Return {type: "file_content", path, content, size, error?}
  }
  ```
- **MIRROR**: LIST_DIR_HANDLER security checks (home directory restriction)
- **IMPORTS**: `std::fs`
- **GOTCHA**: Cap file size (500KB); reject binary files (check for null bytes in first 8KB); path must be within $HOME
- **VALIDATE**: `cargo test`; wscat sends read_file, gets content back

### Task 2: Add write_file WS handler (daemon)
- **ACTION**: New `write_file` message type that writes file contents — RESTRICTED to `.claude/` directory
- **IMPLEMENT**:
  ```rust
  } else if msg_type == "write_file" {
      let raw_path = v.get("path").and_then(|p| p.as_str()).unwrap_or("");
      let content = v.get("content").and_then(|c| c.as_str()).unwrap_or("");
      // Expand ~ , canonicalize parent, check starts_with(home)
      // SECURITY: Only allow writes to paths containing "/.claude/"
      // Write atomically (write to .tmp, rename)
      // Return {type: "file_written", path, ok: true/false, error?}
  }
  ```
- **MIRROR**: LIST_DIR_HANDLER security checks + `write_config_atomic` pattern from config.rs
- **IMPORTS**: `std::fs`, `std::io::Write`
- **GOTCHA**: CRITICAL — write_file MUST be restricted to `.claude/` paths only. Do NOT allow arbitrary file writes from mobile. This is a security boundary.
- **VALIDATE**: Can write to `~/.claude/CLAUDE.md`; rejected for paths outside `.claude/`

### Task 3: Add TypeScript types
- **ACTION**: Add interfaces for file operations
- **IMPLEMENT**:
  ```typescript
  export interface FileContentEvent {
    type: 'file_content';
    path: string;
    content?: string;
    size?: number;
    error?: string;
  }

  export interface FileWriteResultEvent {
    type: 'file_written';
    path: string;
    ok: boolean;
    error?: string;
  }
  ```
- **MIRROR**: Existing event interfaces (DirListingEvent)
- **IMPORTS**: N/A
- **GOTCHA**: N/A
- **VALIDATE**: TypeScript compiles

### Task 4: Add WS methods to useClaudedWS
- **ACTION**: Add readFile and writeFile methods
- **IMPLEMENT**:
  - `readFile(path: string)` → sends `{type: "read_file", path}`
  - `writeFile(path: string, content: string)` → sends `{type: "write_file", path, content}`
  - Handle incoming `file_content` and `file_written` messages with callbacks
- **MIRROR**: Existing listDir callback pattern in useClaudedWS
- **IMPORTS**: FileContentEvent, FileWriteResultEvent
- **GOTCHA**: Use callback pattern like listDir (not stored in state — files can be large)
- **VALIDATE**: Hook methods callable

### Task 5: Create FileViewer component
- **ACTION**: Read-only file content display
- **IMPLEMENT**:
  - Monospace ScrollView with line numbers
  - File path header with breadcrumb
  - "Edit" button visible only for `.claude/` files
  - Loading state while fetching
  - Error state for unreadable files
  - "File too large" message for >500KB
- **MIRROR**: DIFF_VIEW_CODE_DISPLAY patterns
- **IMPORTS**: ScrollView, Text, StyleSheet
- **GOTCHA**: Large files may cause performance issues — virtualize if needed or cap display
- **VALIDATE**: Renders file content with line numbers

### Task 6: Create ConfigEditor component
- **ACTION**: TextInput-based editor for `.claude/` files
- **IMPLEMENT**:
  - Multiline TextInput with monospace font
  - Save button → calls writeFile
  - Cancel button → reverts to original content
  - Success/error feedback after save
  - Unsaved changes warning
- **MIRROR**: Existing TextInput patterns in SettingsScreen
- **IMPORTS**: TextInput, Pressable
- **GOTCHA**: TextInput can be slow for large files on RN; cap editable file size at 50KB
- **VALIDATE**: Can edit and save CLAUDE.md

### Task 7: Create FileBrowserScreen
- **ACTION**: Full file browser screen with navigation
- **IMPLEMENT**:
  - Uses existing `listDir` WS message for navigation
  - FlatList of entries: folder icon for dirs, file icon for files
  - Tap folder → navigate into it (push path onto stack)
  - Tap file → open FileViewer
  - Breadcrumb path at top with tappable segments
  - Back button to parent directory
  - Starting path: project work_dir from active session (or ~)
- **MIRROR**: DIR_PICKER_NAVIGATION (DirPicker.tsx)
- **IMPORTS**: DirEntry, listDir, readFile
- **GOTCHA**: Don't show dotfiles (already filtered by daemon); handle permission errors gracefully
- **VALIDATE**: Can navigate directories; can open files

### Task 8: Integrate into MainScreen and Settings
- **ACTION**: Add Files access points
- **IMPLEMENT**:
  - MainScreen: "Files" button in header/toolbar area (next to Settings gear)
  - SettingsScreen: "Project Files" button (like Skills, History)
  - Pass relevant props (listDir, readFile, writeFile) through
- **MIRROR**: Existing Settings/Skills navigation pattern
- **IMPORTS**: FileBrowserScreen
- **GOTCHA**: Don't overcrowd the MainScreen header
- **VALIDATE**: Navigation works from both entry points

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| read_file returns content | Valid path in $HOME | file_content with content | No |
| read_file rejects outside $HOME | /etc/passwd | Error response | Yes — SECURITY |
| read_file rejects large file | >500KB file | Error: file too large | Yes |
| write_file to .claude/ | Valid .claude/ path | file_written ok:true | No |
| write_file outside .claude/ | src/main.rs | Error: writes restricted | Yes — SECURITY |
| write_file path traversal | .claude/../../etc/passwd | Error: outside home | Yes — SECURITY |
| FileBrowserScreen renders | Dir entries | FlatList visible | No |

### Edge Cases Checklist
- [ ] Path traversal attack: `../../etc/passwd` — rejected
- [ ] Symlink escape: symlink pointing outside $HOME — rejected (canonicalize resolves)
- [ ] Binary file: null bytes detected — "Binary file, cannot display"
- [ ] Empty file: shows empty content, not error
- [ ] Permission denied: clear error message
- [ ] Very long file path: truncated in breadcrumb

---

## Validation Commands

### Rust Tests
```bash
cargo test
```
EXPECT: All tests pass

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
- [ ] Cannot read files outside $HOME
- [ ] Cannot write files outside `.claude/` directory
- [ ] Path traversal attempts rejected
- [ ] Symlinks resolved before access check

---

## Acceptance Criteria
- [ ] File browser navigates project tree
- [ ] Files display with line numbers
- [ ] CLAUDE.md editable and savable from mobile
- [ ] Write restricted to `.claude/` paths only
- [ ] Read restricted to $HOME
- [ ] All security tests pass
- [ ] Accessible from MainScreen and Settings

## Completion Checklist
- [ ] Security checks on all file operations
- [ ] Follows WS message handler patterns
- [ ] Follows existing dir navigation patterns
- [ ] Error handling on file I/O
- [ ] No path traversal vulnerabilities

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Path traversal vulnerability | Medium | Critical | Canonicalize + starts_with(home) + .claude/ restriction for writes |
| Large file OOM on mobile | Medium | High | Cap at 500KB read, 50KB edit |
| Slow TextInput for large files | Medium | Medium | Cap editable size; consider read-only for large files |

## Notes
- write_file is intentionally restricted to `.claude/` only. General file editing from mobile is too risky. Users edit CLAUDE.md, agents.md, settings — not source code.
- Future enhancement: syntax highlighting via a lightweight library (e.g., react-native-syntax-highlighter)
- Future enhancement: file search/grep from mobile

# Plan: Session Search + Unread Indicators + Kanban View

## Summary
Bundle three session management UX improvements: (1) full-text search across past sessions, (2) unread/needs-attention indicators on session cards, and (3) an optional kanban board view that organizes sessions by status phase. Builds on existing SessionHistoryScreen and SessionCard.

## User Story
As a power user running multiple concurrent sessions,
I want better session organization and discovery,
So that I can find past sessions quickly, know which active session needs my attention, and organize work visually.

## Problem → Solution
Past sessions are a flat time-sorted list with no search; active sessions don't show attention indicators; no visual organization beyond a horizontal card row → Add search, unread badges, and kanban.

## Metadata
- **Complexity**: Medium
- **Source PRD**: Competitive gap analysis (Nimbalyst: kanban + search; Warp: unread indicators)
- **PRD Phase**: N/A
- **Estimated Files**: 7-10

---

## UX Design

### Before
```
┌─────────────────────────────┐
│ Session Cards (horizontal)  │
│ [session1] [session2]       │
│                             │
│ Session History:            │
│ • session_abc (42 events)   │
│ • session_def (18 events)   │
│ (flat list, no search)      │
└─────────────────────────────┘
```

### After
```
┌─────────────────────────────┐
│ [🔍 Search sessions...]     │
│                             │
│ Session Cards:              │
│ [session1 🔴] [session2 ✓]  │
│  (red dot = needs attention) │
│                             │
│ ── Kanban Toggle ────────── │
│ [List] [Board]              │
│                             │
│ ┌─Running──┐ ┌─Waiting──┐  │
│ │session1  │ │          │  │
│ │session3  │ │          │  │
│ └──────────┘ └──────────┘  │
│ ┌─Complete─┐ ┌─Failed───┐  │
│ │session2  │ │session4  │  │
│ └──────────┘ └──────────┘  │
│                             │
│ Session History:            │
│ [🔍 Search: "deploy"]       │
│ • session_abc — "deploy…"   │
│ • session_ghi — "deploy…"   │
└─────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Finding past sessions | Scroll through flat list | Search by prompt text | Search bar at top |
| Active session attention | Check each session manually | Red dot / badge on cards needing action | Approval pending, error, agent question |
| Session organization | Horizontal card row | Optional kanban board grouped by status | Toggle between list/board |
| Session status | Status dot only (green/gray) | Status + phase label + attention indicator | Richer metadata |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `mobile/src/components/SessionCard.tsx` | all | Current card — add unread indicator |
| P0 | `mobile/src/screens/SessionHistoryScreen.tsx` | all | Past sessions list — add search |
| P0 | `mobile/src/screens/MainScreen.tsx` | all | Session card row — add kanban view |
| P1 | `mobile/src/hooks/useClaudedWS.ts` | all | Session/event state |
| P1 | `src/db.rs` | all | Session search query |
| P1 | `src/ws.rs` | 365-396 | Past sessions / history handlers |
| P2 | `mobile/src/types/index.ts` | all | SessionInfo, PastSessionInfo |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| No external research needed | N/A | Extends existing patterns |

---

## Patterns to Mirror

### SESSION_CARD
// SOURCE: mobile/src/components/SessionCard.tsx
Card with agent label, prompt preview, status dot, elapsed time, token counts.

### SESSION_HISTORY_SCREEN
// SOURCE: mobile/src/screens/SessionHistoryScreen.tsx
Two-panel: session list (FlatList) + event replay. Lists past sessions from `list_past_sessions` WS message.

### DB_QUERY_PATTERN
// SOURCE: src/db.rs:55-65 (events_since)
Prepared statement with params, query_map, collect into Vec.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db.rs` | UPDATE | Add `search_sessions(query)` function with FTS or LIKE |
| `src/ws.rs` | UPDATE | Add `search_sessions` WS message handler |
| `mobile/src/types/index.ts` | UPDATE | Add SearchResult type, SessionPhase enum |
| `mobile/src/components/SessionCard.tsx` | UPDATE | Add unread/attention indicator badge |
| `mobile/src/components/KanbanBoard.tsx` | CREATE | Kanban view grouping sessions by phase |
| `mobile/src/screens/SessionHistoryScreen.tsx` | UPDATE | Add search bar and search functionality |
| `mobile/src/hooks/useClaudedWS.ts` | UPDATE | Add searchSessions method; track unread state per session |
| `mobile/src/screens/MainScreen.tsx` | UPDATE | Add kanban toggle; pass unread state |

## NOT Building

- Drag-and-drop between kanban columns (status is automatic)
- Session tagging or manual categorization
- Full-text search within file contents
- Session archiving
- Kanban for past/completed sessions (active sessions only)

---

## Step-by-Step Tasks

### Task 1: Add search_sessions DB function
- **ACTION**: Add SQL query to search past sessions by prompt text
- **IMPLEMENT**:
  ```rust
  pub fn search_sessions(conn: &Connection, query: &str) -> Result<Vec<Value>> {
      let pattern = format!("%{query}%");
      let mut stmt = conn.prepare(
          "SELECT DISTINCT session_id, MIN(ts) as started_at, COUNT(*) as event_count, MAX(ts) as last_event
           FROM events
           WHERE json LIKE ?1 OR session_id LIKE ?1
           GROUP BY session_id
           ORDER BY started_at DESC
           LIMIT 50"
      )?;
      // ... collect results
  }
  ```
- **MIRROR**: DB_QUERY_PATTERN (events_since)
- **IMPORTS**: `rusqlite::{Connection, params}`, `serde_json::Value`
- **GOTCHA**: LIKE with `%query%` is slow on large tables. For v1 this is fine; can add FTS5 later if needed. Limit to 50 results.
- **VALIDATE**: `cargo test`; search returns matching sessions

### Task 2: Add search_sessions WS handler
- **ACTION**: New `search_sessions` message type
- **IMPLEMENT**:
  ```rust
  } else if msg_type == "search_sessions" {
      let query = v.get("query").and_then(|q| q.as_str()).unwrap_or("");
      let db2 = db.clone();
      let q = query.to_string();
      let results = tokio::task::spawn_blocking(move || {
          let conn = db2.lock().unwrap();
          db::search_sessions(&conn, &q)
      }).await.context("spawn_blocking panicked")?.unwrap_or_default();
      let reply = serde_json::to_string(&serde_json::json!({
          "type": "search_results",
          "query": query,
          "sessions": results,
      })).unwrap_or_default();
      // send reply
  }
  ```
- **MIRROR**: list_past_sessions handler pattern
- **IMPORTS**: `crate::db`
- **GOTCHA**: Sanitize query input (no SQL injection — already using params)
- **VALIDATE**: WS message returns results

### Task 3: Add unread/attention tracking to useClaudedWS
- **ACTION**: Track which sessions have unresolved attention items
- **IMPLEMENT**:
  - New state: `unreadSessions: Set<string>` — sessions with unread activity
  - Session marked "needs attention" when:
    - Has pending approval (`approval_pending` event)
    - Has error/failure event
    - Agent is waiting for input (detected question pattern)
  - Session cleared from unread when:
    - User switches to that session (sets it as active)
    - All approvals resolved
  - Expose: `hasUnread(sessionId): boolean`
- **MIRROR**: Existing pendingApprovals tracking
- **IMPORTS**: N/A
- **GOTCHA**: Don't mark the currently active session as unread
- **VALIDATE**: Sessions with pending approvals show as unread

### Task 4: Add attention badge to SessionCard
- **ACTION**: Visual indicator on session cards needing attention
- **IMPLEMENT**:
  - Red dot badge (top-right corner of card) when `hasUnread(session_id)`
  - Badge shows count if multiple attention items (e.g., "3" for 3 pending approvals)
  - Subtle pulse animation on badge
  - Yellow border (existing hasPendingApproval) continues to work
  - New: red border for error/failed sessions
- **MIRROR**: SESSION_CARD existing styling
- **IMPORTS**: Animated, View
- **GOTCHA**: Don't show badge on the currently active/visible session
- **VALIDATE**: Badge appears on non-active session with pending approval

### Task 5: Add search to SessionHistoryScreen
- **ACTION**: Search bar at top of session history
- **IMPLEMENT**:
  - TextInput with search icon, debounced (300ms)
  - On type: send `search_sessions` WS message
  - Results replace the full session list when searching
  - Clear button to return to full list
  - "No results" state
  - Highlight matching text in results
- **MIRROR**: SESSION_HISTORY_SCREEN FlatList pattern
- **IMPORTS**: TextInput, useDebounce pattern
- **GOTCHA**: Debounce to avoid hammering the daemon on every keystroke
- **VALIDATE**: Typing filters sessions; clearing restores full list

### Task 6: Create KanbanBoard component
- **ACTION**: Optional board view grouping active sessions by phase
- **IMPLEMENT**:
  - Phases (columns): Running | Waiting (needs input/approval) | Complete | Failed
  - Each column: vertical list of mini session cards
  - Session auto-categorized by state:
    - Running: has active process, no pending approvals
    - Waiting: has pending approval or agent question
    - Complete: session ended with result
    - Failed: session ended with error
  - Tap card → switch to that session
  - Horizontal ScrollView of columns on mobile
  - Phase headers with count badges
- **MIRROR**: SESSION_CARD for mini cards
- **IMPORTS**: ScrollView, FlatList, View
- **GOTCHA**: Works best with 3+ sessions; single session is better as default list view. Only show kanban toggle when 2+ sessions exist.
- **VALIDATE**: Sessions grouped correctly; tapping navigates

### Task 7: Add kanban toggle to MainScreen
- **ACTION**: Toggle between list (current horizontal cards) and kanban board
- **IMPLEMENT**:
  - Small toggle: [List | Board] segmented control
  - Only shown when 2+ active sessions
  - Default: List (current behavior)
  - Board: renders KanbanBoard component
  - Persist preference in AsyncStorage
- **MIRROR**: Existing MainScreen layout patterns
- **IMPORTS**: KanbanBoard, AsyncStorage
- **GOTCHA**: Single session should always use current list/card view
- **VALIDATE**: Toggle switches views; preference persists

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| search_sessions finds match | "deploy" query | Sessions with "deploy" in prompt | No |
| search_sessions no match | "zzzzz" query | Empty array | Yes |
| search_sessions empty query | "" | All sessions (limited) | Yes |
| SessionCard shows badge | Session with pending approval, not active | Red dot visible | No |
| SessionCard no badge when active | Active session with approval | No badge (user is looking at it) | Yes |
| KanbanBoard groups correctly | 2 running, 1 waiting | Correct column placement | No |
| KanbanBoard hidden with 1 session | 1 session | Toggle not shown | Yes |

### Edge Cases Checklist
- [ ] 0 sessions — kanban toggle hidden
- [ ] 1 session — kanban toggle hidden
- [ ] 10+ sessions — kanban scrolls horizontally
- [ ] Search with special characters — no crash
- [ ] All sessions in one phase — other columns show empty state
- [ ] Rapid session status changes — board updates correctly

---

## Validation Commands

### Rust Tests
```bash
cargo test
```
EXPECT: All tests pass

### Mobile Tests
```bash
cd mobile && npx jest
```
EXPECT: All tests pass

### Manual Validation
- [ ] Search "test" in session history → filtered results
- [ ] Clear search → full list
- [ ] Start 3 sessions → kanban toggle appears
- [ ] Session with pending approval shows red dot on card
- [ ] Switch to session → badge clears
- [ ] Kanban groups sessions by Running/Waiting/Complete

---

## Acceptance Criteria
- [ ] Session search works across past sessions
- [ ] Unread badges appear on session cards needing attention
- [ ] Kanban board groups sessions by phase
- [ ] All features are additive (don't break existing session UI)
- [ ] Tests pass

## Completion Checklist
- [ ] Search uses parameterized queries (no SQL injection)
- [ ] Badge logic excludes active session
- [ ] Kanban only shows with 2+ sessions
- [ ] Follows existing component patterns
- [ ] Preference persisted

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Search slow on large event tables | Low | Medium | LIMIT 50; add FTS5 index if needed |
| Kanban adds UI complexity | Medium | Low | Only shown for 2+ sessions; default is list |
| Unread tracking state drift | Low | Medium | Clear on session switch; conservative marking |

## Notes
- Kanban is for ACTIVE sessions only; past sessions stay in the history list with search
- Future enhancement: FTS5 virtual table for faster full-text search
- Future enhancement: custom kanban columns / labels

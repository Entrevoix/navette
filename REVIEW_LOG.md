# Review Log

Tracks devil's advocate code reviews for each plan execution.

## Plan 7: session-search-kanban-indicators

**Branch:** `feat/session-search-kanban`
**Date:** 2026-04-24
**Review rounds:** 5

### Round Breakdown

| Topic | Rounds | Action Items |
|---|---|---|
| Correctness | 2 | 2 |
| Error handling | 1 | 1 |
| Performance | 1 | 1 |
| Security | 0 | 0 |
| Maintainability | 1 | 1 |
| Testing gaps | 0 | 0 |
| **Total** | **5** | **5** |

### Action Items (5)

1. **[FIXED]** classifyPhase used broken pendingApprovals check — replaced with hasUnread function
2. **[FIXED]** Removed pendingApprovals from KanbanBoard props (unused after fix 1)
3. **[FIXED]** Escape LIKE metacharacters (`%`, `_`) in db.rs search_sessions with ESCAPE clause
4. **[FIXED]** Guard unnecessary Set recreation in setUnreadSessions (skip if already contains session_id)
5. **[DEFERRED]** Add unit test for search_sessions LIKE escaping — deferred to testing plan

### Open Disagreements

None — all items resolved.

---

## Plan 8: navette-ux-fixes

**Branch:** `feat/navette-ux-fixes`
**Date:** 2026-04-24
**Review rounds:** 5
**Note:** 95% of plan was already implemented in prior sessions. This pass added file attachment UI (the one remaining gap).

### Round Breakdown

| Topic | Rounds | Action Items |
|---|---|---|
| Correctness | 2 | 2 |
| Error handling | 1 | 1 |
| Performance | 0 | 0 |
| Security | 0 | 0 |
| Maintainability | 1 | 1 |
| Testing gaps | 1 | 0 |
| **Total** | **5** | **4** |

### Action Items (4)

1. **[FIXED]** Allow sending when only files attached (no text required)
2. **[FIXED]** Fix implicit `any` types in filter/map callbacks
3. **[FIXED]** Cap attached files at 5
4. **[FIXED]** Extract `AttachedFile` named type to avoid repetition

### Open Disagreements

None.

### Deferred Concerns

- Extract file attachment logic to `useFileAttachments` hook for testability
- `upload_file` WS handler needed for full file attachment support

---

## Plans 1–6

Completed in prior sessions. See git history on `main` for details.

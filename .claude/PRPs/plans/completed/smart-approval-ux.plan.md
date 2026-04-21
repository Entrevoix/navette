# Plan: Smart Approval UX (Batch Approve, Button Responses, Per-Hunk Accept/Revert)

## Summary
Overhaul the approval workflow with three complementary features: (1) batch approve/deny multiple pending tool calls at once, (2) button-based quick responses for detected yes/no/choice questions from the agent, and (3) per-hunk accept/revert controls in the diff viewer. This is the single biggest UX gap vs Warp and Nimbalyst.

## User Story
As a mobile user managing an active agent session,
I want smarter approval controls,
So that I can batch-approve safe operations, respond to agent questions with one tap, and selectively accept/reject individual diff hunks.

## Problem → Solution
Current flow: one approval at a time, text-only responses, binary approve/deny per tool call → Batch approvals, detected-question buttons, and per-hunk granularity.

## Metadata
- **Complexity**: Large
- **Source PRD**: Competitive gap analysis (Warp: batch feedback; ClawTab: button responses; Nimbalyst: per-hunk accept/revert)
- **PRD Phase**: N/A
- **Estimated Files**: 8-12

---

## UX Design

### Before
```
┌─────────────────────────────┐
│  🔧 Edit src/main.rs        │
│  [Permit] [Deny]            │
│                             │
│  🔧 Write tests/test.rs     │
│  [Permit] [Deny]            │
│                             │
│  🔧 Run cargo test          │
│  [Permit] [Deny]            │
│  (approve each one by one)  │
└─────────────────────────────┘
```

### After
```
┌─────────────────────────────┐
│  3 pending approvals        │
│  [✅ Approve All] [❌ Deny All] │
│                             │
│  🔧 Edit src/main.rs   [✓][✗] │
│  🔧 Write tests/       [✓][✗] │
│  🔧 Run cargo test     [✓][✗] │
│                             │
│  ── Agent asks: ──────────── │
│  "Should I also update the  │
│   README?"                   │
│  [Yes] [No] [Skip]          │
│                             │
│  ── Diff: src/main.rs ───── │
│  @@ -10,3 +10,5 @@          │
│  + fn new_helper() {  [✓][✗] │
│  + }                         │
│  @@ -25,2 +27,4 @@          │
│  + use crate::helper; [✓][✗] │
└─────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Multiple approvals | Tap each Permit/Deny | "Approve All" / "Deny All" + individual | Batch at top, individual below |
| Agent questions | Type text response | Detected buttons: Yes/No/Skip/custom | Pattern matching on agent output |
| Diff review | Approve/deny whole tool call | Per-hunk accept/revert toggles | Hunk-level granularity |
| Approval feedback | "Approved" flash | Inline checkmark + count remaining | Better feedback |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `mobile/src/components/ApprovalCard.tsx` | all | Current approval UI — primary modification target |
| P0 | `mobile/src/components/ChatView.tsx` | all | Where agent messages render — question detection goes here |
| P0 | `mobile/src/components/DiffView.tsx` | all | Current diff viewer — add per-hunk controls |
| P0 | `mobile/src/hooks/useClaudedWS.ts` | all | Approval handling + sendInput |
| P1 | `src/ws.rs` | 190-270 | How permit/deny are processed server-side |
| P1 | `mobile/src/types/index.ts` | all | PendingApproval type |
| P2 | `mobile/src/screens/MainScreen.tsx` | all | How approvals flow to ApprovalCard |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| No external research needed | N/A | Extends existing patterns |

---

## Patterns to Mirror

### APPROVAL_CARD
// SOURCE: mobile/src/components/ApprovalCard.tsx
Renders tool_name, tool_input, countdown, Permit/Deny buttons. Calls `onDecide(tool_use_id, allow)`.

### DIFF_VIEW
// SOURCE: mobile/src/components/DiffView.tsx
Parses unified diff format, renders +/- lines with coloring, collapsible hunk headers.

### SEND_INPUT
// SOURCE: mobile/src/hooks/useClaudedWS.ts
`sendInput(text)` sends free-text to the active session via `{type: "input", text, session_id}`.

### DECISION_HANDLER
// SOURCE: src/ws.rs (handle_input function)
Permit/deny messages match on tool_use_id and resolve the oneshot channel.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `mobile/src/components/ApprovalCard.tsx` | UPDATE | Add batch approve/deny controls when multiple pending |
| `mobile/src/components/BatchApprovalBar.tsx` | CREATE | "Approve All (3)" / "Deny All" sticky bar |
| `mobile/src/components/QuickResponseButtons.tsx` | CREATE | Detected-question button renderer |
| `mobile/src/components/DiffView.tsx` | UPDATE | Add per-hunk accept/revert toggles |
| `mobile/src/components/ChatView.tsx` | UPDATE | Integrate QuickResponseButtons for detected questions |
| `mobile/src/hooks/useClaudedWS.ts` | UPDATE | Add batchDecide method |
| `mobile/src/types/index.ts` | UPDATE | Add QuickResponse type |
| `mobile/src/screens/MainScreen.tsx` | UPDATE | Pass batch approval props |

## NOT Building

- AI-powered auto-approve based on risk assessment (future)
- Approval rules/policies (e.g., "always approve read operations")
- Inline code comments on diffs (Warp feature — separate PR)
- Editing diffs before approving (Nimbalyst "edit" option — complex, future)

---

## Step-by-Step Tasks

### Task 1: Create BatchApprovalBar component
- **ACTION**: Sticky bar that appears when 2+ approvals are pending
- **IMPLEMENT**:
  - Shows count: "3 pending approvals"
  - "Approve All" button (green) — calls onDecide for each pending tool_use_id with allow=true
  - "Deny All" button (red) — calls onDecide for each pending tool_use_id with allow=false
  - Animates in when count >= 2, out when < 2
  - Individual ApprovalCards still shown below for selective action
- **MIRROR**: APPROVAL_CARD styling patterns
- **IMPORTS**: Pressable, Text, View, Animated
- **GOTCHA**: Must iterate through all pending approvals and call onDecide for each; don't send a single batch message (daemon expects individual permit/deny per tool_use_id)
- **VALIDATE**: Bar appears with 2+ approvals; approve all resolves all

### Task 2: Add batchDecide to useClaudedWS
- **ACTION**: Convenience method that calls decide() for multiple tool_use_ids
- **IMPLEMENT**:
  ```typescript
  const batchDecide = useCallback((allow: boolean) => {
    pendingApprovals.forEach(a => decide(a.tool_use_id, allow));
  }, [pendingApprovals, decide]);
  ```
- **MIRROR**: Existing decide pattern
- **IMPORTS**: N/A
- **GOTCHA**: Iterate and send individual messages; daemon handles each separately
- **VALIDATE**: All pending approvals resolved

### Task 3: Create QuickResponseButtons component
- **ACTION**: Detect yes/no/choice questions in agent output and render tappable buttons
- **IMPLEMENT**:
  - Pattern matching on last assistant text block:
    - Ends with `?` → show [Yes] [No] buttons
    - Contains "y/n" or "Y/N" → show [Yes] [No]
    - Contains numbered options ("1.", "2.", "3.") → show numbered buttons
    - Contains "(approve/deny)" or "(allow/reject)" → show [Approve] [Deny]
    - Contains "continue?" → show [Continue] [Stop]
  - Tapping a button calls `onSendInput(buttonText)`
  - Buttons appear below the last message, styled as pills
  - Auto-hide when new agent message arrives
- **MIRROR**: N/A — new pattern, but uses existing sendInput mechanism
- **IMPORTS**: Pressable, Text, View
- **GOTCHA**: Don't be too aggressive with detection — false positives are worse than missing a question. Only trigger on clear patterns. Questions within code blocks should be ignored.
- **VALIDATE**: Detected questions show buttons; tapping sends text

### Task 4: Integrate QuickResponseButtons into ChatView
- **ACTION**: Render QuickResponseButtons after the last assistant message
- **IMPLEMENT**:
  - After the last text block in the event feed, check if it matches a question pattern
  - If yes, render QuickResponseButtons below the message
  - Pass `onSendInput` callback for button actions
  - Hide buttons once user sends any input (text or button)
- **MIRROR**: Existing ChatView message rendering
- **IMPORTS**: QuickResponseButtons
- **GOTCHA**: Only show for the LAST message; don't accumulate buttons for old messages
- **VALIDATE**: Buttons appear for questions; disappear after response

### Task 5: Add per-hunk controls to DiffView
- **ACTION**: Add accept/revert toggle per diff hunk
- **IMPLEMENT**:
  - Parse diff into hunks (already done by existing DiffView)
  - Add [✓] [✗] buttons next to each hunk header (`@@ ... @@`)
  - Track hunk states: `accepted` | `reverted` | `pending` (default: pending)
  - Visual feedback: accepted hunks have green left border; reverted have red with strikethrough
  - "Apply" button at bottom sends the decision
  - For tool_result diffs: this is informational only (agent already made the change)
  - For approval_pending diffs: per-hunk state feeds into the approve/deny decision
- **MIRROR**: DIFF_VIEW existing hunk parsing
- **IMPORTS**: Pressable, View
- **GOTCHA**: Per-hunk accept/revert is primarily visual feedback for now — the daemon doesn't support partial approval of a tool call. The UX value is: user reviews each hunk and then makes an informed approve/deny decision for the whole tool call. Full partial-apply support requires daemon changes (future).
- **VALIDATE**: Hunk controls render; toggling changes visual state

### Task 6: Connect per-hunk review to approval decision
- **ACTION**: When all hunks reviewed, surface a summary before final approve/deny
- **IMPLEMENT**:
  - If user marks any hunk as "reverted", show warning: "You rejected N hunks — deny this change? Or approve and fix manually?"
  - Summary: "3/5 hunks accepted, 2/5 rejected"
  - Final action still sends single permit or deny (daemon limitation)
  - Future: could send hunk-level feedback as text input to agent
- **MIRROR**: APPROVAL_CARD decision flow
- **IMPORTS**: N/A
- **GOTCHA**: This is an informed-decision UX, not actual partial-apply. Make this clear to user.
- **VALIDATE**: Summary appears; decision sent correctly

### Task 7: Update MainScreen props
- **ACTION**: Thread batch approval and quick response props through
- **IMPLEMENT**:
  - Pass `batchDecide` to approval area
  - Pass `onSendInput` to ChatView for quick response buttons
  - BatchApprovalBar rendered above individual ApprovalCards
- **MIRROR**: Existing prop threading in MainScreen
- **IMPORTS**: BatchApprovalBar
- **GOTCHA**: Keep prop count manageable
- **VALIDATE**: All new components receive correct props

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| BatchApprovalBar shows with 2+ | 3 pending approvals | Bar visible with "3 pending" | No |
| BatchApprovalBar hidden with 1 | 1 pending approval | Bar not rendered | Yes |
| Approve All calls decide for each | 3 pending, tap approve | 3 decide calls with allow=true | No |
| QuickResponse detects "?" | "Should I continue?" | [Yes] [No] buttons shown | No |
| QuickResponse ignores code block | "```\nShould I?\n```" | No buttons | Yes |
| QuickResponse detects numbered | "1. Option A\n2. Option B" | [1] [2] buttons | No |
| DiffView hunk toggle | Tap ✗ on hunk | Hunk marked reverted | No |
| DiffView summary | 2 accepted, 1 reverted | "2/3 hunks accepted" | No |

### Edge Cases Checklist
- [ ] 0 pending approvals — batch bar hidden
- [ ] 1 pending — batch bar hidden, normal ApprovalCard
- [ ] 10+ pending — batch bar + scrollable list
- [ ] Question in code block — not detected
- [ ] Question in markdown — detected
- [ ] Empty diff — no hunk controls
- [ ] Single-hunk diff — controls shown but no summary needed
- [ ] Rapid approve/deny — no double-send

---

## Validation Commands

### Mobile Tests
```bash
cd mobile && npx jest
```
EXPECT: All tests pass

### Type Check
```bash
cd mobile && npx tsc --noEmit
```
EXPECT: No type errors

### Manual Validation
- [ ] Trigger 3 approvals → batch bar shows "3 pending"
- [ ] Tap "Approve All" → all 3 resolved
- [ ] Agent asks yes/no question → buttons appear
- [ ] Tap "Yes" button → text sent to agent
- [ ] Open diff with 3 hunks → per-hunk toggles visible
- [ ] Mark hunk as reverted → visual change + summary

---

## Acceptance Criteria
- [ ] Batch approve/deny works for 2+ pending approvals
- [ ] Quick response buttons detect common question patterns
- [ ] Per-hunk accept/revert toggles render in DiffView
- [ ] All features are additive (don't break existing single approve/deny)
- [ ] Tests written and passing

## Completion Checklist
- [ ] ApprovalCard still works individually
- [ ] Quick response doesn't false-positive on code blocks
- [ ] Per-hunk is informational (doesn't promise partial apply)
- [ ] No daemon changes needed (all mobile-side)
- [ ] Error handling for rapid interactions

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Quick response false positives | Medium | Medium | Conservative pattern matching; ignore code blocks; only last message |
| Per-hunk UX misleading (user thinks partial apply works) | Medium | High | Clear messaging: "Review hunks, then approve or deny the full change" |
| Batch approve race condition | Low | Medium | Send decisions sequentially with small delay between |

## Notes
- No daemon changes needed for this PR — all mobile-side UX improvements
- Per-hunk partial-apply would require a new daemon message type and integration with the agent's undo mechanism — tracked as future enhancement
- Quick response detection could later be enhanced with LLM-based classification, but regex patterns are sufficient for v1

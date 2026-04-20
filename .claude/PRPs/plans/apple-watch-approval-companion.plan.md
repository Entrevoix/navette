# Plan: Apple Watch Approval Companion (Sprint 7)

## Summary
Build a watchOS companion app that receives approval-pending push notifications and lets the user permit/deny tool-use requests directly from the Apple Watch face — no phone unlock required. Includes a complication showing the count of pending approvals.

## User Story
As a developer who is AFK (cooking, walking, gym),
I want to approve or deny agent tool-use requests from my Apple Watch,
So that I can unblock my running agent without finding and unlocking my phone.

## Problem → Solution
Currently the only way to approve/deny is via the phone app → Add watchOS companion that receives approval payloads and provides single-glance permit/deny actions.

## Metadata
- **Complexity**: XL
- **Source PRD**: ROADMAP.md "Sprint 7"
- **PRD Phase**: Sprint 7
- **Estimated Files**: 15-25 (new watchOS target, WatchKit views, WatchConnectivity bridge, push config)
- **Depends on**: PR 1 (Expo 54 upgrade) for iOS build stability

---

## UX Design

### Before
```
┌─────────────────────────────┐
│  Agent needs approval →     │
│  Phone notification →       │
│  Unlock phone →             │
│  Open app →                 │
│  Tap Permit/Deny            │
│  (5+ steps, 15-30 seconds)  │
└─────────────────────────────┘
```

### After
```
┌─────────────────────────────┐
│  Agent needs approval →     │
│  Watch vibrates →           │
│  Glance: tool name +       │
│  truncated input            │
│  Tap ✅ Permit or ❌ Deny   │
│  (2 steps, 3-5 seconds)    │
│                             │
│  Complication: badge "3"    │
│  (pending approval count)   │
└─────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Approval notification | Phone only | Phone + Watch | Watch gets actionable notification |
| Permit/Deny | Phone app only | Watch face action buttons | Direct from notification |
| Pending count | Phone app SessionCard | Watch complication | Always visible on wrist |
| Approval warning | Phone app orange pulse | Watch haptic + red tint | Urgency signal |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `mobile/src/components/ApprovalCard.tsx` | all | Current approval UI — watch must replicate core data |
| P0 | `mobile/src/hooks/useClaudedWS.ts` | all | How approvals arrive and decisions are sent |
| P0 | `mobile/src/types/index.ts` | all | PendingApproval, ApprovalPendingEvent types |
| P0 | `src/ws.rs` | 264-300 | How permit/deny messages are handled server-side |
| P1 | `src/notify.rs` | all | Current notification system — may need to add APNs |
| P1 | `mobile/src/screens/SettingsScreen.tsx` | all | Watch pairing config UI |
| P2 | `src/config.rs` | all | Daemon config — may need APNs config fields |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| WatchConnectivity | Apple docs | iPhone↔Watch message passing; sendMessage for live, transferUserInfo for background |
| WatchKit SwiftUI | Apple docs | SwiftUI is primary for watchOS 10+; WKInterfaceController deprecated |
| Complications | Apple docs | WidgetKit-based complications (watchOS 9+); CLKComplicationDataSource deprecated |
| React Native Watch | react-native-watch-connectivity npm | JS bridge for WatchConnectivity — evaluate vs native Swift |
| APNs for watchOS | Apple docs | Watch receives notifications when phone is locked; actionable categories |

---

## Patterns to Mirror

### APPROVAL_FLOW
// SOURCE: mobile/src/hooks/useClaudedWS.ts
Approval pending events arrive via WS with tool_use_id, tool_name, tool_input, expires_at.
Decision sent as `{type: "permit", tool_use_id}` or `{type: "deny", tool_use_id}`.

### NOTIFICATION_PATTERN
// SOURCE: src/notify.rs
NotifyClient publishes to ntfy.sh / Telegram with title, body, priority, tags.
Watch notifications need a parallel APNs path or WatchConnectivity relay from phone.

### APPROVAL_CARD_DATA
// SOURCE: mobile/src/components/ApprovalCard.tsx
Displays: tool_name, truncated tool_input JSON, countdown timer, Permit/Deny buttons.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `mobile/ios/WatchApp/` | CREATE (directory) | New watchOS app target |
| `mobile/ios/WatchApp/ContentView.swift` | CREATE | Main watch UI: approval list |
| `mobile/ios/WatchApp/ApprovalView.swift` | CREATE | Single approval detail: tool name, input, permit/deny |
| `mobile/ios/WatchApp/ComplicationProvider.swift` | CREATE | WidgetKit complication showing pending count |
| `mobile/ios/WatchApp/WatchSessionManager.swift` | CREATE | WatchConnectivity delegate for phone↔watch messaging |
| `mobile/ios/WatchApp/Info.plist` | CREATE | Watch app config |
| `mobile/ios/clauded.xcodeproj/project.pbxproj` | UPDATE | Add watch target |
| `mobile/src/native/WatchBridge.swift` | CREATE | iOS-side WatchConnectivity bridge |
| `mobile/src/native/WatchBridge.m` | CREATE | RN native module bridge header |
| `mobile/src/hooks/useWatchConnectivity.ts` | CREATE | JS hook wrapping native WatchBridge |
| `mobile/src/hooks/useClaudedWS.ts` | UPDATE | Forward approval events to watch via bridge |
| `mobile/src/screens/SettingsScreen.tsx` | UPDATE | Watch pairing status section |
| `ROADMAP.md` | UPDATE | Mark Sprint 7 as shipped |

## NOT Building

- Android Wear OS companion (iOS/watchOS only)
- Standalone watch app (companion only — requires paired phone)
- Full chat view on watch (approvals only)
- APNs push from daemon (use WatchConnectivity relay from phone for v1)
- Watch app for session management (start/stop/kill)

---

## Step-by-Step Tasks

### Task 1: Research WatchConnectivity vs native Swift approach
- **ACTION**: Evaluate react-native-watch-connectivity vs pure Swift watch app
- **IMPLEMENT**: Decision document — likely pure Swift watch app + RN native module bridge
- **MIRROR**: N/A — research
- **IMPORTS**: N/A
- **GOTCHA**: react-native-watch-connectivity may be unmaintained; check last publish date
- **VALIDATE**: Clear decision on architecture

### Task 2: Create watchOS target in Xcode project
- **ACTION**: Add watchOS app target to the existing Xcode workspace
- **IMPLEMENT**: New WatchKit App target (SwiftUI lifecycle); minimum watchOS 10
- **MIRROR**: Standard Xcode watch target setup
- **IMPORTS**: SwiftUI, WatchConnectivity, WidgetKit
- **GOTCHA**: Must be a companion app, not standalone; bundle ID must be `<ios-bundle-id>.watchkitapp`
- **VALIDATE**: Watch target builds in Xcode

### Task 3: Implement WatchSessionManager (watch side)
- **ACTION**: WatchConnectivity delegate on watch that receives approval data from phone
- **IMPLEMENT**:
  - Activate WCSession on watch launch
  - Receive `sendMessage` for live approval events
  - Receive `transferUserInfo` for queued events when watch wakes
  - Store pending approvals in local array
  - Send permit/deny decisions back to phone via `sendMessage`
- **MIRROR**: Standard WatchConnectivity patterns
- **IMPORTS**: WatchConnectivity
- **GOTCHA**: WCSession must be activated on both sides before messaging works
- **VALIDATE**: Watch receives test message from phone

### Task 4: Build ApprovalView (watch UI)
- **ACTION**: SwiftUI view showing approval details + action buttons
- **IMPLEMENT**:
  - Tool name (large text)
  - Truncated tool_input (2-3 lines)
  - Green "Permit" button
  - Red "Deny" button
  - Countdown timer (seconds remaining)
  - Orange tint when urgent (≤30s)
- **MIRROR**: ApprovalCard.tsx layout adapted for watch constraints
- **IMPORTS**: SwiftUI
- **GOTCHA**: Watch screen is tiny — aggressive truncation needed; tool_input should show first ~80 chars
- **VALIDATE**: View renders correctly in watch simulator

### Task 5: Build ContentView (approval list)
- **ACTION**: Main watch screen listing pending approvals
- **IMPLEMENT**:
  - List of pending approvals (tool_name + countdown)
  - Tap to navigate to ApprovalView detail
  - Empty state: "No pending approvals"
  - Pull to refresh (triggers re-sync from phone)
- **MIRROR**: Standard SwiftUI List + NavigationStack
- **IMPORTS**: SwiftUI
- **GOTCHA**: Keep list minimal — watch has limited memory
- **VALIDATE**: List shows mock approvals; navigation works

### Task 6: Build ComplicationProvider
- **ACTION**: WidgetKit-based complication showing pending approval count
- **IMPLEMENT**:
  - Circular: number badge (e.g., "3")
  - Rectangular: "3 pending" text
  - Update timeline when approval count changes
- **MIRROR**: Standard WidgetKit TimelineProvider
- **IMPORTS**: WidgetKit, SwiftUI
- **GOTCHA**: Complications refresh on a budget — can't update every second; use timeline entries
- **VALIDATE**: Complication renders in simulator with mock data

### Task 7: Implement iOS-side WatchBridge native module
- **ACTION**: React Native native module that bridges WatchConnectivity
- **IMPLEMENT**:
  - Activate WCSession on iOS side
  - `sendApprovalToWatch(approval)`: forward approval event to watch
  - `onWatchDecision(callback)`: receive permit/deny from watch
  - Expose as RN NativeModule
- **MIRROR**: Standard RN native module patterns (Swift + ObjC bridge header)
- **IMPORTS**: WatchConnectivity, React
- **GOTCHA**: RN native modules need both Swift implementation and ObjC bridge
- **VALIDATE**: Can call sendApprovalToWatch from JS

### Task 8: Create useWatchConnectivity hook
- **ACTION**: JS hook wrapping the native WatchBridge
- **IMPLEMENT**:
  - Listen for watch decisions via NativeEventEmitter
  - Expose `sendApprovalToWatch(approval)` function
  - Track watch reachability state
- **MIRROR**: useClaudedWS hook patterns
- **IMPORTS**: NativeModules, NativeEventEmitter
- **GOTCHA**: Only available on iOS; must no-op gracefully on Android
- **VALIDATE**: Hook sends/receives in dev

### Task 9: Integrate with useClaudedWS
- **ACTION**: Forward approval events to watch; handle watch decisions
- **IMPLEMENT**:
  - When approval_pending arrives, call `sendApprovalToWatch()`
  - When watch sends decision, forward as permit/deny WS message
  - When approval resolved/expired, notify watch to remove from list
- **MIRROR**: Existing approval handling in useClaudedWS
- **IMPORTS**: useWatchConnectivity hook
- **GOTCHA**: Must not break existing phone-based approval flow; watch is additive
- **VALIDATE**: End-to-end: daemon → phone WS → watch → user taps → decision sent

### Task 10: Add watch pairing UI to Settings
- **ACTION**: Show watch connectivity status in Settings
- **IMPLEMENT**:
  - "Apple Watch" section
  - Paired/not-paired status
  - Watch reachable indicator
  - Only shown on iOS
- **MIRROR**: Existing SettingsScreen section patterns
- **IMPORTS**: useWatchConnectivity
- **GOTCHA**: Platform.OS check — hide on Android entirely
- **VALIDATE**: Settings shows watch status

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| useWatchConnectivity no-ops on Android | Platform.OS = 'android' | No crash, functions return undefined | Yes |
| Watch receives approval | sendApprovalToWatch() | Watch displays approval | No |
| Watch sends permit | Tap permit on watch | WS message sent to daemon | No |
| Complication updates | Approval count changes | Complication refreshes | No |
| Approval expires | Timer reaches 0 | Removed from watch list | Yes |

### Edge Cases Checklist
- [ ] Watch not paired — phone works normally, no errors
- [ ] Watch out of range — queued via transferUserInfo
- [ ] Multiple pending approvals — list view works
- [ ] Approval resolved on phone — watch removes it
- [ ] Approval expires — watch shows expired state and removes
- [ ] Watch app launched without phone app — shows "Connect phone" message
- [ ] Android device — watch features completely hidden

---

## Validation Commands

### iOS Build
```bash
cd mobile/ios && xcodebuild -workspace *.xcworkspace -scheme clauded -configuration Debug -sdk iphonesimulator build
```
EXPECT: iOS app builds

### Watch Build
```bash
cd mobile/ios && xcodebuild -workspace *.xcworkspace -scheme "clauded WatchKit App" -configuration Debug -sdk watchsimulator build
```
EXPECT: Watch app builds

### Unit Tests
```bash
cd mobile && npx jest
```
EXPECT: All tests pass (including Android no-op tests)

### Manual Validation
- [ ] Pair watch in simulator
- [ ] Start session on phone → trigger approval
- [ ] Watch vibrates and shows approval
- [ ] Tap Permit on watch → agent unblocked
- [ ] Tap Deny on watch → agent receives denial
- [ ] Complication shows pending count
- [ ] Urgent approval (≤30s) shows orange tint on watch

---

## Acceptance Criteria
- [ ] watchOS companion app builds and installs
- [ ] Approval notifications appear on watch
- [ ] Permit/Deny actions work from watch
- [ ] Decisions propagate to daemon correctly
- [ ] Complication shows pending approval count
- [ ] Phone app still works independently
- [ ] Android not affected (no watch features shown)

## Completion Checklist
- [ ] SwiftUI views follow Apple HIG for watchOS
- [ ] WatchConnectivity handles all connection states
- [ ] Error handling for unreachable watch
- [ ] Tests cover both iOS and Android paths
- [ ] No hardcoded values
- [ ] Watch app bundle ID correct

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| WatchConnectivity unreliable for time-sensitive approvals | Medium | High | Use sendMessage (live) + transferUserInfo (background); accept ~2s latency |
| React Native watch bridge unmaintained/broken | Medium | High | Use pure Swift + custom native module instead of community package |
| Apple Developer account required for testing on real hardware | High | Medium | Simulator testing for development; real device for final validation |
| Watch complication refresh budget too low | Medium | Low | Use timeline entries; accept slight staleness |
| Xcode project conflict with Expo managed workflow | Medium | High | Must be using bare workflow or custom dev client |

## Notes
- This is the largest feature in the roadmap. Consider splitting into sub-PRs: (a) WatchConnectivity bridge + native module, (b) Watch UI + complication, (c) Integration with phone app.
- Apple Developer account ($99/year) is required for watchOS development on real hardware.
- AgentApprove is the only competitor with watchOS support — this is clauded's key differentiator.
- iOS App Store submission is a separate follow-up task after this PR and the Expo upgrade.

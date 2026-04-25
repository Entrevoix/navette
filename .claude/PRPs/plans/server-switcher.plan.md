# Plan: Server Switcher — Quick-Switch Saved Servers from MainScreen

## Summary
Add a server picker to the MainScreen header so users can see which server they're connected to and switch between saved servers without navigating back to ConnectScreen. Saved configs already exist in storage — this surfaces them where they matter.

## User Story
As a user with multiple workstations (e.g. home WiFi + Tailscale),
I want to switch between saved servers from the main screen,
so that I don't have to disconnect, navigate to ConnectScreen, select a config, and reconnect manually.

## Problem → Solution
Currently: switch servers = disconnect → ConnectScreen → select config → reconnect. No server identity shown in MainScreen header.
After: tap server name in header → see saved servers → tap to switch. Current server always visible.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 5-6
- **Estimated Lines**: ~200

---

## UX Design

### Before
```
┌──────────────────────────────────┐
│ ● connected  seq:42     ⚙ ✕    │  ← no server identity
│──────────────────────────────────│
│  [session content]               │
│                                  │
└──────────────────────────────────┘
```

### After
```
┌──────────────────────────────────┐
│ ● Home WiFi ▾  seq:42   ⚙ ✕    │  ← tap name opens picker
│──────────────────────────────────│
│  [session content]               │
│                                  │
└──────────────────────────────────┘

Server Picker Modal (on tap):
┌──────────────────────────────────┐
│  Switch Server                   │
│──────────────────────────────────│
│  ● Home WiFi         192.168.x  │  ← current (green dot)
│    Tailscale          100.x.x.x │
│    Office             10.0.x.x  │
│──────────────────────────────────│
│  [Edit Servers]     [Cancel]     │
└──────────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| MainScreen header | Shows "connected" status only | Shows server name + status | Name is tappable |
| Server switching | Disconnect → ConnectScreen → select → connect | Tap name → pick server → auto-switch | Seamless transition |
| ConnectScreen | Only place to manage servers | Still primary for add/edit/QR | "Edit Servers" link from picker |
| App.tsx | Passes single config | Passes config + name + all saved configs | New props |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `mobile/src/screens/ConnectScreen.tsx` | 28-40, 71-121, 149-179 | SavedConfig shape, storage keys, load/save patterns |
| P0 | `mobile/App.tsx` | 22-49, 84-89, 99-174 | Connection flow, auto-connect, screen routing |
| P0 | `mobile/src/hooks/useNavettedWS.ts` | 384-398, 787-794 | connect/disconnect functions |
| P0 | `mobile/src/screens/MainScreen.tsx` | 351-391 | Current header layout |
| P1 | `mobile/src/types/index.ts` | 102, 106-113 | ServerConfig, ConnectionStatus |

## External Documentation
No external research needed — feature uses established internal patterns (AsyncStorage, SecureStore, Modal).

---

## Patterns to Mirror

### NAMING_CONVENTION
```typescript
// SOURCE: ConnectScreen.tsx:33-36
const CONFIGS_KEY = 'navette_saved_configs';
const LEGACY_KEY = 'navette_config';
const TS_API_KEY_STORAGE = 'tailscale_api_key';
const TOKEN_KEY_PREFIX = 'navette_token_';
```

### SAVED_CONFIG_SHAPE
```typescript
// SOURCE: ConnectScreen.tsx:28-31
interface SavedConfig extends ServerConfig {
  id: string;
  name: string;
}
```

### STORAGE_PATTERN
```typescript
// SOURCE: ConnectScreen.tsx:80-93
// Load: AsyncStorage for metadata, SecureStore for tokens
const hydrated = await Promise.all(configs.map(async (cfg) => {
  const stored = await SecureStore.getItemAsync(tokenKey(cfg.id));
  if (stored) return { ...cfg, token: stored };
  return cfg;
}));
// Save: strip tokens before persisting to AsyncStorage
const stripped = updated.map(c => ({ ...c, token: '' }));
await AsyncStorage.setItem(CONFIGS_KEY, JSON.stringify(stripped));
```

### MODAL_PATTERN
```typescript
// SOURCE: ConnectScreen.tsx:438-454
<Modal visible={qrVisible} animationType="slide" onRequestClose={() => setQrVisible(false)}>
  <View style={styles.qrModal}>
    {/* content */}
    <Pressable onPress={() => setQrVisible(false)}>
      <Text>Cancel</Text>
    </Pressable>
  </View>
</Modal>
```

### HEADER_LAYOUT
```typescript
// SOURCE: MainScreen.tsx:351-391
<View style={styles.topBar}>
  <View style={styles.statusRow}>
    <View style={[styles.dot, { backgroundColor: dotColor }]} />
    <Text style={styles.statusText}>{statusLabel}</Text>
    {/* badges */}
  </View>
  <View style={styles.topBarActions}>
    {/* action buttons */}
  </View>
</View>
```

### CONNECT_CALLBACK
```typescript
// SOURCE: App.tsx:84-89
const handleConnect = async (cfg: ServerConfig) => {
  setConfig(cfg);
  configRef.current = cfg;
  await SecureStore.setItemAsync(LAST_CONFIG_KEY, JSON.stringify(cfg));
  connect(cfg);
};
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `mobile/src/components/ServerPicker.tsx` | CREATE | Modal component for quick-switching servers |
| `mobile/src/screens/MainScreen.tsx` | UPDATE | Add server name to header, wire up ServerPicker |
| `mobile/App.tsx` | UPDATE | Pass saved configs + current config name to MainScreen, handle server switch |
| `mobile/src/screens/ConnectScreen.tsx` | UPDATE | Export storage helpers so App.tsx can load saved configs |

## NOT Building

- Concurrent connections to multiple servers (one WebSocket at a time)
- Per-server event history preservation (events still clear on disconnect)
- Server health monitoring / ping indicators
- Drag-to-reorder saved configs
- Server groups or folders

---

## Step-by-Step Tasks

### Task 1: Extract config loading helpers from ConnectScreen

- **ACTION**: Move the saved config load/hydrate logic into a shared utility so App.tsx can load saved configs independently of ConnectScreen.
- **IMPLEMENT**: Create `loadSavedConfigs()` and export the storage key constants from ConnectScreen (or a new `src/utils/serverConfigs.ts`). The function loads from AsyncStorage, hydrates tokens from SecureStore, returns `SavedConfig[]`.
- **MIRROR**: STORAGE_PATTERN — AsyncStorage for metadata, SecureStore for tokens
- **IMPORTS**: `AsyncStorage`, `SecureStore`
- **GOTCHA**: Token hydration is async per-config (Promise.all). Keep the strip-on-save pattern — never persist tokens to AsyncStorage.
- **VALIDATE**: Import from App.tsx and ConnectScreen without circular deps. `loadSavedConfigs()` returns the same data ConnectScreen currently loads.

### Task 2: Load saved configs in App.tsx

- **ACTION**: Call `loadSavedConfigs()` on mount in App.tsx. Store in state. Pass to MainScreen as a prop.
- **IMPLEMENT**: Add `const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([])` to App. Load on mount via useEffect. Also derive `currentConfigName` from the config that matches the active connection (match by host+port+token).
- **MIRROR**: CONNECT_CALLBACK — same pattern as existing auto-connect useEffect
- **IMPORTS**: `loadSavedConfigs` from the new utility, `SavedConfig` type
- **GOTCHA**: savedConfigs must refresh when returning from ConnectScreen after edits. Use a callback or reload on `status` change to `connected`.
- **VALIDATE**: Console-log savedConfigs on mount — confirms loading works.

### Task 3: Create ServerPicker component

- **ACTION**: Build a modal that lists saved servers, highlights the current one, and lets the user tap to switch.
- **IMPLEMENT**:
  ```
  Props:
    visible: boolean
    configs: SavedConfig[]
    currentHost: string
    currentPort: string
    onSelect: (config: SavedConfig) => void
    onEditServers: () => void
    onClose: () => void
  ```
  Renders a Modal with:
  - Title "Switch Server"
  - List of saved configs (name + host:port), current one marked with green dot
  - "Edit Servers" button at bottom (calls onEditServers → disconnects to ConnectScreen)
  - Cancel button
- **MIRROR**: MODAL_PATTERN (from ConnectScreen's Tailscale peer picker) and SAVED_CONFIG_SHAPE
- **IMPORTS**: `Modal, Pressable, Text, View, StyleSheet` from react-native
- **GOTCHA**: Must match the dark theme (`#0a0a0a`, `#141414`, `#2a2a2a` borders, `#f0f0f0` text). Use same styling patterns as ConnectScreen modals.
- **VALIDATE**: Renders with mock data. Tap fires onSelect. Current server shows green indicator.

### Task 4: Wire ServerPicker into MainScreen header

- **ACTION**: Replace plain status text with tappable server name. Show ServerPicker on tap.
- **IMPLEMENT**:
  - Add props: `serverName: string`, `savedConfigs: SavedConfig[]`, `currentHost: string`, `currentPort: string`, `onSwitchServer: (config: SavedConfig) => void`, `onEditServers: () => void`
  - Add `const [pickerVisible, setPickerVisible] = useState(false)` state
  - In the `statusRow`, replace the status text with: `<Pressable onPress={() => setPickerVisible(true)}><Text>{serverName} ▾</Text></Pressable>` followed by status dot
  - Render `<ServerPicker />` modal
- **MIRROR**: HEADER_LAYOUT — keep the existing topBar structure, just change what's in statusRow
- **IMPORTS**: `ServerPicker` from components, `SavedConfig` type
- **GOTCHA**: Don't break existing status display (dot color, reconnecting badge, session timer). Server name goes first, then status indicators. Keep the status dot — it's the primary "is it working" signal.
- **VALIDATE**: Header shows server name. Tapping opens picker. Selecting a server fires callback.

### Task 5: Handle server switching in App.tsx

- **ACTION**: When user picks a server from ServerPicker, disconnect current WS and connect to the new one.
- **IMPLEMENT**:
  - Add `handleSwitchServer(config: SavedConfig)` in App.tsx
  - Calls `disconnect()` from useNavettedWS
  - Short delay (100ms) to let WS close
  - Calls `handleConnect(config)` with the new config
  - Updates `currentConfigName`
  - Add `handleEditServers()` that calls `disconnect()` to return to ConnectScreen
- **MIRROR**: CONNECT_CALLBACK — reuse existing handleConnect
- **IMPORTS**: None new — uses existing disconnect/connect from hook
- **GOTCHA**: The `disconnect()` → `connect()` transition needs a small delay so the old WS closes before the new one opens. Don't set `shouldReconnectRef` to true until the new connect fires (disconnect sets it to false). The `status` will briefly go to `disconnected` — the conditional rendering in App.tsx must NOT flash ConnectScreen during the switch. Add a `switching` ref or state to suppress the ConnectScreen render during transition.
- **VALIDATE**: Tap a different server in picker → WS reconnects to new server → header shows new name. No ConnectScreen flash during switch.

### Task 6: Suppress ConnectScreen flash during server switch

- **ACTION**: Prevent the brief `disconnected` status from showing ConnectScreen when switching servers.
- **IMPLEMENT**: Add `const switchingRef = useRef(false)` in App.tsx. Set to `true` before disconnect, `false` after connect. In the render condition, treat `switchingRef.current === true` as connected (show MainScreen with a loading state).
- **MIRROR**: Follows existing `configRef` pattern for ref-based state that doesn't trigger re-renders
- **IMPORTS**: `useRef`
- **GOTCHA**: Must reset `switchingRef` even if the new connection fails. Use a timeout fallback (e.g. 5s) to reset if status never reaches `connected`.
- **VALIDATE**: Switch servers rapidly — no ConnectScreen flash. If new server is unreachable, eventually falls back to ConnectScreen after timeout.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| loadSavedConfigs returns hydrated configs | AsyncStorage with 2 configs, SecureStore with tokens | Array of 2 SavedConfig with tokens populated | No |
| loadSavedConfigs handles empty storage | No stored configs | Empty array | Yes |
| loadSavedConfigs handles corrupt data | Invalid JSON in AsyncStorage | Empty array (graceful fallback) | Yes |
| ServerPicker highlights current server | configs + currentHost/Port matching one | That config row has green indicator | No |
| ServerPicker calls onSelect with correct config | Tap on non-current server | onSelect called with that SavedConfig | No |
| Server switch suppresses ConnectScreen flash | Rapid disconnect+connect | MainScreen stays visible throughout | Yes |

### Edge Cases Checklist
- [ ] No saved configs (picker should show "No saved servers" + Edit Servers button)
- [ ] Only one saved config (picker still works, just shows one entry)
- [ ] Current server not in saved list (e.g. connected via manual entry without saving)
- [ ] Switch to unreachable server (should timeout and show error, not hang)
- [ ] Switch back to previous server after failed switch
- [ ] App backgrounded during switch (should complete or fail gracefully)

---

## Validation Commands

### Static Analysis
```bash
cd mobile && npx tsc --noEmit
```
EXPECT: Zero type errors

### Unit Tests
```bash
cd mobile && npx jest --passWithNoTests
```
EXPECT: All tests pass

### Full Test Suite
```bash
cd mobile && npx jest && npx tsc --noEmit
```
EXPECT: No regressions

### Browser Validation
```bash
cd mobile && npx expo start
```
EXPECT: Feature works on device — can switch servers, no flash, header shows name

### Manual Validation
- [ ] Connect to server A via QR or manual entry
- [ ] Verify header shows server A name
- [ ] Tap server name → picker opens
- [ ] Picker shows all saved servers with A highlighted
- [ ] Tap server B → picker closes, brief reconnect, header shows B
- [ ] No ConnectScreen flash during switch
- [ ] Tap server name again → picker shows B highlighted
- [ ] Tap "Edit Servers" → returns to ConnectScreen
- [ ] With only 1 saved server, picker shows it with green dot
- [ ] With 0 saved servers, picker shows empty state

---

## Acceptance Criteria
- [ ] MainScreen header shows current server name (tappable)
- [ ] Server picker modal lists all saved servers
- [ ] Current server highlighted in picker
- [ ] Tapping a different server switches connection
- [ ] No ConnectScreen flash during switch
- [ ] "Edit Servers" returns to ConnectScreen
- [ ] Works with 0, 1, and many saved configs
- [ ] All validation commands pass

## Completion Checklist
- [ ] Code follows discovered patterns (dark theme, modal pattern, storage pattern)
- [ ] Error handling matches codebase style (try/catch, graceful fallback)
- [ ] No hardcoded values (colors from existing styles)
- [ ] Types exported and used consistently
- [ ] No unnecessary scope additions

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ConnectScreen flash during switch | High | Medium | switchingRef + timeout fallback |
| Stale saved configs after ConnectScreen edits | Medium | Low | Reload configs on status change to connected |
| Race condition: old WS events arrive after new connect | Low | Medium | connectWS already closes old WS first |

## Notes
- The existing saved configs system in ConnectScreen is solid. This plan surfaces it, not rebuilds it.
- Per-server event history is explicitly out of scope. Events clear on disconnect as they do today.
- The `container` field on ServerConfig is orthogonal to server identity — same server can have different containers. The picker matches by host+port.

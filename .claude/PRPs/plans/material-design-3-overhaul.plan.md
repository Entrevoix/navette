# Plan: Material Design 3 UI Overhaul

## Summary
Migrate the Navette React Native (Expo) mobile app from hard-coded dark-only StyleSheet styles to a full Material Design 3 design system using `react-native-paper` v5. This includes a centralized theme with dynamic color, light/dark/system mode support, keyboard-avoidance fixes, responsive layout corrections, and systematic replacement of all ad-hoc components with M3 equivalents.

## User Story
As a mobile user of Navette, I want a polished, accessible interface that adapts to my system theme and fits my phone screen properly, so that managing Claude Code sessions feels native and professional.

## Problem → Solution
Hard-coded `#0a0a0a` dark-only styles, no theme system, inline colors/sizes scattered across 34 files, no keyboard avoidance on the chat screen, emoji used as icons → Centralized M3 theme via `react-native-paper`, `surfaceContainerHighest` code blocks, `primaryContainer`/`surfaceContainerHigh` message bubbles, `KeyboardAvoidingView` on ChatView, Material Symbols via `@expo/vector-icons/MaterialCommunityIcons`, system/light/dark mode with persistence.

## Metadata
- **Complexity**: XL
- **Source PRD**: N/A (inline specification)
- **PRD Phase**: N/A
- **Estimated Files**: ~40 (14 screens + 20 components + theme layer + App.tsx + app.json + package.json)

---

## UX Design

### Before
```
┌──────────────────────────────┐
│ ● connected  seq 42  ⚙ 📁   │  ← emoji icons, #0a0a0a bg
│──────────────────────────────│
│ [ session pill ]             │  ← hard-coded #0d0d0d pills
│──────────────────────────────│
│                              │
│  [User bubble #0f172a]       │  ← low contrast blue-on-navy
│  Assistant text #d4d4d8      │  ← no bubble, just raw text
│  ┌─code block #0d0d0d─────┐ │
│  │ monospace               │ │
│  └─────────────────────────┘ │
│                              │
│──────────────────────────────│
│ [+] [Type a message…] [Send]│  ← no KeyboardAvoidingView
└──────────────────────────────┘
   keyboard covers input ↑
```

### After
```
┌──────────────────────────────┐
│  M3 TopAppBar                │  ← onSurface text, proper icons
│  claude · host   ◐ tokens   │  ← M3 chip, ContextMeter
│──────────────────────────────│
│ [ session chip ]             │  ← M3 Chip component
│──────────────────────────────│
│                              │
│  ┌─primaryContainer────────┐ │  ← user bubble
│  │ User message            │ │
│  └─────────────────────────┘ │
│  ┌─surfaceContainerHigh───┐  │  ← assistant bubble
│  │ Assistant message       │ │
│  │ ┌─surfaceContainerH.──┐│  │  ← code block
│  │ │ monospace            ││  │
│  │ └─────────────────────┘│  │
│  └─────────────────────────┘ │
│──────────────────────────────│
│ [+] [M3 OutlinedTextField] ▶│  ← KeyboardAvoidingView
└──────────────────────────────┘
   input stays above keyboard ↑
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Theme | Dark only, hard-coded | System/Light/Dark, persisted | AsyncStorage key `navette_theme_mode` |
| Keyboard | Input hidden on chat | Input stays visible | `KeyboardAvoidingView` wrapping ChatView |
| Icons | Emoji `⚙`, `📁`, `⌫`, `⎘` | MaterialCommunityIcons | Consistent rounded weight |
| Buttons | Identical Pressable+Text | M3 Button variants by emphasis | Filled, FilledTonal, Outlined, Text |
| Text fields | Raw TextInput + border | M3 outlined TextInput via Paper | Labels, helper text |
| App bar | Custom View + Text | M3 Appbar.Header | Status, actions |
| Navigation | Emoji-labeled settings modal | Bottom sheet or M3 navigation | Evaluate in implementation |
| Code blocks | #0d0d0d bg, #1e1e1e border | surfaceContainerHighest | Theme-aware |
| Snackbar feedback | None | M3 Snackbar for copy/send/error | Transient feedback |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `mobile/App.tsx` | all (187) | App root — theme provider wraps here |
| P0 | `mobile/src/components/ChatView.tsx` | all (465) | Highest-traffic screen, keyboard fix here |
| P0 | `mobile/src/screens/MainScreen.tsx` | all (896) | Top bar, session pills, run panel — bulk of migration |
| P0 | `mobile/src/components/MessageBubble.tsx` | all (111) | Message styling, code block rendering |
| P0 | `mobile/src/components/CodeBlock.tsx` | all (120) | Code styling needs theme tokens |
| P1 | `mobile/src/screens/ConnectScreen.tsx` | all (592) | Login card, QR modal, Tailscale peer list |
| P1 | `mobile/src/screens/SettingsScreen.tsx` | all (770) | Many button variants, notification config |
| P1 | `mobile/src/screens/LockScreen.tsx` | all (252) | PIN pad, biometric flow |
| P1 | `mobile/src/components/ApprovalCard.tsx` | all (345) | Swipeable gesture card |
| P1 | `mobile/src/components/StatusBar.tsx` | all (91) | Agent/container/token display |
| P1 | `mobile/src/components/VoiceButton.tsx` | all (1279) | Largest component — voice recording UI |
| P2 | `mobile/src/screens/ScheduleScreen.tsx` | all (311) | Date picker, scheduled list |
| P2 | `mobile/src/screens/SkillsScreen.tsx` | all (285) | Skill list, search |
| P2 | `mobile/src/screens/SessionHistoryScreen.tsx` | all (273) | Past sessions list |
| P2 | `mobile/src/screens/PromptLibraryScreen.tsx` | all (273) | CRUD prompt list |
| P2 | `mobile/src/screens/SecretsScreen.tsx` | all (195) | Secret management list |
| P2 | `mobile/src/screens/DevicesScreen.tsx` | all (192) | Device management |
| P2 | `mobile/src/screens/McpServersScreen.tsx` | all (191) | MCP server list |
| P2 | `mobile/src/screens/ApprovalPolicyScreen.tsx` | all (189) | Policy list |
| P2 | `mobile/src/screens/FileBrowserScreen.tsx` | all (248) | File tree + viewer |
| P2 | `mobile/src/screens/ContainerPickerScreen.tsx` | all (153) | Container list modal |
| P2 | `mobile/src/components/EventFeed.tsx` | all (168) | Event stream |
| P2 | `mobile/src/components/EventLog.tsx` | all (352) | Tool call display |
| P2 | `mobile/src/components/SessionCard.tsx` | all (204) | Session info card |
| P2 | `mobile/src/components/KanbanBoard.tsx` | all (154) | Board view |
| P2 | `mobile/src/components/DiffView.tsx` | all (114) | Diff display |
| P2 | `mobile/src/components/FileViewer.tsx` | all (133) | File content |
| P2 | `mobile/src/components/FileChip.tsx` | - | File attachment |
| P2 | `mobile/src/components/DirPicker.tsx` | all (151) | Directory picker |
| P2 | `mobile/src/components/ConfigEditor.tsx` | all (144) | Config form |
| P2 | `mobile/src/components/QuickResponseButtons.tsx` | all (92) | Quick actions |
| P2 | `mobile/src/components/BatchApprovalBar.tsx` | all (91) | Batch approve bar |
| P2 | `mobile/src/components/ContextMeter.tsx` | - | Token meter |
| P2 | `mobile/src/components/ErrorBoundary.tsx` | - | Error fallback |
| P2 | `mobile/app.json` | all (51) | `userInterfaceStyle` must change to `automatic` |
| P2 | `mobile/package.json` | all (62) | Add react-native-paper + vector-icons |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| react-native-paper v5 | callstack.github.io/react-native-paper | M3 components, `MD3DarkTheme`/`MD3LightTheme`, `PaperProvider`, theming API |
| M3 color system | m3.material.io/styles/color/system | Dynamic color from seed, tonal palettes, surface container hierarchy |
| M3 typography | m3.material.io/styles/typography | `displayLarge`…`labelSmall` scale |
| KeyboardAvoidingView | reactnative.dev/docs/keyboardavoidingview | `behavior="padding"` iOS, `behavior="height"` Android |
| @expo/vector-icons | docs.expo.dev/guides/icons | MaterialCommunityIcons bundled with Expo |
| expo-system-ui | docs.expo.dev/versions/latest/sdk/system-ui | Set root bg color for system theme |

---

## Patterns to Mirror

Code patterns discovered in the codebase. Follow these exactly.

### NAMING_CONVENTION
```typescript
// SOURCE: mobile/src/components/ChatView.tsx:1-3
// Component files: PascalCase filename matching export
// Screens: PascalCase + Screen suffix (MainScreen, ConnectScreen)
// Hooks: use-prefix camelCase (useNavettedWS, useNotifications)
// Style objects: `const styles = StyleSheet.create({...})` at file bottom
// Props: PascalCase + Props suffix interface
```

### COMPONENT_STRUCTURE
```typescript
// SOURCE: mobile/src/components/StatusBar.tsx:1-49
// Pattern: interface Props → export function Component(props) → styles at bottom
interface StatusBarProps {
  agentName: string;
  // ...
}

export function StatusBar({ agentName, ...rest }: StatusBarProps) {
  return (<View style={styles.container}>...</View>);
}

const styles = StyleSheet.create({ ... });
```

### STATE_PERSISTENCE
```typescript
// SOURCE: mobile/src/screens/MainScreen.tsx:197-199
// Pattern: AsyncStorage for non-sensitive data, SecureStore for tokens/PINs
AsyncStorage.getItem('navette_view_mode').then((v: string | null) => {
  if (v === 'board' || v === 'list') setViewMode(v);
});
```

### HAPTIC_FEEDBACK
```typescript
// SOURCE: mobile/src/screens/MainScreen.tsx:278
// Pattern: Haptics on user-initiated actions (send, run, copy)
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
```

### ANIMATION_PATTERN
```typescript
// SOURCE: mobile/src/components/ApprovalCard.tsx:7-15
// Pattern: react-native-reanimated for gesture-driven animation
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
```

### ERROR_HANDLING
```typescript
// SOURCE: mobile/src/components/ChatView.tsx:202-206
// Pattern: try/catch with empty catch for optional UI operations
const handleCopyAll = async () => {
  try {
    const md = exportTranscriptMarkdown(visibleEvents, activeSessionId ?? 'unknown');
    await Clipboard.setStringAsync(md);
  } catch { /* clipboard unavailable */ }
};
```

### MONOSPACE_FONT
```typescript
// SOURCE: mobile/src/components/CodeBlock.tsx:114
// Pattern: Platform-specific monospace font
fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `mobile/package.json` | UPDATE | Add `react-native-paper`, `react-native-vector-icons` |
| `mobile/app.json` | UPDATE | Change `userInterfaceStyle` from `"dark"` to `"automatic"` |
| `mobile/src/theme.ts` | CREATE | M3 theme definition: colors, typography, shapes, custom tokens |
| `mobile/src/ThemeContext.tsx` | CREATE | Theme mode context (system/light/dark), persistence |
| `mobile/App.tsx` | UPDATE | Wrap with `PaperProvider` + `ThemeContext`, remove hard-coded bg |
| `mobile/src/components/StatusBar.tsx` | UPDATE | Use M3 Appbar or themed tokens |
| `mobile/src/components/ChatView.tsx` | UPDATE | Add `KeyboardAvoidingView`, theme tokens, smart auto-scroll |
| `mobile/src/components/MessageBubble.tsx` | UPDATE | M3 surface tones for bubbles |
| `mobile/src/components/CodeBlock.tsx` | UPDATE | `surfaceContainerHighest` bg, theme typography |
| `mobile/src/components/ApprovalCard.tsx` | UPDATE | M3 surface/elevation tokens, keep gesture logic |
| `mobile/src/components/BatchApprovalBar.tsx` | UPDATE | M3 button variants |
| `mobile/src/components/VoiceButton.tsx` | UPDATE | M3 FAB or IconButton, theme colors |
| `mobile/src/components/EventFeed.tsx` | UPDATE | Theme tokens |
| `mobile/src/components/EventLog.tsx` | UPDATE | Theme tokens, M3 list patterns |
| `mobile/src/components/SessionCard.tsx` | UPDATE | M3 Card component |
| `mobile/src/components/KanbanBoard.tsx` | UPDATE | M3 Card, theme tokens |
| `mobile/src/components/DiffView.tsx` | UPDATE | Theme tokens |
| `mobile/src/components/FileViewer.tsx` | UPDATE | Theme tokens, M3 surface |
| `mobile/src/components/FileChip.tsx` | UPDATE | M3 Chip component |
| `mobile/src/components/DirPicker.tsx` | UPDATE | M3 List.Item, theme tokens |
| `mobile/src/components/ConfigEditor.tsx` | UPDATE | M3 TextInput, theme tokens |
| `mobile/src/components/QuickResponseButtons.tsx` | UPDATE | M3 button variants |
| `mobile/src/components/ContextMeter.tsx` | UPDATE | Theme tokens |
| `mobile/src/components/ErrorBoundary.tsx` | UPDATE | M3 error surface |
| `mobile/src/screens/MainScreen.tsx` | UPDATE | M3 Appbar, Chip, FAB, theme tokens, remove STATUS_COLOR map |
| `mobile/src/screens/ConnectScreen.tsx` | UPDATE | M3 Card, TextInput, Button, Modal |
| `mobile/src/screens/LockScreen.tsx` | UPDATE | M3 surface, themed PIN pad |
| `mobile/src/screens/SettingsScreen.tsx` | UPDATE | M3 List.Section, List.Item, Button variants |
| `mobile/src/screens/FileBrowserScreen.tsx` | UPDATE | M3 List.Item, Divider |
| `mobile/src/screens/ContainerPickerScreen.tsx` | UPDATE | M3 Modal/BottomSheet, List.Item |
| `mobile/src/screens/ApprovalPolicyScreen.tsx` | UPDATE | M3 List.Item, SegmentedButtons |
| `mobile/src/screens/DevicesScreen.tsx` | UPDATE | M3 List.Item, IconButton |
| `mobile/src/screens/SecretsScreen.tsx` | UPDATE | M3 List.Item, TextInput, Button |
| `mobile/src/screens/SessionHistoryScreen.tsx` | UPDATE | M3 List.Item, Card |
| `mobile/src/screens/ScheduleScreen.tsx` | UPDATE | M3 TextInput, Button, List.Item |
| `mobile/src/screens/PromptLibraryScreen.tsx` | UPDATE | M3 List.Item, FAB, TextInput |
| `mobile/src/screens/SkillsScreen.tsx` | UPDATE | M3 Searchbar, List.Item, Chip |
| `mobile/src/screens/McpServersScreen.tsx` | UPDATE | M3 List.Item, Divider |

## NOT Building

- New features (e.g., new screens, new WS commands)
- Changes to session/transport/CLI integration code
- Changes to `useNavettedWS.ts` hook logic
- Changes to `utils/diff.ts` or `utils/transcript.ts` logic
- Custom animation library or complex motion system
- Tablet-specific multi-pane layout (only max-width cap)
- Backend (Rust daemon) changes

---

## Step-by-Step Tasks

### Task 1: Install dependencies
- **ACTION**: Add `react-native-paper` v5 and ensure `@expo/vector-icons` is available (bundled with Expo)
- **IMPLEMENT**: `cd mobile && npm install react-native-paper` — no other heavy deps
- **MIRROR**: Existing `package.json` dep structure
- **IMPORTS**: N/A
- **GOTCHA**: `react-native-paper` v5 requires `react-native-safe-area-context` (already installed) and `react-native-vector-icons` (Expo provides `@expo/vector-icons` which is compatible — no extra install needed)
- **VALIDATE**: `cd mobile && npx expo doctor` passes; app still builds

### Task 2: Create theme definition (`src/theme.ts`)
- **ACTION**: Create centralized M3 theme with light and dark variants
- **IMPLEMENT**:
  - Define seed color: `#5B6ABF` (deep indigo — fits the existing blue accent palette while being distinctive)
  - Alternative seeds considered: `#2E7D6F` (teal), `#8B5CF6` (violet)
  - Use `MD3DarkTheme` and `MD3LightTheme` from `react-native-paper` as bases
  - Override `colors` with a tonal palette generated from the seed (use Paper's `adaptNavigationTheme` or manual overrides)
  - Define custom properties: `fonts.mono` for `Platform.OS === 'android' ? 'monospace' : 'Menlo'`
  - Export `lightTheme`, `darkTheme`, and a `getTheme(mode)` function
  - Define `statusColors` map: `{ connected: theme.colors.primary, error: theme.colors.error, connecting: '#FBBF24', ... }` using theme tokens where possible
- **MIRROR**: NAMING_CONVENTION — PascalCase types, camelCase exports
- **IMPORTS**: `import { MD3DarkTheme, MD3LightTheme, configureFonts } from 'react-native-paper'`
- **GOTCHA**: Paper v5 uses `MD3` prefix themes, not `DarkTheme`/`DefaultTheme` from v4. Typography scale is `displayLarge`…`labelSmall`. Monospace font is NOT part of the default Paper type scale — must add as custom font variant.
- **VALIDATE**: File exports `lightTheme`, `darkTheme` with valid Paper theme shapes; TypeScript compiles

### Task 3: Create theme context (`src/ThemeContext.tsx`)
- **ACTION**: Create React context for theme mode management with persistence
- **IMPLEMENT**:
  - `ThemeMode = 'system' | 'light' | 'dark'`
  - Context provides `{ mode, setMode, theme, isDark }`
  - `useColorScheme()` from RN for system preference detection
  - Persist mode to `AsyncStorage` key `navette_theme_mode`
  - Load saved mode on mount, default to `'system'`
  - Export `ThemeProvider` component and `useThemeMode` hook
- **MIRROR**: STATE_PERSISTENCE — same AsyncStorage pattern as `navette_view_mode`
- **IMPORTS**: `import AsyncStorage from '@react-native-async-storage/async-storage'`, `import { useColorScheme } from 'react-native'`
- **GOTCHA**: `useColorScheme()` returns `'light' | 'dark' | null`. When `null`, default to `'dark'` to match current behavior.
- **VALIDATE**: Hook returns correct theme object for each mode; persists across restarts

### Task 4: Wire theme into App.tsx
- **ACTION**: Wrap app with `PaperProvider` and `ThemeProvider`, update `app.json`
- **IMPLEMENT**:
  - Wrap `SafeAreaProvider` children with `<ThemeProvider><PaperProvider theme={theme}>…</PaperProvider></ThemeProvider>`
  - Remove hard-coded `backgroundColor: '#0a0a0a'` from root style — use `theme.colors.background`
  - In `app.json`: change `"userInterfaceStyle": "dark"` to `"userInterfaceStyle": "automatic"`
  - Keep `GestureHandlerRootView` outermost (required by gesture handler)
  - Set status bar style based on theme: `<StatusBar style={isDark ? 'light' : 'dark'} />`
- **MIRROR**: COMPONENT_STRUCTURE — minimal changes to App.tsx logic
- **IMPORTS**: `import { PaperProvider } from 'react-native-paper'`, `import { ThemeProvider, useThemeMode } from './src/ThemeContext'`
- **GOTCHA**: `PaperProvider` must be inside `SafeAreaProvider` for inset-aware components. The `useThemeMode` hook must be called inside `ThemeProvider`, so split into inner component or use the provider's render prop.
- **VALIDATE**: App renders with dark theme (matching current look); toggling mode in context switches themes

### Task 5: Migrate MainScreen top bar to M3 Appbar
- **ACTION**: Replace custom top bar View with Paper `Appbar.Header` + `Appbar.Content` + `Appbar.Action`
- **IMPLEMENT**:
  - `<Appbar.Header>` with status indicator, agent/container chip, and action icons
  - Replace emoji `⚙` with `<Appbar.Action icon="cog" />` (MaterialCommunityIcons)
  - Replace emoji `📁` with `<Appbar.Action icon="folder-outline" />`
  - Replace "Kill" Pressable with `<Appbar.Action icon="stop-circle-outline" />` or `<Button mode="text" textColor={theme.colors.error}>Kill</Button>`
  - Replace "Disconnect" with `<Appbar.Action icon="logout" />`
  - Status dot: small `<View>` with `theme.colors.primary` (connected), `theme.colors.error` (error), etc.
  - Reconnecting/Reconnected badges: use `<Chip>` or `<Badge>` from Paper
  - Running badge with elapsed time: `<Chip icon="play-circle">running · 2m 30s</Chip>`
- **MIRROR**: COMPONENT_STRUCTURE
- **IMPORTS**: `import { Appbar, Button, Chip, useTheme } from 'react-native-paper'`
- **GOTCHA**: `Appbar.Header` has built-in elevation and theme coloring. Remove manual `borderBottomWidth`/`borderBottomColor` from old styles. The `Appbar.Action` icon names come from MaterialCommunityIcons.
- **VALIDATE**: Top bar renders with proper M3 styling, actions work, status colors match theme

### Task 6: Migrate session pills to M3 Chips
- **ACTION**: Replace custom pill Pressables with Paper `Chip` components
- **IMPLEMENT**:
  - Replace `styles.pill` / `styles.pillActive` with `<Chip mode="outlined" selected={isActive} onPress={...}>`
  - Use `theme.colors.secondaryContainer` for active state
  - Keep `ScrollView horizontal` wrapper for chip list
  - SessionCard in dashboard: wrap with Paper `Card` component
  - Board/list toggle: use Paper `SegmentedButtons`
- **MIRROR**: COMPONENT_STRUCTURE
- **IMPORTS**: `import { Chip, Card, SegmentedButtons } from 'react-native-paper'`
- **GOTCHA**: Paper `Chip` has built-in ripple and elevation; remove manual border/bg overrides
- **VALIDATE**: Pills render, selection works, haptic still fires

### Task 7: Migrate ChatView — keyboard avoidance + theme
- **ACTION**: Wrap ChatView content in `KeyboardAvoidingView`, apply theme tokens
- **IMPLEMENT**:
  - Wrap the outer `<View style={styles.chatWrapper}>` content in `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex:1}} keyboardVerticalOffset={headerHeight}>`
  - Smart auto-scroll: track `isAtBottom` state via `onScroll` — only auto-scroll when user is already at bottom
  - Replace hard-coded colors with theme tokens: `backgroundColor: theme.colors.background`, borders with `theme.colors.outlineVariant`
  - Input bar: replace raw `TextInput` with Paper `TextInput` mode="outlined"
  - Send button: `<IconButton icon="send" mode="contained" />`
  - Attach button: `<IconButton icon="plus" mode="outlined" />`
  - Copy All / Share / Compact buttons: `<Button mode="text">` or `<Button mode="outlined">`
  - Divider lines: `<Divider />` from Paper
  - Session status labels (done/failed): use `theme.colors.primary` / `theme.colors.error`
- **MIRROR**: HAPTIC_FEEDBACK, ERROR_HANDLING
- **IMPORTS**: `import { KeyboardAvoidingView, Platform } from 'react-native'`, `import { TextInput, IconButton, Button, Divider, useTheme } from 'react-native-paper'`
- **GOTCHA**: Paper `TextInput` has different padding than raw RN `TextInput` — test that `multiline` + `maxHeight: 120` still works. `keyboardVerticalOffset` must account for the Appbar height. The `onContentSizeChange` callback on ScrollView helps maintain scroll position.
- **VALIDATE**: Open keyboard on iOS/Android simulator — input stays visible. Send message — scroll to bottom. Scroll up — new messages don't yank back down.

### Task 8: Migrate MessageBubble to M3 surface tones
- **ACTION**: Replace hard-coded bubble colors with M3 surface tones
- **IMPLEMENT**:
  - User bubble: `backgroundColor: theme.colors.primaryContainer`, text `theme.colors.onPrimaryContainer`
  - Assistant bubble: `backgroundColor: theme.colors.surfaceContainerHigh` (Paper v5 exposes this as `theme.colors.elevation.level2` or custom token), text `theme.colors.onSurface`
  - Copy button: `<IconButton icon="content-copy" size={16} />` replacing `⎘` character
  - Use `theme.roundness` for border radius consistency
  - Role labels: `theme.fonts.labelSmall`
- **MIRROR**: COMPONENT_STRUCTURE, NAMING_CONVENTION
- **IMPORTS**: `import { IconButton, useTheme } from 'react-native-paper'`
- **GOTCHA**: Paper v5 M3 doesn't expose `surfaceContainerHigh` directly as a named color — use `theme.colors.elevation.level2` which maps to the right tone. Test both light and dark themes for contrast.
- **VALIDATE**: Bubbles render in both themes; WCAG AA contrast verified (4.5:1 body text)

### Task 9: Migrate CodeBlock to theme tokens
- **ACTION**: Replace hard-coded code block colors with theme-aware tokens
- **IMPLEMENT**:
  - Container: `backgroundColor: theme.colors.surfaceVariant` (or `elevation.level3` for darker)
  - Border: `theme.colors.outlineVariant`
  - Header: `theme.colors.surfaceContainerHighest` equivalent
  - Code text: `theme.colors.onSurfaceVariant`
  - Copy button: Paper `<Button mode="text" compact>Copy</Button>`
  - Language label: `theme.fonts.labelSmall`
  - Syntax highlight colors: keep existing palette but adjust for light theme (detect `isDark` from theme and swap color set)
  - Monospace font: use `theme.fonts.mono` custom token defined in Task 2
- **MIRROR**: MONOSPACE_FONT
- **IMPORTS**: `import { Button, useTheme } from 'react-native-paper'`
- **GOTCHA**: Syntax highlight colors that work on dark bg (#93c5fd, #a3e635) will need light-theme variants. Create a `codeColors` object keyed by `isDark`.
- **VALIDATE**: Code blocks readable in both themes; copy works; monospace font renders

### Task 10: Migrate ConnectScreen to M3
- **ACTION**: Replace connect card with M3 Card, TextInput, Button
- **IMPLEMENT**:
  - Outer card: `<Card mode="elevated">` with `<Card.Content>`
  - Title: `theme.fonts.headlineMedium`
  - Subtitle: `theme.fonts.bodyMedium` + `theme.colors.onSurfaceVariant`
  - All TextInput fields: `<TextInput mode="outlined" label="Host" />`
  - Labels: remove manual `<Text style={styles.label}>` — Paper TextInput has built-in labels
  - Connect button: `<Button mode="contained">Connect</Button>`
  - Save button: `<Button mode="outlined">Save</Button>`
  - QR scan button: `<Button mode="contained-tonal" icon="qrcode-scan">Scan QR</Button>`
  - Error banner: `<Banner visible={!!error} icon="alert-circle">` from Paper
  - Saved configs list: Paper `<List.Item>` with `<List.Icon>`
  - Tailscale modal: Paper `<Modal>` + `<Portal>` or keep RN Modal with themed content
  - Delete button: `<IconButton icon="delete" />`
  - Keep `KeyboardAvoidingView` that already exists here
- **MIRROR**: STATE_PERSISTENCE, ERROR_HANDLING
- **IMPORTS**: `import { Card, TextInput, Button, Banner, List, IconButton, Modal, Portal, useTheme } from 'react-native-paper'`
- **GOTCHA**: Paper `TextInput` with `mode="outlined"` has different layout than raw TextInput — `secureTextEntry` still works. Paper `Modal` requires `<Portal>` wrapper.
- **VALIDATE**: All fields work, connect flow unchanged, QR scan works, saved configs render

### Task 11: Migrate LockScreen to M3
- **ACTION**: Theme the PIN pad and biometric prompt screen
- **IMPLEMENT**:
  - Background: `theme.colors.background`
  - PIN dots: `theme.colors.primary` (filled) / `theme.colors.outlineVariant` (empty)
  - Keypad buttons: `<Button mode="text">` or themed Pressable with `theme.colors.surfaceVariant` bg
  - Backspace key: `<IconButton icon="backspace-outline" />` replacing `⌫`
  - Error text: `theme.colors.error`
  - Title/subtitle: `theme.fonts.headlineSmall`, `theme.fonts.bodyMedium`
  - "Skip PIN" option: `<Button mode="text">`
- **MIRROR**: COMPONENT_STRUCTURE
- **IMPORTS**: `import { Button, IconButton, useTheme } from 'react-native-paper'`
- **GOTCHA**: PIN pad needs consistent button sizing (48pt min touch targets). Keep numeric keypad layout grid.
- **VALIDATE**: PIN entry works, biometric fallback works, theme colors applied

### Task 12: Migrate SettingsScreen to M3
- **ACTION**: Replace the button-heavy settings layout with M3 List sections
- **IMPLEMENT**:
  - Section headers: `<List.Section title="Notifications">` / `<List.Subheader>`
  - Navigation items: `<List.Item title="Session History" left={props => <List.Icon {...props} icon="history" />} onPress={...} />`
  - Replace individual styled buttons (historyBtn, skillsBtn, promptLibBtn, secretsBtn, scheduleBtn) with `<List.Item>` entries — much cleaner
  - Notification config: Paper `TextInput` for ntfy topic, `Switch` for toggles
  - Voice engine picker: `<SegmentedButtons>` from Paper
  - Disconnect button: `<Button mode="outlined" textColor={theme.colors.error}>`
  - Theme mode picker: NEW — add `<SegmentedButtons buttons={[{value:'system'},{value:'light'},{value:'dark'}]} />`
  - Test notification button: `<Button mode="contained-tonal">`
  - Tailscale API key: Paper `TextInput` with `secureTextEntry`
- **MIRROR**: COMPONENT_STRUCTURE, STATE_PERSISTENCE
- **IMPORTS**: `import { List, TextInput, Button, Switch, SegmentedButtons, Divider, useTheme } from 'react-native-paper'`
- **GOTCHA**: SettingsScreen is rendered as a modal overlay (`visible` prop), not navigated to. Keep this pattern but theme it. The voice engine picker has 3 options that must map to SegmentedButtons values.
- **VALIDATE**: All settings accessible, toggles work, theme picker persists mode

### Task 13: Migrate remaining screens (batch)
- **ACTION**: Apply M3 tokens to the 9 remaining secondary screens
- **IMPLEMENT**:
  - **FileBrowserScreen**: `<List.Item>` for files/dirs, `<IconButton>` for actions, `<Divider>` separators
  - **ContainerPickerScreen**: `<List.Item>` for containers, `<RadioButton>` for selection
  - **ApprovalPolicyScreen**: `<List.Item>` with `<SegmentedButtons>` for allow/deny/ask per tool
  - **DevicesScreen**: `<List.Item>` with device info, `<IconButton icon="delete">` for revoke, rename via `<Dialog>` with `<TextInput>`
  - **SecretsScreen**: `<List.Item>` for secrets, `<FAB>` or `<Button>` for add, `<Dialog>` for new secret form
  - **SessionHistoryScreen**: `<List.Item>` or `<Card>` for past sessions with timestamps
  - **ScheduleScreen**: `<List.Item>` for scheduled sessions, `<Button>` for cancel, `<TextInput>` + date input for new schedule
  - **PromptLibraryScreen**: `<List.Item>` for prompts, `<FAB icon="plus">` for new, `<Dialog>` for edit
  - **SkillsScreen**: `<Searchbar>` at top, `<List.Item>` for skills, `<Chip>` for categories
  - **McpServersScreen**: `<List.Item>` with server status indicators
  - All screens: replace `backgroundColor: '#0a0a0a'` with `theme.colors.background`, text colors with `theme.colors.onSurface` / `onSurfaceVariant`
- **MIRROR**: COMPONENT_STRUCTURE — all follow same pattern
- **IMPORTS**: Screen-specific Paper components as needed
- **GOTCHA**: These screens are relatively simple list-based UIs. The migration is mostly mechanical: replace Pressable+Text with List.Item, replace raw TextInput with Paper TextInput, replace inline colors with theme tokens.
- **VALIDATE**: Each screen renders, all interactions work, no visual regressions

### Task 14: Migrate remaining components (batch)
- **ACTION**: Apply M3 tokens to the remaining shared components
- **IMPLEMENT**:
  - **StatusBar**: Replace with M3 tokens or merge into Appbar from Task 5. `ContextMeter` stays custom but uses theme colors.
  - **ApprovalCard**: Keep reanimated gesture logic. Update colors: green swipe = `theme.colors.primary`, red swipe = `theme.colors.error`. Tool info text: `theme.colors.onSurface`. Card surface: `theme.colors.surfaceContainerHigh`. DiffView inside: theme tokens.
  - **BatchApprovalBar**: `<Button mode="contained">Allow All</Button>`, `<Button mode="outlined" textColor={theme.colors.error}>Deny All</Button>`
  - **VoiceButton**: This is the largest component (1279 lines). Replace emoji/character icons with MaterialCommunityIcons (`microphone`, `stop`, `play`). Update colors for recording state, waveform, etc. with theme tokens. Keep all reanimated animation logic intact.
  - **EventFeed**: Theme tokens for event items
  - **EventLog**: Theme tokens for tool call display, code snippets
  - **SessionCard**: `<Card mode="outlined">` from Paper. Status chip with theme colors.
  - **KanbanBoard**: `<Card>` for columns, theme tokens for headers
  - **DiffView**: Green/red diff colors — keep semantic but adjust for light theme (lighter bg tints)
  - **FileViewer**: `surfaceContainerHighest` for code display
  - **FileChip**: `<Chip icon="file" onClose={onRemove}>`
  - **DirPicker**: `<List.Item>` for directories
  - **ConfigEditor**: Paper `TextInput`, `Switch`, `Button`
  - **QuickResponseButtons**: `<Button mode="contained-tonal" compact>` for each option
  - **ContextMeter**: Custom progress bar using theme colors (`primary`, `tertiary`, `surfaceVariant`)
  - **ErrorBoundary**: Error surface with `theme.colors.errorContainer`, `theme.colors.onErrorContainer`
- **MIRROR**: ANIMATION_PATTERN (keep existing reanimated code), HAPTIC_FEEDBACK
- **IMPORTS**: Various Paper components per file
- **GOTCHA**: VoiceButton at 1279 lines is the biggest risk — change only colors/icons, not logic. ApprovalCard gesture thresholds (`SWIPE_THRESHOLD`) must stay unchanged.
- **VALIDATE**: All components render, gesture interactions work, voice recording works

### Task 15: Responsive layout fixes
- **ACTION**: Audit and fix layout at 360×640, 390×844, 412×915, and tablet width
- **IMPLEMENT**:
  - Add `maxWidth: 600` + `alignSelf: 'center'` to main content containers for tablet/landscape
  - Verify `SafeAreaView` usage — `SafeAreaProvider` is at root but individual screens may need `useSafeAreaInsets()` for padding
  - Chat bubbles: ensure `maxWidth: '88%'` is maintained (already set)
  - Run panel: ensure `TextInput` doesn't overflow on narrow screens (360px)
  - ConnectScreen card: already uses `padding: 24` which may overflow on 360px — reduce to `16` on narrow screens using `useWindowDimensions`
  - Horizontal scroll lists (pills, agents): already use `ScrollView horizontal` — verify no overflow
  - Modal overlays: ensure they don't extend beyond safe area
- **MIRROR**: Existing responsive patterns
- **IMPORTS**: `import { useWindowDimensions } from 'react-native'`
- **GOTCHA**: `Dimensions.get('window')` is static — `useWindowDimensions()` hook is reactive to orientation changes. The app currently forces portrait (`"orientation": "portrait"` in app.json), so landscape is not a primary concern but max-width still helps on large phones.
- **VALIDATE**: Run on emulator at each viewport size; no horizontal overflow, no content cut off

### Task 16: WCAG contrast verification
- **ACTION**: Verify all text/background pairs meet WCAG AA (4.5:1 body, 3:1 large text)
- **IMPLEMENT**:
  - Check Paper's M3 default palette — it's designed to meet AA by default
  - Custom overrides to verify:
    - `onPrimaryContainer` on `primaryContainer` (user bubbles)
    - `onSurface` on `surfaceContainerHigh` (assistant bubbles)
    - `onSurfaceVariant` on `surfaceVariant` (code blocks)
    - Syntax highlight colors on code block bg (both themes)
    - Status colors (connected green, error red) on `background`
  - If any pair fails, adjust the custom override — Paper's tonal palette should handle most cases
  - Document contrast ratios in PR description
- **MIRROR**: N/A
- **IMPORTS**: N/A
- **GOTCHA**: The existing syntax highlight colors (#93c5fd, #a3e635, #fb923c) may fail on a light code block background. Prepare alternate lighter/darker variants.
- **VALIDATE**: Calculate contrast ratios for each pair; all ≥ 4.5:1 for body text

### Task 17: Add Snackbar for transient feedback
- **ACTION**: Replace silent clipboard operations with visible Snackbar feedback
- **IMPLEMENT**:
  - Add `<Snackbar>` from Paper at the app level or per-screen
  - Show "Copied to clipboard" on copy actions
  - Show "Sent" confirmation on send (optional — haptic may be sufficient)
  - Show error snackbar on failures
  - Use `<Portal>` for proper z-index layering
- **MIRROR**: HAPTIC_FEEDBACK — complement haptic with visual
- **IMPORTS**: `import { Snackbar, Portal } from 'react-native-paper'`
- **GOTCHA**: Snackbar needs Portal to render above other content. Multiple snackbars should queue, not stack.
- **VALIDATE**: Copy action shows snackbar, auto-dismisses after 3s

### Task 18: Clean up and verify
- **ACTION**: Remove all remaining hard-coded color literals, verify no regressions
- **IMPLEMENT**:
  - Search all `.tsx` files for remaining `#` color literals — replace with theme tokens
  - Remove unused style properties that were replaced by Paper components
  - Verify all `StyleSheet.create()` blocks reference theme (via `useTheme()` hook — note: styles must be inline or use a factory function since `useTheme` is a hook)
  - Run `npm test` to verify existing tests pass
  - Run TypeScript check
- **MIRROR**: All patterns
- **IMPORTS**: N/A
- **GOTCHA**: `StyleSheet.create()` is static and can't use hooks. Two approaches: (1) use inline `style={{}}` with theme values, or (2) create style factory functions `makeStyles(theme)` called inside the component. Approach (1) is simpler for this migration — Paper components handle most styling via props anyway. Keep `StyleSheet.create()` for non-theme-dependent layout styles (flex, padding ratios) and use inline for colors.
- **VALIDATE**: `grep -r '#[0-9a-fA-F]\{6\}' mobile/src/` returns zero hits (or only in third-party/test files)

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Theme exports valid shapes | Import lightTheme/darkTheme | Both conform to Paper MD3Theme type | No |
| ThemeContext defaults to system | Mount ThemeProvider | mode === 'system' | No |
| ThemeContext persists mode | Set mode to 'dark', remount | mode === 'dark' from AsyncStorage | No |
| splitTextAndCode still works | Markdown with code fences | Correct segments array | No |
| MessageBubble renders both roles | role='user', role='assistant' | Correct surface colors from theme | No |
| ChatView auto-scroll at bottom | Events appended while at bottom | ScrollView scrolls to end | No |
| ChatView no auto-scroll when scrolled up | Events appended while scrolled up | ScrollView stays at current position | Yes |

### Edge Cases Checklist
- [ ] System theme changes while app is in background
- [ ] Very long code blocks in light theme (readability)
- [ ] Empty chat state in both themes
- [ ] Keyboard open + pending approval card visible simultaneously
- [ ] PIN pad in light theme (contrast of dots)
- [ ] 360px wide device with long host name in ConnectScreen
- [ ] Landscape orientation on tablet (max-width cap)
- [ ] Rapid theme toggling
- [ ] VoiceButton recording state colors in light theme

---

## Validation Commands

### Static Analysis
```bash
cd mobile && npx tsc --noEmit
```
EXPECT: Zero type errors

### Unit Tests
```bash
cd mobile && npm test
```
EXPECT: All existing tests pass, no regressions

### Build Verification
```bash
cd mobile && npx expo export --platform android 2>&1 | tail -5
```
EXPECT: Bundle exports successfully

### Manual Validation
- [ ] Open app — defaults to system theme
- [ ] Dark mode: all screens readable, no pure black/white
- [ ] Light mode: all screens readable, good contrast
- [ ] ConnectScreen: card, inputs, buttons all M3-styled
- [ ] LockScreen: PIN pad themed, biometric works
- [ ] MainScreen top bar: M3 Appbar with icons (no emoji)
- [ ] Chat: user bubble primaryContainer, assistant surfaceContainerHigh
- [ ] Code blocks: themed background, syntax colors readable
- [ ] Keyboard opens: input stays visible, chat scrolls
- [ ] Keyboard closes: layout returns to normal
- [ ] Scroll up in chat, new message arrives: doesn't yank down
- [ ] At bottom of chat, new message: auto-scrolls
- [ ] Copy text: Snackbar appears
- [ ] Settings: List items with icons, theme picker works
- [ ] All secondary screens: themed, no hard-coded colors
- [ ] 360px width: no horizontal overflow
- [ ] 412px width: comfortable layout
- [ ] Approval card swipe: still works with themed colors
- [ ] Voice recording: themed button, recording indicator
- [ ] Haptic feedback: still fires on send/run

---

## Acceptance Criteria
- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing
- [ ] No type errors
- [ ] No lint errors
- [ ] Zero hard-coded color hex values in `mobile/src/` (theme tokens everywhere)
- [ ] System/Light/Dark mode all functional with persisted preference
- [ ] Keyboard avoidance working on chat screen
- [ ] WCAG AA contrast met for all text/background pairs
- [ ] No emoji used as icons (all MaterialCommunityIcons)
- [ ] No functional regressions — all flows work identically

## Completion Checklist
- [ ] Code follows discovered patterns (component structure, naming, haptics)
- [ ] Error handling matches codebase style (try/catch with empty catch for optional ops)
- [ ] Animations use existing react-native-reanimated patterns
- [ ] No hardcoded color values
- [ ] `app.json` updated to `userInterfaceStyle: "automatic"`
- [ ] No unnecessary scope additions (no new features)
- [ ] Self-contained — no questions needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| VoiceButton (1279 lines) migration introduces bugs | Medium | High | Change ONLY colors and icons, not logic. Test recording flow. |
| Paper TextInput breaks existing multiline/maxHeight behavior | Medium | Medium | Test ChatView input bar extensively; fall back to raw TextInput with theme colors if Paper's doesn't work |
| Syntax highlight colors unreadable in light theme | High | Medium | Prepare dual color set (dark/light) for code highlighting |
| Performance regression from Paper components (extra Views/wrappers) | Low | Medium | Paper v5 is well-optimized; monitor scroll performance in ChatView |
| ApprovalCard gesture behavior changes with themed styles | Low | High | Keep all reanimated/gesture-handler code unchanged; only modify color values |
| react-native-paper version conflict with Expo 54 | Low | High | Check Paper v5 Expo compatibility before starting; pin version if needed |

## Notes
- The app currently uses bottom-tabs navigation from React Navigation but only for internal state in MainScreen (SettingsScreen is a modal overlay, not a tab). The spec mentions evaluating `NavigationBar` vs drawer — the current modal-overlay pattern is actually simpler and works well for this app's structure. Recommend keeping it but restyling with M3 surface tokens rather than adding bottom nav.
- `react-native-paper` v5 is the correct choice over alternatives like `@react-native-material/core` because: (1) it's the most maintained RN M3 library, (2) it's officially recommended by React Native, (3) it has first-class Expo support, (4) the Callstack team actively maintains it.
- The seed color `#5B6ABF` (deep indigo) was chosen because the existing app already uses blue accents (`#93c5fd`, `#a5b4fc`). This seed generates a tonal palette that's close to the existing feel while being a proper M3 color system.
- Commit strategy: theme setup → App.tsx wiring → shared components → screen-by-screen → layout/keyboard → cleanup. This keeps the diff reviewable and bisectable.

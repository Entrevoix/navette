# Code Review: navette-ux-fixes

**Reviewed**: 2026-04-23
**Branch**: feat/navette-ux-fixes
**Decision**: APPROVE (after fixes applied)

## Summary

Comprehensive mobile UX pass across 12 modified files and 9 new files. Five bugs found and fixed during review. No CRITICAL or HIGH issues remain.

## Findings

### CRITICAL
None

### HIGH (all fixed during review)

| # | File | Line | Issue | Status |
|---|---|---|---|---|
| 1 | MainScreen.tsx | 189-194 | workDirLoadedRef guard blocked workDir reload on container switch | Fixed — removed ref guard, effect now fires on every container change |
| 2 | ChatView.tsx | 197-205 | handleCopyAll/handleShareAll missing try/catch — unhandled rejection on iOS share cancel | Fixed — wrapped in try/catch |
| 3 | MessageBubble.tsx | 44-46 | handleCopy missing try/catch (same bug class as #2) | Fixed |
| 4 | CodeBlock.tsx | 58-60 | handleCopy missing try/catch (same bug class as #2) | Fixed |
| 5 | McpServersScreen.tsx | 33,52-56 | `loading` condition identical to empty-state check, making "No MCP servers" UI unreachable — permanent spinner for zero servers | Fixed — added hasLoaded state to distinguish loading from empty |

### MEDIUM

| # | File | Issue |
|---|---|---|
| 1 | ws.rs | File approaching 1500 lines with 20+ inline handlers. Follow-up: extract into dispatch module. |
| 2 | Various | No tests for new utility functions (exportTranscriptMarkdown, splitTextAndCode, eventsToPlainText). |

### LOW

| # | File | Issue |
|---|---|---|
| 1 | ChatView.tsx:236 | `blurOnSubmit` deprecation warning (pre-existing, not introduced by this diff) |

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass (only pre-existing expo-camera error) |
| Lint (clippy) | Pass — zero warnings |
| Rust tests | Pass — 49/49 |
| Mobile tests | Pass — 49/49, 3 suites |
| Build | Pass |

## Files Reviewed

### Modified (12)
- mobile/App.tsx
- mobile/src/components/ChatView.tsx
- mobile/src/components/EventLog.tsx
- mobile/src/hooks/useNavettedWS.ts
- mobile/src/screens/MainScreen.tsx
- mobile/src/screens/SettingsScreen.tsx
- mobile/src/screens/SkillsScreen.tsx
- mobile/src/types/index.ts
- src/claude.rs
- src/config.rs
- src/main.rs
- src/ws.rs

### New (reviewed)
- mobile/src/components/MessageBubble.tsx
- mobile/src/components/CodeBlock.tsx
- mobile/src/screens/ContainerPickerScreen.tsx
- mobile/src/screens/McpServersScreen.tsx
- mobile/src/utils/transcript.ts

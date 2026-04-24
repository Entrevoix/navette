# PR Review: #16 — refactor: extract ws.rs parsers and add utility function tests

**Reviewed**: 2026-04-23
**Author**: jd
**Branch**: refactor/ws-handlers-and-tests → main
**Decision**: APPROVE

## Summary

Clean extraction of two pure parsing functions from inline handler code in ws.rs, with comprehensive test coverage across both Rust and TypeScript utility functions. No behavioral changes to existing handlers. All 43 new tests are well-structured with good edge case coverage.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW

| # | File | Issue |
|---|---|---|
| 1 | src/ws.rs | `parse_distrobox_output` doc comment says "host (no container)" is caller's responsibility — good, but the handler duplicates the host entry in both the Ok and Err arms. Not a bug, just slight duplication. |
| 2 | mobile/src/components/__tests__/EventLog.test.ts:8 | `frame()` helper duplicated across 2 test files. Minor — not worth extracting for 2 usages. |

## Validation Results

| Check | Result |
|---|---|
| Rust lint (clippy) | Pass — zero warnings |
| Rust tests | Pass — 58/58 (9 new) |
| Mobile tests | Pass — 83/83 (34 new), 6 suites |
| Build | Pass |

## Files Reviewed

### Modified (3)
- src/ws.rs — extract 2 parser functions, replace inline code with calls
- mobile/src/components/MessageBubble.tsx — export `splitTextAndCode` + `Segment`
- mobile/src/components/EventLog.tsx — export `eventsToPlainText`

### Added (3)
- mobile/src/components/__tests__/EventLog.test.ts — 13 tests
- mobile/src/components/__tests__/MessageBubble.test.ts — 7 tests
- mobile/src/utils/__tests__/transcript.test.ts — 13 tests

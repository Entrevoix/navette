# PR Review: #17 — refactor: deduplicate host entry in ws.rs and extract shared test helper

**Reviewed**: 2026-04-23
**Author**: jd
**Branch**: fix/low-review-findings → main
**Decision**: APPROVE

## Summary

Minimal cleanup PR addressing both LOW findings from PR #16 review. Extracts a duplicated JSON literal into a variable and consolidates a duplicated test helper into a shared module. No behavioral changes, net -2 lines.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM
None

### LOW
None

## Validation Results

| Check | Result |
|---|---|
| Rust lint (clippy) | Pass — zero warnings |
| Rust tests | Pass — 58/58 |
| Mobile tests | Pass — 83/83, 6 suites |

## Files Reviewed

### Modified (2)
- src/ws.rs — extract `host_entry` variable before match, use in both arms
- mobile/src/components/__tests__/EventLog.test.ts — import shared `frame()` helper
- mobile/src/utils/__tests__/transcript.test.ts — import shared `frame()` helper

### Added (1)
- mobile/src/__test-utils__/frame.ts — shared test utility for `EventFrame` construction

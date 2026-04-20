# Plan: Upgrade to Expo 54 / React Native 0.81.5+

## Summary
Upgrade the mobile app from its current Expo SDK / React Native version to Expo 54 with RN 0.81.5+. This permanently fixes the Android 16 permission-hang regression (facebook/react-native#53898), resolves 16KB page-size alignment for newer ARM devices, and clears the ErrorUtils tech debt from the Hermes global workaround.

## User Story
As a developer running clauded on Android 16 devices,
I want the Expo/RN stack upgraded to 0.81.5+,
So that native permission prompts no longer hang and the JS check-first workaround in VoiceButton.tsx can be removed.

## Problem → Solution
Android 16 (Sept 2025 patch) broke SpeechRecognizer permission flow in RN < 0.81.5 → Upgrade to RN 0.81.5+ where the fix has landed natively, remove JS workaround code.

## Metadata
- **Complexity**: Large
- **Source PRD**: ROADMAP.md backlog
- **PRD Phase**: N/A
- **Estimated Files**: 15-25 (package.json, lockfile, native configs, VoiceButton workaround removal, ErrorUtils cleanup, expo-asset pin removal)

---

## UX Design

N/A — internal upgrade. No user-facing UX transformation.

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Voice button | Works via JS check-first workaround | Works natively without workaround | Behavior identical to user |
| App startup | ErrorUtils accessed as Hermes global | Can use proper import if available | No visible change |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `mobile/package.json` | all | Current dependency versions |
| P0 | `mobile/src/components/VoiceButton.tsx` | all | Contains Android 16 workaround code to remove |
| P0 | `mobile/app.json` or `mobile/app.config.js` | all | Expo SDK version and plugin config |
| P1 | `mobile/android/build.gradle` | all | Gradle config, debuggableVariants, page-size settings |
| P1 | `mobile/android/app/build.gradle` | all | App-level build config |
| P2 | `mobile/src/components/ErrorBoundary.tsx` | all | ErrorUtils usage |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Expo 54 migration | Expo changelog / upgrade guide | Breaking changes, deprecated APIs |
| RN 0.81.5 changelog | React Native releases | Permission fix confirmation |
| 16KB page size | Android developer docs | ARM64 alignment requirements |
| expo-asset compatibility | expo-asset changelog | Can remove ~11.0.5 pin if Expo 54 ships compatible version |

---

## Patterns to Mirror

### NAMING_CONVENTION
// SOURCE: mobile/src/components/VoiceButton.tsx
PascalCase components, camelCase hooks, kebab-case for CSS/config files.

### ERROR_HANDLING
// SOURCE: mobile/src/components/ErrorBoundary.tsx
ErrorBoundary wraps app; errors caught and displayed to user.

### TEST_STRUCTURE
// SOURCE: mobile/src/components/__tests__/VoiceButton.test.tsx
Jest tests in `__tests__/` sibling directories; test file mirrors component name.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `mobile/package.json` | UPDATE | Bump expo, react-native, expo-asset, and related deps |
| `mobile/src/components/VoiceButton.tsx` | UPDATE | Remove Android 16 JS check-first permission workaround |
| `mobile/src/components/__tests__/VoiceButton.test.tsx` | UPDATE | Update tests to remove workaround assertions |
| `mobile/android/build.gradle` | UPDATE | Gradle plugin version bump |
| `mobile/android/app/build.gradle` | UPDATE | targetSdk, compileSdk, 16KB page alignment |
| `mobile/android/gradle.properties` | UPDATE | RN version properties if present |
| `mobile/app.json` or `mobile/app.config.js` | UPDATE | SDK version bump |
| `mobile/ios/Podfile` | UPDATE | iOS deployment target if required |

## NOT Building

- iOS App Store submission (separate task)
- New features — this is purely an upgrade PR
- Mosh/UDP transport
- Apple Watch companion

---

## Step-by-Step Tasks

### Task 1: Read Expo 54 migration guide
- **ACTION**: Research breaking changes and required steps
- **IMPLEMENT**: Document any breaking changes that affect clauded mobile
- **MIRROR**: N/A — research task
- **IMPORTS**: N/A
- **GOTCHA**: Expo SDK upgrades often require `npx expo install --fix` to align transitive deps
- **VALIDATE**: List of breaking changes documented

### Task 2: Bump Expo SDK and RN version
- **ACTION**: Update package.json, run `npx expo install --fix`
- **IMPLEMENT**: Change expo SDK version, react-native version, and all expo-* packages
- **MIRROR**: Existing package.json structure
- **IMPORTS**: N/A
- **GOTCHA**: expo-asset pin (~11.0.5) may no longer be needed — check compatibility
- **VALIDATE**: `npx expo doctor` reports no issues

### Task 3: Update Android native config
- **ACTION**: Update build.gradle files for new RN version
- **IMPLEMENT**: Bump compileSdk, targetSdk, Gradle plugin version; verify 16KB page-size alignment
- **MIRROR**: Existing android/build.gradle patterns
- **IMPORTS**: N/A
- **GOTCHA**: debuggableVariants=[] must remain for bundled JS in debug builds (see memory: expo52-standalone-apk-setup)
- **VALIDATE**: `cd mobile/android && ./gradlew assembleDebug` succeeds

### Task 4: Update iOS native config
- **ACTION**: Update Podfile, run pod install
- **IMPLEMENT**: Bump deployment target if Expo 54 requires it
- **MIRROR**: Existing Podfile patterns
- **IMPORTS**: N/A
- **GOTCHA**: CocoaPods may need `pod repo update` first
- **VALIDATE**: `cd mobile/ios && pod install` succeeds

### Task 5: Remove Android 16 permission workaround from VoiceButton
- **ACTION**: Remove the JS check-first pattern that was a workaround for facebook/react-native#53898
- **IMPLEMENT**: Remove the pre-check permission logic; let native permission flow handle it directly
- **MIRROR**: Standard RN permission patterns
- **IMPORTS**: N/A
- **GOTCHA**: Must verify on Android 16 device/emulator that permissions still work
- **VALIDATE**: Voice button works on Android 16 without hang

### Task 6: Clean up ErrorUtils tech debt
- **ACTION**: If RN 0.81.5+ exports ErrorUtils properly, switch from Hermes global access
- **IMPLEMENT**: Replace `global.ErrorUtils` access with proper import if available
- **MIRROR**: N/A
- **IMPORTS**: Check if `react-native` now exports ErrorUtils
- **GOTCHA**: ErrorUtils may still be Hermes-only global — check before changing (see memory: rn-076-errorutils-not-exported)
- **VALIDATE**: App starts without crash; ErrorBoundary still catches errors

### Task 7: Update tests
- **ACTION**: Update VoiceButton tests to reflect removed workaround
- **IMPLEMENT**: Remove test cases for the JS check-first pattern
- **MIRROR**: Existing test patterns in `__tests__/`
- **IMPORTS**: N/A
- **GOTCHA**: Don't remove tests for actual voice functionality, only workaround-specific ones
- **VALIDATE**: `cd mobile && npx jest` passes

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| VoiceButton renders | Default props | Button visible | No |
| VoiceButton toggle | Tap mic | Recording starts/stops | No |
| ErrorBoundary catches | Throw in child | Error UI shown | Yes |

### Edge Cases Checklist
- [ ] Android 16 device: permission prompt appears and resolves
- [ ] Android < 16: no regression in voice button behavior
- [ ] App startup: no ErrorUtils crash
- [ ] expo-asset: bundled images still load in debug APK
- [ ] All existing screens render without crash

---

## Validation Commands

### Static Analysis
```bash
cd mobile && npx expo doctor
```
EXPECT: No critical issues

### Unit Tests
```bash
cd mobile && npx jest
```
EXPECT: All tests pass

### Android Build
```bash
cd mobile/android && ./gradlew assembleDebug
```
EXPECT: APK builds successfully

### iOS Build (if on macOS)
```bash
cd mobile/ios && pod install && xcodebuild -workspace *.xcworkspace -scheme clauded -configuration Debug -sdk iphonesimulator build
```
EXPECT: Build succeeds

---

## Acceptance Criteria
- [ ] Expo 54 SDK and RN 0.81.5+ in package.json
- [ ] Android 16 permission workaround removed from VoiceButton.tsx
- [ ] Android APK builds and runs
- [ ] Voice button works on Android 16 without workaround
- [ ] All existing tests pass
- [ ] No ErrorUtils crash at startup

## Completion Checklist
- [ ] Code follows discovered patterns
- [ ] Tests updated
- [ ] No hardcoded values
- [ ] No unnecessary scope additions

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Expo 54 has breaking changes in navigation/splash | Medium | High | Read migration guide thoroughly; test every screen |
| expo-asset regression | Low | High | Keep pin as fallback if new version breaks bundled assets |
| ErrorUtils still not exported in 0.81.5 | Medium | Low | Keep Hermes global access if so; just document |

## Notes
- This PR is a prerequisite for iOS App Store submission (PR 4 / Apple Watch also benefits)
- The EXTRA_LANGUAGE_MODEL=web_search Soda workaround in VoiceButton may still be needed even after upgrade — that's a Google TTS bug, not an RN bug

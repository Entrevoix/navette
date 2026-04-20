# Plan: Android .aab Release Build + Signing

## Summary
Set up Android App Bundle (.aab) release build with proper keystore signing, ProGuard/R8 minification, and a repeatable build pipeline. Currently the APK is debug-signed — this PR produces a Play Store-ready artifact.

## User Story
As the project maintainer,
I want a signed .aab release build,
So that the app can be submitted to the Google Play Store.

## Problem → Solution
Current APK is debug-signed and cannot be uploaded to Play Store → Generate keystore, configure Gradle signing, produce signed .aab.

## Metadata
- **Complexity**: Medium
- **Source PRD**: ROADMAP.md backlog
- **PRD Phase**: N/A
- **Estimated Files**: 5-8

---

## UX Design

N/A — internal build/release infrastructure. No user-facing UX transformation.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `mobile/android/app/build.gradle` | all | Current build config, signing config, build types |
| P0 | `mobile/android/build.gradle` | all | Root Gradle config |
| P1 | `mobile/android/gradle.properties` | all | Current properties |
| P1 | `mobile/app.json` or `mobile/app.config.js` | all | Expo config (versionCode, versionName) |
| P2 | `mobile/package.json` | all | Build scripts |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Android App Signing | Android developer docs | Upload key vs app signing key; Play App Signing recommended |
| EAS Build (if using) | Expo docs | `eas build --platform android` can handle signing |
| ProGuard/R8 | Android docs | minifyEnabled=true for release; need proguard-rules.pro for RN |

---

## Patterns to Mirror

### BUILD_CONFIG
// SOURCE: mobile/android/app/build.gradle
Existing debug build type config; release type must mirror with signing additions.

### GRADLE_PROPERTIES
// SOURCE: mobile/android/gradle.properties
Properties file for build-time values; signing config should reference env vars or properties.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `mobile/android/app/build.gradle` | UPDATE | Add release signing config, enable R8/ProGuard for release |
| `mobile/android/gradle.properties` | UPDATE | Add keystore property references (path, alias, passwords via env) |
| `mobile/android/app/proguard-rules.pro` | CREATE | ProGuard rules for React Native + Hermes |
| `mobile/.env.example` | UPDATE | Document required signing env vars |
| `mobile/package.json` | UPDATE | Add `build:release` script |
| `mobile/.gitignore` | UPDATE | Ensure keystore files are gitignored |
| `ROADMAP.md` | UPDATE | Mark as shipped |

## NOT Building

- Play Store listing / screenshots / metadata
- CI/CD pipeline (manual build for now)
- iOS signing (separate PR)
- Automated version bumping

---

## Step-by-Step Tasks

### Task 1: Generate release keystore
- **ACTION**: Document keystore generation command (not automated — manual one-time step)
- **IMPLEMENT**: Add script/instructions: `keytool -genkeypair -v -storetype PKCS12 -keystore release.keystore -alias clauded -keyalg RSA -keysize 2048 -validity 10000`
- **MIRROR**: N/A
- **IMPORTS**: N/A
- **GOTCHA**: Keystore MUST NOT be committed to git; store securely outside repo
- **VALIDATE**: Keystore file generated

### Task 2: Configure Gradle signing
- **ACTION**: Add release signingConfig to app/build.gradle
- **IMPLEMENT**:
  - Read keystore path, alias, passwords from gradle.properties or env vars
  - `signingConfigs { release { ... } }`
  - `buildTypes { release { signingConfig signingConfigs.release; minifyEnabled true; proguardFiles ... } }`
- **MIRROR**: Existing debug buildType patterns
- **IMPORTS**: N/A
- **GOTCHA**: debuggableVariants=[] must remain for debug builds (bundled JS requirement — see memory)
- **VALIDATE**: `./gradlew assembleRelease` doesn't fail on signing config

### Task 3: Add ProGuard rules for React Native
- **ACTION**: Create proguard-rules.pro with RN + Hermes keep rules
- **IMPLEMENT**: Standard RN ProGuard rules: keep Hermes, React Native bridge, OkHttp, Flipper exclusions
- **MIRROR**: Community RN ProGuard templates
- **IMPORTS**: N/A
- **GOTCHA**: Missing keep rules cause runtime crashes — test thoroughly
- **VALIDATE**: Release build runs without ClassNotFoundException or method-not-found

### Task 4: Add gradle.properties for signing references
- **ACTION**: Add signing property keys that reference environment variables
- **IMPLEMENT**:
  ```
  CLAUDED_RELEASE_STORE_FILE=../release.keystore
  CLAUDED_RELEASE_KEY_ALIAS=clauded
  CLAUDED_RELEASE_STORE_PASSWORD=env:CLAUDED_STORE_PASSWORD
  CLAUDED_RELEASE_KEY_PASSWORD=env:CLAUDED_KEY_PASSWORD
  ```
- **MIRROR**: Existing gradle.properties patterns
- **IMPORTS**: N/A
- **GOTCHA**: Never commit actual passwords; use env vars
- **VALIDATE**: Properties readable by Gradle

### Task 5: Add build:release script
- **ACTION**: Add npm script for release build
- **IMPLEMENT**: `"build:release": "cd android && ./gradlew bundleRelease"` in package.json
- **MIRROR**: Existing script patterns in package.json
- **IMPORTS**: N/A
- **GOTCHA**: bundleRelease produces .aab; assembleRelease produces .apk — need .aab for Play Store
- **VALIDATE**: `npm run build:release` produces .aab in `android/app/build/outputs/bundle/release/`

### Task 6: Update .gitignore
- **ACTION**: Ensure keystore and signing artifacts are excluded
- **IMPLEMENT**: Add `*.keystore`, `*.jks`, `release.keystore` to .gitignore
- **MIRROR**: Existing .gitignore patterns
- **IMPORTS**: N/A
- **GOTCHA**: Check if already covered by existing patterns
- **VALIDATE**: `git status` doesn't show keystore files

### Task 7: Document signing setup
- **ACTION**: Add signing setup instructions to .env.example or a build doc
- **IMPLEMENT**: Document env vars, keystore generation, and build command
- **MIRROR**: N/A
- **IMPORTS**: N/A
- **GOTCHA**: N/A
- **VALIDATE**: A fresh checkout can follow instructions to build

---

## Testing Strategy

### Unit Tests
N/A — build infrastructure change, no code logic to unit test.

### Edge Cases Checklist
- [ ] Release build starts and runs on device
- [ ] ProGuard doesn't strip required classes
- [ ] Hermes bytecode works in release mode
- [ ] All screens render in release build
- [ ] Voice button works in release build
- [ ] WebSocket connection works in release build
- [ ] Missing env vars produce clear build error (not silent failure)

---

## Validation Commands

### Release Build
```bash
cd mobile/android && ./gradlew bundleRelease
```
EXPECT: .aab produced in `app/build/outputs/bundle/release/`

### APK from Bundle (for testing)
```bash
cd mobile/android && ./gradlew assembleRelease
```
EXPECT: Signed APK installs and runs

### Verify Signing
```bash
jarsigner -verify -verbose -certs mobile/android/app/build/outputs/apk/release/app-release.apk
```
EXPECT: "jar verified" with correct certificate

---

## Acceptance Criteria
- [ ] `./gradlew bundleRelease` produces signed .aab
- [ ] Release APK installs and runs on device
- [ ] No keystore or passwords in git
- [ ] ProGuard doesn't break runtime behavior
- [ ] Build instructions documented

## Completion Checklist
- [ ] Signing config uses env vars (no hardcoded secrets)
- [ ] .gitignore updated
- [ ] ProGuard rules tested
- [ ] All app features work in release build

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ProGuard strips needed classes | Medium | High | Use standard RN keep rules; test all features in release build |
| Hermes bytecode issue in release | Low | High | Hermes is default in Expo — should work; test on device |
| Lost keystore = can't update app | Medium | Critical | Document backup procedure; consider Play App Signing |

## Notes
- Play Store account setup is a prerequisite but not part of this PR
- Consider Play App Signing (Google manages the app signing key, you keep the upload key) for key safety

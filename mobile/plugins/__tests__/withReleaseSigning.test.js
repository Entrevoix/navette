// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

const { _testing } = require('../withReleaseSigning');
const { addSigningConfig, findMatchingBrace, findBlock, configureReleaseBuildType } = _testing;

const EXPO_BUILD_GRADLE = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;

const ALREADY_CONFIGURED = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            def storePath = findProperty('NAVETTE_RELEASE_STORE_FILE')
            if (storePath) {
                storeFile file(storePath)
            }
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"
        }
    }
}
`;

const NO_SIGNING_CONFIGS = `
android {
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
`;

describe('findMatchingBrace', () => {
  it('finds matching brace for simple block', () => {
    const str = '{ hello }';
    expect(findMatchingBrace(str, 0)).toBe(8);
  });

  it('handles nested braces', () => {
    const str = '{ a { b } c }';
    expect(findMatchingBrace(str, 0)).toBe(12);
  });

  it('returns -1 when no match', () => {
    expect(findMatchingBrace('{ a', 0)).toBe(-1);
  });
});

describe('findBlock', () => {
  it('finds inner block within outer block', () => {
    const result = findBlock(EXPO_BUILD_GRADLE, 'buildTypes', 'release');
    expect(result).not.toBeNull();
    const body = EXPO_BUILD_GRADLE.slice(result.bodyStart, result.bodyEnd);
    expect(body).toContain('signingConfig signingConfigs.debug');
    expect(body).toContain('minifyEnabled false');
  });

  it('finds release block even when debug block comes first', () => {
    const result = findBlock(EXPO_BUILD_GRADLE, 'buildTypes', 'release');
    expect(result).not.toBeNull();
    const body = EXPO_BUILD_GRADLE.slice(result.bodyStart, result.bodyEnd);
    expect(body).not.toContain('androiddebugkey');
  });

  it('returns null when outer block missing', () => {
    expect(findBlock('android {}', 'buildTypes', 'release')).toBeNull();
  });

  it('returns null when inner block missing', () => {
    const gradle = 'buildTypes { debug { } }';
    expect(findBlock(gradle, 'buildTypes', 'release')).toBeNull();
  });
});

describe('addSigningConfig', () => {
  it('injects release signing into existing signingConfigs block', () => {
    const result = addSigningConfig(EXPO_BUILD_GRADLE);
    expect(result).toContain('NAVETTE_RELEASE_STORE_FILE');
    expect(result).toContain("storeFile file('debug.keystore')");
    const signingConfigsCount = (result.match(/signingConfigs \{/g) || []).length;
    expect(signingConfigsCount).toBe(1);
  });

  it('is idempotent — returns unchanged if already configured', () => {
    const result = addSigningConfig(ALREADY_CONFIGURED);
    expect(result).toBe(ALREADY_CONFIGURED);
  });

  it('falls back to inserting before buildTypes when no signingConfigs block', () => {
    const result = addSigningConfig(NO_SIGNING_CONFIGS);
    expect(result).toContain('NAVETTE_RELEASE_STORE_FILE');
    expect(result).toContain('signingConfigs {');
    const buildTypesIdx = result.indexOf('buildTypes {');
    const signingIdx = result.indexOf('signingConfigs {');
    expect(signingIdx).toBeLessThan(buildTypesIdx);
  });
});

describe('configureReleaseBuildType', () => {
  it('replaces debug signing with release signing in release buildType', () => {
    const result = configureReleaseBuildType(EXPO_BUILD_GRADLE);
    expect(result).toContain('signingConfig signingConfigs.release');
    expect(result).not.toMatch(/release\s*\{[^}]*signingConfig signingConfigs\.debug/s);
  });

  it('enables minification', () => {
    const result = configureReleaseBuildType(EXPO_BUILD_GRADLE);
    expect(result).toContain('minifyEnabled true');
    expect(result).not.toContain('minifyEnabled false');
  });

  it('adds shrinkResources', () => {
    const result = configureReleaseBuildType(EXPO_BUILD_GRADLE);
    expect(result).toContain('shrinkResources true');
  });

  it('adds proguard config', () => {
    const result = configureReleaseBuildType(EXPO_BUILD_GRADLE);
    expect(result).toContain('proguard-rules.pro');
  });

  it('is idempotent — does not duplicate entries', () => {
    const result = configureReleaseBuildType(ALREADY_CONFIGURED);
    const matches = result.match(/signingConfig signingConfigs\.release/g) || [];
    expect(matches.length).toBe(1);
  });

  it('works when debug block precedes release block', () => {
    const result = configureReleaseBuildType(EXPO_BUILD_GRADLE);
    expect(result).toContain('signingConfig signingConfigs.release');
    const debugBlock = findBlock(result, 'buildTypes', 'debug');
    expect(debugBlock).not.toBeNull();
    const debugBody = result.slice(debugBlock.bodyStart, debugBlock.bodyEnd);
    expect(debugBody).toContain('signingConfig signingConfigs.debug');
  });

  it('warns and returns unchanged when no release buildType', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const gradle = 'android { buildTypes { debug { } } }';
    const result = configureReleaseBuildType(gradle);
    expect(result).toBe(gradle);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not locate'));
    warnSpy.mockRestore();
  });
});

describe('end-to-end: addSigningConfig + configureReleaseBuildType', () => {
  it('produces correct output from standard Expo build.gradle', () => {
    let result = addSigningConfig(EXPO_BUILD_GRADLE);
    result = configureReleaseBuildType(result);
    expect(result).toContain('NAVETTE_RELEASE_STORE_FILE');
    expect(result).toContain('signingConfig signingConfigs.release');
    expect(result).toContain('minifyEnabled true');
    expect(result).toContain('shrinkResources true');
    expect(result).toContain('proguard-rules.pro');
    const signingConfigsCount = (result.match(/signingConfigs \{/g) || []).length;
    expect(signingConfigsCount).toBe(1);
  });
});

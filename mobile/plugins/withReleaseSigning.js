// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

// Expo config plugin that configures Android release signing and ProGuard/R8.
// Reads keystore credentials from gradle.properties (which in turn can
// reference environment variables). This lets the android/ directory remain
// gitignored while release builds are reproducible from env vars alone.

const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SIGNING_CONFIG_BLOCK = `
    signingConfigs {
        release {
            def storePath = project.hasProperty('NAVETTE_RELEASE_STORE_FILE')
                ? project.property('NAVETTE_RELEASE_STORE_FILE') : null
            if (storePath) {
                storeFile file(storePath)
                storePassword project.property('NAVETTE_RELEASE_STORE_PASSWORD')
                keyAlias project.property('NAVETTE_RELEASE_KEY_ALIAS')
                keyPassword project.property('NAVETTE_RELEASE_KEY_PASSWORD')
            }
        }
    }
`;

function addSigningConfig(buildGradle) {
  if (buildGradle.includes("signingConfigs.release") || buildGradle.includes("NAVETTE_RELEASE_STORE_FILE")) {
    return buildGradle;
  }

  const signingIdx = buildGradle.indexOf('signingConfigs {');
  if (signingIdx !== -1) {
    const openBrace = buildGradle.indexOf('{', signingIdx);
    const closingBrace = findMatchingBrace(buildGradle, openBrace);
    if (closingBrace !== -1) {
      return buildGradle.slice(0, closingBrace) +
        SIGNING_CONFIG_BLOCK.replace(/^\s*signingConfigs \{\n?/, '').replace(/\n\s*\}\s*$/, '\n') +
        buildGradle.slice(closingBrace);
    }
  }

  const anchor = 'buildTypes {';
  const idx = buildGradle.indexOf(anchor);
  if (idx === -1) return buildGradle;

  return buildGradle.slice(0, idx) + SIGNING_CONFIG_BLOCK.trimStart() + '\n    ' + buildGradle.slice(idx);
}

function findMatchingBrace(str, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findBlock(buildGradle, outerName, innerName) {
  const outerIdx = buildGradle.indexOf(outerName + ' {');
  if (outerIdx === -1) return null;
  const outerOpen = buildGradle.indexOf('{', outerIdx);
  const outerClose = findMatchingBrace(buildGradle, outerOpen);
  if (outerClose === -1) return null;

  const innerIdx = buildGradle.indexOf(innerName + ' {', outerIdx);
  if (innerIdx === -1 || innerIdx > outerClose) return null;
  const innerOpen = buildGradle.indexOf('{', innerIdx);
  const innerClose = findMatchingBrace(buildGradle, innerOpen);
  if (innerClose === -1) return null;

  return { bodyStart: innerOpen + 1, bodyEnd: innerClose };
}

function configureReleaseBuildType(buildGradle) {
  const block = findBlock(buildGradle, 'buildTypes', 'release');
  if (!block) {
    console.warn('[withReleaseSigning] Could not locate release buildType block — signing config not wired');
    return buildGradle;
  }

  let releaseBody = buildGradle.slice(block.bodyStart, block.bodyEnd);

  if (!releaseBody.includes('signingConfig signingConfigs.release')) {
    releaseBody = releaseBody.replace(
      /signingConfig\s+signingConfigs\.\w+/,
      'signingConfig signingConfigs.release',
    );
    if (!releaseBody.includes('signingConfig signingConfigs.release')) {
      releaseBody += '\n            signingConfig signingConfigs.release\n';
    }
  }

  if (!releaseBody.includes('minifyEnabled true')) {
    releaseBody = releaseBody.replace(/minifyEnabled\s+false/, 'minifyEnabled true');
    if (!releaseBody.includes('minifyEnabled true')) {
      releaseBody += '            minifyEnabled true\n';
    }
  }

  if (!releaseBody.includes('shrinkResources true')) {
    releaseBody += '            shrinkResources true\n';
  }

  if (!releaseBody.includes('proguard-rules.pro')) {
    releaseBody += '            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"\n';
  }

  return buildGradle.slice(0, block.bodyStart) + releaseBody + buildGradle.slice(block.bodyEnd);
}

function withReleaseSigning(config) {
  config = withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    gradle = addSigningConfig(gradle);
    gradle = configureReleaseBuildType(gradle);
    cfg.modResults.contents = gradle;
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const src = path.resolve(__dirname, '..', 'proguard-rules.pro');
      const dst = path.join(cfg.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
      }
      return cfg;
    },
  ]);

  return config;
}

module.exports = withReleaseSigning;
module.exports._testing = { addSigningConfig, findMatchingBrace, findBlock, configureReleaseBuildType };

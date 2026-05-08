#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const mobileRoot = path.join(repoRoot, 'mobile-app');
const configPath = path.join(mobileRoot, 'app.config.js');
const appJsonPath = path.join(mobileRoot, 'app.json');

const expectedAssetReferences = {
  'expo.icon': './assets/icon.png',
  'expo.android.icon': './assets/icon.png',
  'expo.android.adaptiveIcon.foregroundImage': './assets/adaptive-icon.png',
  'expo.splash.image': './assets/splash.png',
};

const staleIconReferencePatterns = [
  /@mipmap\/ic_launcher/i,
  /ic_launcher/i,
  /expo-template/i,
  /placeholder[-_ ]?icon/i,
  /default[-_ ]?icon/i,
  /temporary[-_ ]?icon/i,
  /todo[^\n]{0,80}icon/i,
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function readPngDimensions(assetPath) {
  const buffer = fs.readFileSync(assetPath);
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    throw new Error('not a PNG file');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function assertExpectedReference(label, assetReference) {
  const expected = expectedAssetReferences[label];
  if (assetReference !== expected) {
    fail(`${label} must reference ${expected}; found ${assetReference || 'nothing'}.`);
  } else {
    pass(`${label} reference -> ${expected}`);
  }
}

function resolveAsset(label, assetReference) {
  assertExpectedReference(label, assetReference);

  if (!assetReference) {
    fail(`${label} is not configured.`);
    return null;
  }

  const assetPath = path.resolve(mobileRoot, assetReference);
  if (!assetPath.startsWith(`${mobileRoot}${path.sep}`)) {
    fail(`${label} points outside mobile-app: ${assetReference}`);
    return null;
  }

  if (!fs.existsSync(assetPath)) {
    fail(`${label} asset is missing: ${assetReference}`);
    return null;
  }

  try {
    const dimensions = readPngDimensions(assetPath);
    pass(`${label} asset -> ${path.relative(repoRoot, assetPath)} (${dimensions.width}x${dimensions.height})`);
    return { assetPath, dimensions };
  } catch (error) {
    fail(`${label} must point to a valid PNG: ${assetReference} (${error.message})`);
    return null;
  }
}

function assertSquare(label, asset) {
  if (asset && asset.dimensions.width !== asset.dimensions.height) {
    fail(`${label} must be square.`);
  }
}

function assertMinimumDimensions(label, asset, minimumSize) {
  if (!asset) return;

  const { width, height } = asset.dimensions;
  if (width < minimumSize || height < minimumSize) {
    fail(`${label} should be at least ${minimumSize}x${minimumSize}; found ${width}x${height}.`);
  }
}

function assertHexColor(label, color) {
  if (!color) {
    fail(`${label} is not configured.`);
  } else if (!/^#[0-9a-f]{6}$/i.test(color)) {
    fail(`${label} must be a six-digit hex color; found ${color}.`);
  } else {
    pass(`${label} -> ${color}`);
  }
}

function scanForStaleIconReferences(files) {
  for (const filePath of files) {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const pattern of staleIconReferencePatterns) {
      const match = text.match(pattern);
      if (match) {
        fail(`stale placeholder/default Android icon reference found in ${path.relative(repoRoot, filePath)}: ${match[0]}`);
      }
    }
  }

  pass(`no stale placeholder/default Android icon references in ${files.map((file) => path.relative(repoRoot, file)).join(', ')}`);
}

const config = require(configPath);

const appIcon = resolveAsset('expo.icon', config.icon);
const androidIcon = resolveAsset('expo.android.icon', config.android?.icon);
const adaptiveForeground = resolveAsset(
  'expo.android.adaptiveIcon.foregroundImage',
  config.android?.adaptiveIcon?.foregroundImage
);
const splashImage = resolveAsset('expo.splash.image', config.splash?.image);

assertSquare('expo.icon', appIcon);
assertSquare('expo.android.icon', androidIcon);
assertSquare('expo.android.adaptiveIcon.foregroundImage', adaptiveForeground);
assertMinimumDimensions('expo.icon', appIcon, 1024);
assertMinimumDimensions('expo.android.icon', androidIcon, 1024);
assertMinimumDimensions('expo.android.adaptiveIcon.foregroundImage', adaptiveForeground, 1024);

if (!splashImage) {
  fail('expo.splash.image must resolve to a valid PNG.');
}

assertHexColor('expo.android.adaptiveIcon.backgroundColor', config.android?.adaptiveIcon?.backgroundColor);
assertHexColor('expo.splash.backgroundColor', config.splash?.backgroundColor);

if (!config.splash?.resizeMode) {
  fail('expo.splash.resizeMode is not configured.');
} else {
  pass(`expo.splash.resizeMode -> ${config.splash.resizeMode}`);
}

scanForStaleIconReferences([appJsonPath, configPath]);

if (process.exitCode) {
  process.exit(process.exitCode);
}

pass('Mobile app branding configuration is complete.');

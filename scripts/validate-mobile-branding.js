#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const mobileRoot = path.join(repoRoot, 'mobile-app');
const configPath = path.join(mobileRoot, 'app.config.js');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
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

function resolveAsset(label, assetReference) {
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
    console.log(`PASS: ${label} -> ${path.relative(repoRoot, assetPath)} (${dimensions.width}x${dimensions.height})`);
    return { assetPath, dimensions };
  } catch (error) {
    fail(`${label} must point to a valid PNG: ${assetReference} (${error.message})`);
    return null;
  }
}

const config = require(configPath);

const appIcon = resolveAsset('expo.icon', config.icon);
const androidIcon = resolveAsset('expo.android.icon', config.android?.icon);
const adaptiveForeground = resolveAsset(
  'expo.android.adaptiveIcon.foregroundImage',
  config.android?.adaptiveIcon?.foregroundImage
);
const splashImage = resolveAsset('expo.splash.image', config.splash?.image);

if (appIcon && appIcon.dimensions.width !== appIcon.dimensions.height) {
  fail('expo.icon must be square for installable app icons.');
}

if (androidIcon && androidIcon.dimensions.width !== androidIcon.dimensions.height) {
  fail('expo.android.icon must be square for Android launcher icons.');
}

if (adaptiveForeground && adaptiveForeground.dimensions.width !== adaptiveForeground.dimensions.height) {
  fail('expo.android.adaptiveIcon.foregroundImage must be square.');
}

if (!config.android?.adaptiveIcon?.backgroundColor) {
  fail('expo.android.adaptiveIcon.backgroundColor is not configured.');
} else {
  console.log(`PASS: expo.android.adaptiveIcon.backgroundColor -> ${config.android.adaptiveIcon.backgroundColor}`);
}

if (!config.splash?.backgroundColor) {
  fail('expo.splash.backgroundColor is not configured.');
} else {
  console.log(`PASS: expo.splash.backgroundColor -> ${config.splash.backgroundColor}`);
}

if (!config.splash?.resizeMode) {
  fail('expo.splash.resizeMode is not configured.');
} else {
  console.log(`PASS: expo.splash.resizeMode -> ${config.splash.resizeMode}`);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('PASS: Mobile app branding configuration is complete.');

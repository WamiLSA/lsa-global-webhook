#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.cwd();
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.expo',
  '.next',
  'coverage',
]);
const TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.env', '.html', '.js', '.json', '.jsx', '.mjs', '.md',
  '.mdx', '.svg', '.ts', '.tsx', '.txt', '.yml', '.yaml',
]);
const WAV_REFERENCE_PATTERN = /(?:(['"`])([^'"`\n\r]+?\.wav)(?:\1)|([^\s'"`()<>]+?\.wav))/gi;

function walk(dir, visitor) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, visitor);
    } else if (entry.isFile()) {
      visitor(fullPath);
    }
  }
}

function rel(filePath) {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
}

function isLikelyText(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function validateWav(filePath) {
  const size = fs.statSync(filePath).size;
  const errors = [];

  if (size === 0) {
    return { ok: false, size, errors: ['file is empty'] };
  }
  if (size < 44) {
    return { ok: false, size, errors: ['file is too small to be a valid PCM/RF64-style WAV container'] };
  }

  const buffer = fs.readFileSync(filePath);
  const riff = buffer.toString('ascii', 0, 4);
  const wave = buffer.toString('ascii', 8, 12);
  if (riff !== 'RIFF' && riff !== 'RF64') errors.push('missing RIFF/RF64 header');
  if (wave !== 'WAVE') errors.push('missing WAVE format marker');

  let offset = 12;
  let hasFmt = false;
  let hasData = false;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) {
      errors.push(`chunk ${chunkId || '<unknown>'} exceeds file length`);
      break;
    }
    if (chunkId === 'fmt ') hasFmt = true;
    if (chunkId === 'data') {
      hasData = true;
      dataBytes += chunkSize;
    }
    offset = chunkEnd + (chunkSize % 2);
  }

  if (!hasFmt) errors.push('missing fmt chunk');
  if (!hasData) errors.push('missing data chunk');
  if (hasData && dataBytes === 0) errors.push('data chunk is empty');

  return { ok: errors.length === 0, size, errors };
}

function normalizeReference(rawReference) {
  return rawReference
    .replace(/[?#].*$/, '')
    .replace(/^\.\//, '');
}

function referenceCandidates(sourceFile, rawReference) {
  const cleanReference = normalizeReference(rawReference);
  if (/^(?:https?:|data:|blob:)/i.test(cleanReference)) return [];

  const candidates = [];
  if (cleanReference.startsWith('/')) {
    candidates.push(path.join(REPO_ROOT, 'public', cleanReference.slice(1)));
    candidates.push(path.join(REPO_ROOT, cleanReference.slice(1)));
  } else {
    candidates.push(path.resolve(path.dirname(sourceFile), cleanReference));
    candidates.push(path.join(REPO_ROOT, cleanReference));
    candidates.push(path.join(REPO_ROOT, 'public', cleanReference));
  }
  return [...new Set(candidates)];
}

const wavAssets = [];
const wavReferences = [];
walk(REPO_ROOT, (filePath) => {
  if (path.extname(filePath).toLowerCase() === '.wav') wavAssets.push(filePath);
  if (!isLikelyText(filePath)) return;

  const text = fs.readFileSync(filePath, 'utf8');
  let match;
  while ((match = WAV_REFERENCE_PATTERN.exec(text))) {
    const rawReference = match[2] || match[3];
    if (rawReference.includes('\\')) continue;
    const line = text.slice(0, match.index).split(/\r?\n/).length;
    const candidates = referenceCandidates(filePath, rawReference);
    const resolved = candidates.find((candidate) => fs.existsSync(candidate));
    wavReferences.push({ filePath, line, rawReference, resolved });
  }
});

const assetResults = wavAssets.map((filePath) => ({ filePath, ...validateWav(filePath) }));
const invalidAssets = assetResults.filter((asset) => !asset.ok);
const missingReferences = wavReferences.filter((reference) => !reference.resolved);

console.log('Audio asset validation');
console.log(`- WAV assets found: ${wavAssets.length}`);
console.log(`- WAV code references found: ${wavReferences.length}`);

for (const asset of assetResults) {
  const status = asset.ok ? 'OK' : 'INVALID';
  const suffix = asset.ok ? '' : ` (${asset.errors.join('; ')})`;
  console.log(`  ${status} ${rel(asset.filePath)} ${asset.size} bytes${suffix}`);
}

for (const reference of wavReferences) {
  const status = reference.resolved ? 'OK' : 'MISSING';
  const target = reference.resolved ? rel(reference.resolved) : 'not found';
  console.log(`  ${status} ${rel(reference.filePath)}:${reference.line} -> ${reference.rawReference} (${target})`);
}

if (invalidAssets.length || missingReferences.length) {
  if (invalidAssets.length) {
    console.error(`Invalid WAV assets: ${invalidAssets.map((asset) => rel(asset.filePath)).join(', ')}`);
  }
  if (missingReferences.length) {
    console.error(`Missing WAV references: ${missingReferences.map((reference) => `${rel(reference.filePath)}:${reference.line}`).join(', ')}`);
  }
  process.exit(1);
}

console.log('Audio asset validation passed.');

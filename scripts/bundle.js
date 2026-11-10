#!/usr/bin/env node
/**
 * WebOrient Single-File Drop-In Bundler (`scripts/bundle.js`)
 * Concatenates all SDK modules (`session-memory.js`, `dom-scanner.js`,
 * `ghost-cursor.js`, `live-client.js`, `weborient.js`) into a single zero-dependency
 * browser bundle `dist/weborient.bundle.js` for 1-tag client installation.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sdkDir = path.join(rootDir, 'src', 'sdk');
const distDir = path.join(rootDir, 'dist');

const filesInOrder = [
  'session-memory.js',
  'dom-scanner.js',
  'ghost-cursor.js',
  'live-client.js',
  'weborient.js'
];

let combined = `/**
 * WebOrient Drop-In Single-File Bundle (v0.4.0)
 * Generated automatically by scripts/bundle.js
 * Includes: SessionMemory (Non-Linear To-Do + Refresh-Safe), DOMScanner (Transcript-to-DOM Auto-Match),
 * GhostCursor, LiveClient, WebOrient
 */\n(function(window) {\n'use strict';\n`;

for (const file of filesInOrder) {
  const filePath = path.join(sdkDir, file);
  let code = fs.readFileSync(filePath, 'utf8');
  code = code
    .replace(/^\s*import\s+.*?from\s+['"].*?['"];?\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/\bexport\s+(class|const|function)\b/g, '$1');
  combined += `\n// --- MODULE: ${file} ---\n` + code + '\n';
}

combined += `\nwindow.WebOrient = WebOrient;\nwindow.SUPPORTED_LANGUAGES = SUPPORTED_LANGUAGES;\n})(window);\n`;

fs.mkdirSync(distDir, { recursive: true });
const outFile = path.join(distDir, 'weborient.bundle.js');
fs.writeFileSync(outFile, combined, 'utf8');
console.log(`[BUNDLER] Built single-file drop-in bundle: ${outFile} (${(combined.length / 1024).toFixed(1)} KB)`);

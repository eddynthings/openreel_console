/**
 * rebuild-project.mjs
 *
 * Interactive script that loads a saved project into OpenReel,
 * relinks all media files, and force-saves so the state persists
 * across browser refreshes.
 *
 * Run: node rebuild-project.mjs
 */

import { openreel } from '../sdk/openreel-sdk.mjs';
import { resolve } from 'path';
import { existsSync, statSync } from 'fs';
import { createInterface } from 'readline';

// ── Prompt helper ─────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function hr() {
  console.log('─'.repeat(56));
}

// ── Validation helpers ────────────────────────────────────────────────────────

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

async function askFile(prompt, required = true) {
  while (true) {
    const input = await ask(prompt);
    if (!input && !required) return null;
    const full = resolve(input);
    if (isFile(full)) return full;
    console.log(`  ✗ Not found or not a file: ${full}`);
    console.log('  Please try again.\n');
  }
}

async function askDir(prompt, required = true) {
  while (true) {
    const input = await ask(prompt);
    if (!input && !required) return null;
    const full = resolve(input);
    if (isDir(full)) return full;
    console.log(`  ✗ Not found or not a directory: ${full}`);
    console.log('  Please try again.\n');
  }
}

async function askYesNo(prompt) {
  while (true) {
    const input = (await ask(prompt)).toLowerCase();
    if (['y', 'yes'].includes(input)) return true;
    if (['n', 'no', ''].includes(input)) return false;
    console.log('  Please answer y or n.\n');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n');
hr();
console.log('  OpenReel Console — Project Rebuild');
console.log('  Loads your project and relinks all media files.');
hr();
console.log(`
  Before you start, make sure:
  • OpenReel is open in your browser
  • The Vite dev server is running (pnpm dev)
  • You see "[OpenReel Console] Connected" in the browser console
`);

// ── Question 1: Project JSON ──────────────────────────────────────────────────

hr();
console.log('\n  STEP 1 — Project file\n');
console.log('  This is the .json file you saved from OpenReel.');
console.log('  Example: /Users/you/projects/my-video/my-project.json\n');

const PROJECT = await askFile('  Path to your project JSON: ');
console.log(`  ✓ Found: ${PROJECT}\n`);

// ── Question 2: Asset directory ───────────────────────────────────────────────

hr();
console.log('\n  STEP 2 — Media files directory\n');
console.log('  The folder containing your video and audio files.');
console.log('  The script scans all subfolders automatically.');
console.log('  Example: /Users/you/Desktop/Recordings\n');

const ASSET_DIR = await askDir('  Path to your media files: ');
console.log(`  ✓ Found: ${ASSET_DIR}\n`);

// ── Question 3: Proxy directory (optional) ────────────────────────────────────

hr();
console.log('\n  STEP 3 — Proxy videos (optional)\n');
console.log('  Proxies are smaller versions of your videos (960x540)');
console.log('  that make editing smoother in the browser.');
console.log('  Generate them first with: ./generate-proxies.sh\n');

const useProxies = await askYesNo('  Do you have proxy videos? (y/N): ');
let PROXY_DIR = null;

if (useProxies) {
  console.log();
  PROXY_DIR = await askDir('  Path to your proxy videos: ');
  console.log(`  ✓ Found: ${PROXY_DIR}\n`);
} else {
  console.log('  Skipping — full-res files will be used.\n');
}

// ── Confirmation ──────────────────────────────────────────────────────────────

hr();
console.log('\n  Ready to rebuild with these settings:\n');
console.log(`  Project file : ${PROJECT}`);
console.log(`  Media files  : ${ASSET_DIR}`);
console.log(`  Proxy videos : ${PROXY_DIR ?? 'none (using full-res)'}`);
console.log();

const confirmed = await askYesNo('  Start rebuild? (Y/n): ');
rl.close();

if (!confirmed) {
  console.log('\n  Cancelled.\n');
  process.exit(0);
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log();
hr();
console.log('\n  STEP 4 — Loading project\n');

await openreel.loadProjectFile(PROJECT);
const state = await openreel.getState();
console.log(`  Loaded: "${state.name}"`);
console.log(`  Tracks: ${state.trackCount}  |  Media items: ${state.mediaCount}\n`);
state.tracks.forEach((t, i) => console.log(`    [${i}] ${t.name} (${t.type}) — ${t.clipCount} clips`));

console.log();
hr();
console.log('\n  STEP 5 — Relinking media files\n');

const result = await openreel.relink(ASSET_DIR, {
  proxyDir: PROXY_DIR,
  onProgress: (done, total, name) =>
    process.stdout.write(`\r  ${done}/${total} — ${name.slice(0, 45).padEnd(45)}`),
});

console.log(`\n\n  Linked: ${result.linked}  |  Failed: ${result.failed}`);

if (result.errors?.length) {
  console.log('\n  Files that could not be linked:');
  result.errors.forEach(e => console.warn(`    ✗ ${e.name} — ${e.error}`));
}

console.log();
hr();
console.log('\n  STEP 6 — Saving state\n');

const saved = await openreel.forceSave();
console.log(`  Saved: "${saved.name}"`);
console.log('  Your project will now survive browser refreshes.');
console.log('  If you refresh, click "Recover" in the dialog.\n');

hr();
console.log('\n  All done! Your project is ready in OpenReel.\n');
hr();
console.log();

await openreel.disconnect();

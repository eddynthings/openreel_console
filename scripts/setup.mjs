/**
 * setup.mjs
 *
 * First-time setup wizard for OpenReel Console.
 * Connects your project to OpenReel and links all your media files.
 *
 * Run: node setup.mjs
 */

import { openreel } from '../sdk/openreel-sdk.mjs';
import { resolve, dirname, join, basename } from 'path';
import { statSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { createInterface } from 'readline';
import { homedir } from 'os';

// ── Prompt helpers ────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));
const hr  = () => console.log('─'.repeat(56));

async function askYesNo(prompt) {
  while (true) {
    const input = (await ask(prompt)).toLowerCase();
    if (['y', 'yes'].includes(input)) return true;
    if (['n', 'no', ''].includes(input)) return false;
    console.log('  Please answer y or n.\n');
  }
}

async function askChoice(prompt, count) {
  while (true) {
    const input = await ask(prompt);
    const n = parseInt(input, 10);
    if (n >= 1 && n <= count) return n;
    console.log(`  Please enter a number between 1 and ${count}.\n`);
  }
}

// ── Filesystem helpers ────────────────────────────────────────────────────────

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir  = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

function findJsonProjects(roots, maxDepth = 3) {
  const found = [];
  const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4a', '.mp3', '.wav']);

  function scan(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full, depth + 1);
      } else if (entry.name.endsWith('.json')) {
        try {
          const raw = JSON.parse(require('fs').readFileSync(full, 'utf8'));
          const proj = raw.project ?? raw;
          if (proj.timeline && proj.mediaLibrary && proj.name) {
            found.push({ path: full, name: proj.name, mediaCount: proj.mediaLibrary.items?.length ?? 0 });
          }
        } catch { /* not a project JSON */ }
      }
    }
  }

  for (const root of roots) {
    if (isDir(root)) scan(root, 0);
  }
  return found;
}

function findMediaDirs(roots) {
  const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4a', '.mp3', '.wav', '.aac']);
  const found = [];

  function hasMedia(dir) {
    try {
      return readdirSync(dir).some(f => VIDEO_EXTS.has(f.slice(f.lastIndexOf('.')).toLowerCase()));
    } catch { return false; }
  }

  function scan(dir, depth) {
    if (depth > 2) return;
    if (hasMedia(dir)) found.push(dir);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) scan(join(dir, entry.name), depth + 1);
    }
  }

  for (const root of roots) {
    if (isDir(root)) scan(root, 0);
  }

  // Deduplicate
  return [...new Set(found)];
}

// ── Bridge check ──────────────────────────────────────────────────────────────

async function checkBridge() {
  try {
    await Promise.race([
      openreel.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const HOME = homedir();

console.log('\n');
hr();
console.log('  OpenReel Console — Setup');
console.log('  Connect your project and media files to OpenReel.');
hr();

// ── Bridge connection check ───────────────────────────────────────────────────

console.log('\n  Checking connection to OpenReel...\n');

const connected = await checkBridge();

if (!connected) {
  hr();
  console.log('\n  OpenReel is not running or the bridge is not installed.\n');
  console.log('  To get set up:\n');
  console.log('  1. Install the bridge (if you haven\'t yet):');
  console.log('       Run install.sh from the openreel_console folder\n');
  console.log('  2. Start OpenReel:');
  console.log('       cd <your-openreel-folder>');
  console.log('       pnpm dev\n');
  console.log('  3. Open OpenReel in your browser');
  console.log('       (Vite will print the URL when it starts)\n');
  console.log('  4. Look for this message in your browser console:');
  console.log('       [OpenReel Console] Connected — ready for commands\n');
  console.log('  5. Then run this script again.\n');
  hr();
  console.log();
  rl.close();
  process.exit(1);
}

console.log('  ✓ OpenReel is connected and ready.\n');

// ── STEP 1: Find project JSON ─────────────────────────────────────────────────

hr();
console.log('\n  STEP 1 — Your project file\n');
console.log('  Scanning for OpenReel project files...\n');

const SCAN_ROOTS = [
  process.cwd(),
  HOME,
  join(HOME, 'Desktop'),
  join(HOME, 'Documents'),
  join(HOME, 'Projects'),
  join(HOME, 'Developer'),
];

// Use sync readFileSync for the scan (dynamic import workaround)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const foundProjects = findJsonProjects(SCAN_ROOTS);

let PROJECT;

if (foundProjects.length === 0) {
  console.log('  No project files found automatically.\n');
  console.log('  Please drag your project .json file into this window,');
  console.log('  or type the full path to it.\n');
  while (true) {
    const input = await ask('  Path to your project JSON: ');
    const full = resolve(input.replace(/^['"]|['"]$/g, ''));
    if (isFile(full)) { PROJECT = full; break; }
    console.log(`  ✗ Not found: ${full}`);
    console.log('  Please try again.\n');
  }
} else {
  console.log(`  Found ${foundProjects.length} project file${foundProjects.length > 1 ? 's' : ''}:\n`);
  foundProjects.forEach((p, i) =>
    console.log(`  ${i + 1}. ${p.name}  (${p.mediaCount} media items)\n     ${p.path}`));

  if (foundProjects.length > 1) {
    console.log();
    const choice = await askChoice('  Which project? Enter a number: ', foundProjects.length);
    PROJECT = foundProjects[choice - 1].path;
  } else {
    const use = await askYesNo(`\n  Use "${foundProjects[0].name}"? (Y/n): `);
    PROJECT = use ? foundProjects[0].path : null;

    if (!PROJECT) {
      console.log('\n  Please drag your project .json file into this window,');
      console.log('  or type the full path to it.\n');
      while (true) {
        const input = await ask('  Path to your project JSON: ');
        const full = resolve(input.replace(/^['"]|['"]$/g, ''));
        if (isFile(full)) { PROJECT = full; break; }
        console.log(`  ✗ Not found: ${full}`);
        console.log('  Please try again.\n');
      }
    }
  }
}

console.log(`\n  ✓ Using: ${basename(PROJECT)}\n`);

// ── STEP 2: Media folder ──────────────────────────────────────────────────────

hr();
console.log('\n  STEP 2 — Media files\n');
console.log('  Do you want me to create a media folder for you,');
console.log('  or do you have one you can point me to?');
console.log('  (Leave blank to create a folder for you)\n');

const mediaInput = await ask('  Path to your media folder, or press Enter: ');

let ASSET_DIR;

if (!mediaInput) {
  ASSET_DIR = join(dirname(PROJECT), 'media');
  if (!existsSync(ASSET_DIR)) {
    mkdirSync(ASSET_DIR, { recursive: true });
    console.log(`\n  ✓ Created media folder: ${ASSET_DIR}`);
    console.log('  Add your video and audio files there, then come back.\n');
    await ask('  Press Enter when your files are ready...');
  } else {
    console.log(`\n  ✓ Using existing folder: ${ASSET_DIR}\n`);
  }
} else {
  const full = resolve(mediaInput.replace(/^['"]|['"]$/g, ''));
  if (isDir(full)) {
    ASSET_DIR = full;
    console.log(`\n  ✓ Found: ${ASSET_DIR}\n`);
  } else {
    console.log(`\n  ✗ Not found: ${full}`);
    console.log('  Creating a media folder for you instead.\n');
    ASSET_DIR = join(dirname(PROJECT), 'media');
    mkdirSync(ASSET_DIR, { recursive: true });
    console.log(`  ✓ Created: ${ASSET_DIR}`);
    console.log('  Add your video and audio files there, then come back.\n');
    await ask('  Press Enter when your files are ready...');
  }
}

// ── STEP 3: Proxy videos (optional) ──────────────────────────────────────────

hr();
console.log('\n  STEP 3 — Proxy videos (optional)\n');
console.log('  Proxies are smaller versions of your videos that make');
console.log('  editing smoother in the browser. You can generate them');
console.log('  with generate-proxies.sh after this setup.\n');

const useProxies = await askYesNo('  Do you already have proxy videos? (y/N): ');
let PROXY_DIR = null;

if (useProxies) {
  console.log();
  while (true) {
    const input = await ask('  Path to your proxy folder: ');
    const full = resolve(input.replace(/^['"]|['"]$/g, ''));
    if (isDir(full)) { PROXY_DIR = full; break; }
    console.log(`  ✗ Not found: ${full}`);
    console.log('  Please try again.\n');
  }
  console.log(`\n  ✓ Found: ${PROXY_DIR}\n`);
} else {
  console.log('  No problem — full resolution files will be used.\n');
}

// ── Confirmation ──────────────────────────────────────────────────────────────

hr();
console.log('\n  Ready to connect your project:\n');
console.log(`  Project file : ${basename(PROJECT)}`);
console.log(`  Media folder : ${ASSET_DIR}`);
console.log(`  Proxy videos : ${PROXY_DIR ?? 'none'}`);
console.log();

const confirmed = await askYesNo('  Connect everything now? (Y/n): ');
rl.close();

if (!confirmed) {
  console.log('\n  Cancelled. Run setup.mjs again whenever you\'re ready.\n');
  process.exit(0);
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log();
hr();
console.log('\n  Loading your project into OpenReel...\n');

await openreel.loadProjectFile(PROJECT);
const state = await openreel.getState();
console.log(`  ✓ "${state.name}" — ${state.trackCount} tracks, ${state.mediaCount} media items\n`);
state.tracks.forEach((t, i) => console.log(`    [${i}] ${t.name} (${t.type}) — ${t.clipCount} clips`));

console.log();
hr();
console.log('\n  Linking your media files...\n');

const result = await openreel.relink(ASSET_DIR, {
  proxyDir: PROXY_DIR,
  onProgress: (done, total, name) =>
    process.stdout.write(`\r  ${done}/${total} — ${name.slice(0, 45).padEnd(45)}`),
});

console.log(`\n\n  ✓ Linked: ${result.linked}  |  Failed: ${result.failed}`);

if (result.errors?.length) {
  console.log('\n  Files that could not be linked:');
  result.errors.forEach(e => console.warn(`    ✗ ${e.name} — ${e.error}`));
}

console.log();
hr();
console.log('\n  Saving your session...\n');

const saved = await openreel.forceSave();
console.log(`  ✓ Saved: "${saved.name}"`);
console.log('  If you refresh the browser, click "Recover" to restore your project.\n');

hr();
console.log('\n  You\'re all set! Your project is live in OpenReel.');
console.log('  Head to your browser to start editing.\n');
hr();
console.log();

await openreel.disconnect();

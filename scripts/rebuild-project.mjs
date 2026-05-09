/**
 * rebuild-project.mjs
 *
 * Loads a saved project JSON into OpenReel, relinks all media files,
 * and force-saves so the state persists across browser refreshes.
 *
 * Usage:
 *   node rebuild-project.mjs <project.json> <asset-dir> [proxy-dir]
 *
 * Arguments:
 *   project.json  Absolute or relative path to the saved project JSON
 *   asset-dir     Absolute path to the directory containing media files
 *   proxy-dir     (optional) Absolute path to proxy videos for smooth playback
 *
 * Examples:
 *   node rebuild-project.mjs ./my-project.json /path/to/assets
 *   node rebuild-project.mjs ./my-project.json /path/to/assets /path/to/proxies
 */

import { openreel } from '../sdk/openreel-sdk.mjs';
import { resolve } from 'path';

const [,, projectArg, assetArg, proxyArg] = process.argv;

if (!projectArg || !assetArg) {
  console.error('Usage: node rebuild-project.mjs <project.json> <asset-dir> [proxy-dir]');
  process.exit(1);
}

const PROJECT   = resolve(projectArg);
const ASSET_DIR = resolve(assetArg);
const PROXY_DIR = proxyArg ? resolve(proxyArg) : null;

console.log('\n── Step 1: Load project ─────────────────────────────────');
await openreel.loadProjectFile(PROJECT);
const state = await openreel.getState();
console.log(`Loaded: "${state.name}"  |  ${state.trackCount} tracks  |  ${state.mediaCount} media items`);
state.tracks.forEach((t, i) => console.log(`  [${i}] ${t.name} (${t.type}) — ${t.clipCount} clips`));

console.log('\n── Step 2: Relink all media ─────────────────────────────');
const result = await openreel.relink(ASSET_DIR, {
  proxyDir: PROXY_DIR,
  onProgress: (done, total, name) => process.stdout.write(`\r  ${done}/${total} — ${name}                    `),
});
console.log(`\n\nLinked: ${result.linked}  |  Failed: ${result.failed}`);
if (result.errors?.length) {
  result.errors.forEach(e => console.warn(`  FAILED: ${e.name} — ${e.error}`));
}

console.log('\n── Step 3: Force autosave ───────────────────────────────');
const saved = await openreel.forceSave();
console.log(`Saved: "${saved.name}" (${saved.savedProjectId})`);

console.log('\n── Done ─────────────────────────────────────────────────');
await openreel.disconnect();

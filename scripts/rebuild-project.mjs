import { openreel } from '/Users/edwincarrasquillo/Projects/openreel-video/openreel-sdk.mjs';

const ASSET_DIR  = '/Users/edwincarrasquillo/Projects/remotion/public';
const PROXY_DIR  = '/Users/edwincarrasquillo/Projects/remotion/public/proxies';
const PROJECT    = '/Users/edwincarrasquillo/Projects/openreel-video/enterprise-security-project-live.json';

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

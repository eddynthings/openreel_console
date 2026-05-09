# OpenReel Console — Claude Code Skill

OpenReel Console is a WebSocket bridge that gives Claude Code direct programmatic
control over a live OpenReel browser editor session. Every store action available
in the app is callable from the terminal — track and clip operations, media
import, text clips, subtitles, markers, timeline scrubbing, and asset relinking.

## Prerequisites

- OpenReel running locally with the bridge plugin installed (see README.md / install.sh)
- Vite dev server started (`pnpm dev`) — bridge only runs in dev mode
- Browser open to the OpenReel URL (Vite reports the port on startup)
- `ws` npm package available: `npm install ws`

**If the bridge is not installed yet**, tell the user:
> OpenReel Console is not installed in this project. Run `./install.sh` from
> the openreel_console repo, apply the vite.config.ts and main.tsx patches,
> then restart the Vite dev server and refresh the browser.

## Connecting

```javascript
import { openreel } from './openreel-sdk.mjs';

await openreel.connect();         // connects to ws://localhost:7175
const state = await openreel.getState();
await openreel.disconnect();      // always disconnect when done
```

`connect()` is called automatically on the first command if not already connected.

---

## Command Reference

### Read

```javascript
// Health check + lightweight project summary
const state = await openreel.getState();
// Returns: { projectId, name, duration, trackCount, tracks[], mediaCount }

// Full project object (deep clone from Zustand store)
const project = await openreel.getProject();

// Just the timeline portion
const timeline = await openreel.getTimeline();
```

### Project

```javascript
// Load a full Project object into the editor (replaces current state)
await openreel.loadProject(projectObject);

// Load from a JSON file on disk
// Supports { project: {...} } wrapper and raw Project objects
await openreel.loadProjectFile('/absolute/path/to/project.json');

// Save current project state to disk (strips blobs — safe to commit)
await openreel.saveProject('/absolute/path/to/project.json');

// Create a new blank project
await openreel.createProject('My Video', { width: 1920, height: 1080, fps: 30 });

// Rename the current project
await openreel.renameProject('New Title');

// Change project dimensions or frame rate without recreating
await openreel.updateSettings({ width: 1920, height: 1080, frameRate: 30 });
```

### Tracks

```javascript
// type: "video" | "audio" | "image" | "text" | "graphics"
// position: 0 = top (renders on top of all other tracks)
const result = await openreel.addTrack('video', 0);
// result.actionId contains the new track's ID

await openreel.removeTrack(trackId);

// Move a track to a new index (0 = topmost visual layer)
await openreel.reorderTrack(trackId, newPosition);

await openreel.renameTrack(trackId, 'B-Roll');
await openreel.muteTrack(trackId, true);    // muted = true | false
await openreel.hideTrack(trackId, true);    // hidden = true | false
await openreel.lockTrack(trackId, true);    // locked = true | false
```

**Track layer order:** Index 0 renders ON TOP. Higher indices render behind.
To put B-Roll above the Presenter, B-Roll must be at a lower index (closer to 0).
Use `reorderTrack` to fix layer order without rebuilding the project from scratch.

### Clips

```javascript
// Add a clip from the media library to a track at a given time (seconds)
const result = await openreel.addClip(trackId, mediaId, startTime);

await openreel.removeClip(clipId);
await openreel.duplicateClip(clipId);

// Move a clip to a new start time, optionally to a different track
await openreel.moveClip(clipId, startTime, targetTrackId);

// Trim: inPoint and outPoint are in seconds (relative to the media file)
await openreel.trimClip(clipId, inPoint, outPoint);

// Split a clip at a given time (seconds, absolute timeline position)
await openreel.splitClip(clipId, time);

// Remove clip and close the gap (ripple delete)
await openreel.rippleDeleteClip(clipId);

// Detach audio from a video clip onto its own audio track
await openreel.separateAudio(clipId);

// Set position, scale, rotation, opacity in the canvas
await openreel.updateClipTransform(clipId, {
  position: { x: 0, y: 0 },   // 0,0 = center
  scale: { x: 1, y: 1 },      // 1 = 100%
  rotation: 0,                 // degrees
  opacity: 1,                  // 0–1
});
```

### Media

```javascript
// Import a file from a URL served by the bridge's HTTP asset server.
// Mirrors the UI "Add Media" button — generates thumbnails, waveform, metadata.
// Use registerAssetRoot() first, then build a URL from it.
// Returns: { mediaId } — use this ID in addClip()
const { mediaId } = await openreel.importMediaFromUrl(fileUrl, 'clip.mp4');

// Add a placeholder item (used for project scaffolding before real files are ready)
await openreel.addPlaceholderMedia({
  id: 'placeholder-1',
  name: 'intro.mp4',
  type: 'video',
  isPlaceholder: true,
  sourceFile: { name: 'intro.mp4', size: 0, lastModified: 0 },
});

await openreel.deleteMedia(mediaId);
await openreel.renameMedia(mediaId, 'New Name');
```

### Text

```javascript
// Create a text clip on a text track
// duration defaults to 5 seconds if not provided
const clip = await openreel.createTextClip(textTrackId, startTime, 'Hello World', 5, {
  fontSize: 48,
  color: '#ffffff',
});

// Update the text content of an existing text clip
await openreel.updateTextContent(clipId, 'Updated text');
```

### SRT / Subtitles

```javascript
// Import an SRT string — parses and populates subtitle track
const srtString = `1\n00:00:00,000 --> 00:00:03,000\nHello world\n`;
await openreel.importSRT(srtString);

// Export the current subtitle track as an SRT-formatted string
const srt = await openreel.exportSRT();
```

### Timeline

```javascript
// Seek the playhead to a given time in seconds
await openreel.setPlayhead(30.5);
```

### Auto-save

```javascript
// Force OpenReel's autosave to capture the current state immediately.
// Call this after any programmatic project load so a browser refresh
// shows the recovery dialog with the correct project.
await openreel.forceSave();

// Clear all autosave slots (removes recovery dialog entries)
await openreel.clearAutoSaves();
```

### UI

```javascript
// Show the format picker welcome screen (Vertical / Horizontal / Square)
await openreel.showWelcomeScreen();
```

### Browser Control

```javascript
// Force a full browser page reload
await openreel.reloadBrowser();
```

---

## Asset Relinking

Asset relinking loads real media files from disk into the browser's IndexedDB,
making them playable in the editor. The bridge serves local files via its built-in
HTTP server so the browser can fetch them.

### relink — the one function you need

```javascript
// relink(assetDir, options)
//
// assetDir      — root directory scanned recursively for all files
// proxyDir      — if provided, video items use this dir instead (960x540 proxies)
// placeholdersOnly — only relink items where isPlaceholder === true (default: false)
// onProgress    — (done, total, name) => void

// Full relink after a project load (all items, with proxies for smooth playback)
await openreel.relink('/path/to/assets', { proxyDir: '/path/to/proxies' });

// Initial setup from a seed project (placeholders only)
await openreel.relink('/path/to/assets', {
  proxyDir: '/path/to/proxies',
  placeholdersOnly: true,
});

// Full-res relink before export (no proxies)
await openreel.relink('/path/to/assets');
```

Files are matched by filename only — `sourceFile.folder` is not required and is
ignored if absent. The recursive scan handles any directory structure.

### Low-level primitives

```javascript
// Register a local directory to be served at /assets/<key>/
const baseUrl = await openreel.registerAssetRoot('assets', '/absolute/path/to/dir');
// baseUrl = "http://localhost:7175/assets/assets/"

// Relink a single item by URL
await openreel.relinkMedia(mediaId, fileUrl, 'clip.mp4');
```

---

## Standard Workflows

### Rebuild a project after a browser wipe or fresh session

Use the included script — it loads the saved JSON, relinks all 58 media items,
and force-saves so the next refresh shows the recovery dialog:

```bash
node scripts/rebuild-project.mjs
```

Or inline:

```javascript
import { openreel } from './openreel-sdk.mjs';

await openreel.loadProjectFile('./my-project-live.json');
await openreel.relink('/path/to/assets', { proxyDir: '/path/to/proxies',
  onProgress: (d, t, n) => process.stdout.write(`\r  ${d}/${t} — ${n}`) });
await openreel.forceSave();
await openreel.disconnect();
```

### Save and restore project state

After setting up a project (load + fix tracks + relink), save the live state:

```javascript
await openreel.saveProject('./my-project-live.json');
```

Future restores load in seconds — IndexedDB already has the blobs keyed by the
same media IDs, so no relinking is needed:

```javascript
await openreel.loadProjectFile('./my-project-live.json');
await openreel.forceSave();  // so refresh shows recovery dialog
```

**On browser refresh:** OpenReel's recovery dialog will appear.
- Click **Recover** → full state with blobs restored from IndexedDB.
- Dismissed by mistake → run `loadProjectFile` + `forceSave` from the terminal.

### Fix track layer order

`reorderTrack` calls the store directly — no need to rebuild the project:

```javascript
const state = await openreel.getState();
const broll = state.tracks.find(t => t.name === 'B-Roll');
await openreel.reorderTrack(broll.id, 0);  // 0 = top layer
```

### Proxy editing workflow (smooth browser playback)

OpenReel composites multiple video tracks in real time. Full-res 1080p files
cause choppy playback. Use 960x540 proxies for editing.

```bash
# Generate proxies
./generate-proxies.sh /path/to/assets /path/to/proxies
```

```javascript
await openreel.loadProjectFile('./project.json');
await openreel.relink('/path/to/assets', { proxyDir: '/path/to/proxies' });
await openreel.forceSave();
```

When ready to export (swap back to full-res):

```javascript
await openreel.loadProjectFile('./project.json');
await openreel.relink('/path/to/assets');  // no proxyDir = full-res
await openreel.forceSave();
```

### Separate audio from presenter clips

```javascript
const project = await openreel.getProject();
const presenterTrack = project.timeline.tracks.find(t => t.name === 'Presenter');

for (const clip of presenterTrack.clips) {
  await openreel.separateAudio(clip.id);
}
```

### Add text overlays

```javascript
const state = await openreel.getState();
let textTrackId = state.tracks.find(t => t.type === 'text')?.id;

if (!textTrackId) {
  const r = await openreel.addTrack('text', 0);
  textTrackId = r.actionId;
}

const chapters = [
  { time: 0,  text: 'Introduction', duration: 5 },
  { time: 30, text: 'The Problem',  duration: 8 },
  { time: 90, text: 'The Solution', duration: 8 },
];

for (const ch of chapters) {
  await openreel.createTextClip(textTrackId, ch.time, ch.text, ch.duration);
}
```

### SRT import from file

```javascript
import { readFile } from 'fs/promises';

const srtContent = await readFile('./subtitles.srt', 'utf8');
await openreel.importSRT(srtContent);
```

---

## Important Notes

### Bridge only works in dev mode

`initDevBridge()` returns immediately if `import.meta.env.DEV` is false.
Do not ship this to production — Vite's tree-shaker will remove it.

### Why import.meta.hot.decline()

`dev-bridge.ts` calls `import.meta.hot.decline()` to opt out of React Fast Refresh
partial updates. Without it, HMR remounts components but never re-executes
`initDevBridge()`. The `decline()` forces a full page reload on file changes so
the bridge always runs fresh code.

If a new command returns "Unknown command", the browser has stale code.
Call `await openreel.reloadBrowser()`, wait ~5 seconds, then retry.

### forceSave is required after every programmatic load

`store.loadProject()` does not mark the project as dirty, so OpenReel's 30-second
autosave timer never fires after a bridge load. Always call `forceSave()` at the
end of a setup script — otherwise a browser refresh starts a blank project.

### Track index vs visual layer

Track index 0 is the topmost visual layer. A clip on track 0 covers clips on
track 1. For B-Roll / Presenter: B-Roll at index 0, Presenter at index 1.

### Proxy file naming

`generate-proxies.sh` outputs `.mp4` for all video regardless of source extension.
`relink()` accounts for this by remapping the extension to `.mp4` when building
proxy URLs. Do not rename proxy files.

### Large file timeouts

`importMediaFromUrl()` has a 60-second timeout. For files over ~500MB, pass a
custom timeout: `openreel.call('importMedia', {...}, 120_000)`.
`relinkMedia()` has a 30-second timeout per file.

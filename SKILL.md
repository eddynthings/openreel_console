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

// Create a new blank project
await openreel.createProject('My Video', { width: 1920, height: 1080, fps: 30 });
```

### Tracks

```javascript
// type: "video" | "audio" | "image" | "text" | "graphics"
// position: 0 = top (renders on top of all other tracks)
const result = await openreel.addTrack('video', 0);
// result.actionId contains the new track's ID

await openreel.removeTrack(trackId);
await openreel.renameTrack(trackId, 'B-Roll');
await openreel.muteTrack(trackId, true);    // muted = true | false
await openreel.hideTrack(trackId, true);    // hidden = true | false
await openreel.lockTrack(trackId, true);    // locked = true | false
```

**Track layer order:** Index 0 renders ON TOP. Higher indices render behind.
To put B-Roll above the Presenter, B-Roll must be at a lower index (closer to 0)
than the Presenter track.

### Clips

```javascript
// Add a clip from the media library to a track at a given time (seconds)
const result = await openreel.addClip(trackId, mediaId, startTime);

await openreel.removeClip(clipId);

// Move a clip to a new start time, optionally to a different track
await openreel.moveClip(clipId, startTime, targetTrackId);

// Trim: inPoint and outPoint are in seconds (relative to the media file)
await openreel.trimClip(clipId, inPoint, outPoint);

// Split a clip at a given time (seconds, absolute timeline position)
await openreel.splitClip(clipId, time);

// Remove clip and close the gap (ripple delete)
await openreel.rippleDeleteClip(clipId);
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
  sourceFile: { name: 'intro.mp4', folder: 'assets/recordings/', size: 0, lastModified: 0 },
});

await openreel.deleteMedia(mediaId);
await openreel.renameMedia(mediaId, 'New Name');
```

### Text

```javascript
// Create a text clip on a text track
// duration defaults to 5 seconds if not provided
// style: Partial<TextStyle> for font, size, color, position, etc.
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

### Browser Control

```javascript
// Force a full browser page reload (e.g., after updating bridge code)
await openreel.reloadBrowser();
```

---

## Asset Relinking

Asset relinking resolves placeholder media items (items with `isPlaceholder: true`)
to real files on disk. The bridge serves local files via its built-in HTTP server
so the browser can fetch them.

```javascript
// Register a local directory to be served at /assets/<key>/
const baseUrl = await openreel.registerAssetRoot('assets', '/absolute/path/to/dir');
// baseUrl = "http://localhost:7175/assets/assets/"

// List all registered roots
const roots = await openreel.call('listAssetRoots');

// Relink a single placeholder to a file
await openreel.relinkMedia(mediaId, fileUrl, 'clip.mp4');

// Relink ALL placeholders from one directory (uses sourceFile.folder + sourceFile.name)
await openreel.relinkAll('/path/to/assets');

// Relink for editing — video → proxy (960x540), audio → full-res (single pass)
await openreel.relinkForEditing('/path/to/assets', '/path/to/proxies');
```

---

## Workflows

### Save and Restore Project State

After the first full setup (load + fix tracks + relink), save the live state:

```javascript
await openreel.saveProject('./my-project-live.json');
```

This writes the current project (correct track order, real media IDs, no blobs) to disk.
Future restores load instantly — IndexedDB already has the blobs keyed by the same IDs:

```javascript
// Seconds, no relinking needed
await openreel.loadProjectFile('./my-project-live.json');
```

**On browser refresh:** OpenReel shows a recovery dialog (standard behavior).
- Click **Recover** → loads from IndexedDB, fully linked, done.
- Clicked **New Project** by mistake → run `loadProjectFile('./my-project-live.json')`.
- After editing in the UI → run `saveProject('./my-project-live.json')` to persist changes.

Keep `enterprise-security-project.json` (or your original) as the source-of-truth
with placeholders. Use the `-live.json` file as your working copy.

---

### Load and Verify a Project

```javascript
import { openreel } from './openreel-sdk.mjs';

await openreel.loadProjectFile('./my-project.json');
const state = await openreel.getState();
console.log(`Loaded: ${state.name} | ${state.duration}s | ${state.mediaCount} media items`);
state.tracks.forEach((t, i) => console.log(`  [${i}] ${t.name} — ${t.clipCount} clips`));

await openreel.disconnect();
```

### Fix Track Layer Order (B-Roll on Top)

Tracks render with lower indices on top. To put B-Roll above Presenter:

```javascript
const project = await openreel.getProject();
const tracks = project.timeline.tracks;

const presIdx  = tracks.findIndex(t => t.name === 'Presenter' && t.type === 'video');
const brollIdx = tracks.findIndex(t => t.name === 'B-Roll'    && t.type === 'video');

const newTracks = [...tracks];
[newTracks[presIdx], newTracks[brollIdx]] = [newTracks[brollIdx], newTracks[presIdx]];

await openreel.loadProject({ ...project, timeline: { ...project.timeline, tracks: newTracks } });
```

### Proxy Editing Workflow (Smooth Browser Playback)

OpenReel composites multiple video tracks in real time using Canvas. Full-resolution
1080p files can cause choppy playback. Use 960x540 proxies for editing.

**Step 1 — Generate proxies:**
```bash
./generate-proxies.sh /path/to/assets /path/to/proxies
```

**Step 2 — Load project and relink for editing:**
```javascript
await openreel.loadProjectFile('./project.json');
// Fix track order if needed (see above)
await openreel.relinkForEditing('/path/to/assets', '/path/to/proxies');
// Video → 960x540 proxies | Audio → full-res
```

**Step 3 — When ready to export (full-res swap):**
```javascript
await openreel.loadProjectFile('./project.json');   // reload from source
await openreel.relinkAll('/path/to/assets');         // all files → full-res
```

### Full Project Setup from Scratch (with Placeholders)

This pattern builds a project programmatically before real media files exist,
then links the real files when they're ready.

```javascript
// 1. Create the project
await openreel.createProject('My Video', { width: 1920, height: 1080, fps: 30 });

// 2. Add tracks (index 0 = top layer)
const brollTrack  = await openreel.addTrack('video', 0);  // on top
const presTrack   = await openreel.addTrack('video', 1);  // behind b-roll
const audioTrack  = await openreel.addTrack('audio', 2);

// 3. Add placeholder media
await openreel.addPlaceholderMedia({
  id: 'intro-placeholder',
  name: 'intro.mp4',
  type: 'video',
  isPlaceholder: true,
  sourceFile: { name: 'intro.mp4', folder: 'assets/recordings/', size: 0, lastModified: 0 },
});

// 4. Add clips using placeholder IDs
await openreel.addClip(presTrack.actionId, 'intro-placeholder', 0);

// 5. Later: relink when files are ready
await openreel.relinkAll('/path/to/assets');
```

### Import Real Media and Add to Timeline

```javascript
const baseUrl = await openreel.registerAssetRoot('vo', '/path/to/voiceover');
const { mediaId } = await openreel.importMediaFromUrl(
  `${baseUrl}narration.mp3`,
  'narration.mp3',
);

const state = await openreel.getState();
const audioTrackId = state.tracks.find(t => t.type === 'audio')?.id;

await openreel.addClip(audioTrackId, mediaId, 0);
```

### Add Text Overlays

```javascript
const state = await openreel.getState();
let textTrackId = state.tracks.find(t => t.type === 'text')?.id;

// Create a text track if one doesn't exist
if (!textTrackId) {
  const r = await openreel.addTrack('text', 0);  // at top
  textTrackId = r.actionId;
}

// Add chapter markers as text clips
const chapters = [
  { time: 0,   text: 'Introduction',  duration: 5 },
  { time: 30,  text: 'The Problem',   duration: 8 },
  { time: 90,  text: 'The Solution',  duration: 8 },
];

for (const ch of chapters) {
  await openreel.createTextClip(textTrackId, ch.time, ch.text, ch.duration);
}
```

### SRT Import from File

```javascript
import { readFile } from 'fs/promises';

const srtContent = await readFile('./subtitles.srt', 'utf8');
await openreel.importSRT(srtContent);
```

---

## Important Notes

### Bridge Only Works in Dev Mode

`initDevBridge()` returns immediately if `import.meta.env.DEV` is false. The bridge
is active only during `pnpm dev`. Do not ship this to production — Vite's tree-shaker
will remove it, but the correct practice is to keep the bridge calls in dev-only scripts.

### Why import.meta.hot.decline()

`dev-bridge.ts` calls `import.meta.hot.decline()` to opt out of React Fast Refresh
partial updates. Without it, Vite's HMR remounts components but never re-executes
`initDevBridge()`, leaving the WebSocket handler bound to the old (pre-edit) module.
The `decline()` forces a full page reload whenever this file changes, so the bridge
always runs the freshest code.

If you ever add a command and it returns "Unknown command", it means the browser
is running stale code. Call `await openreel.reloadBrowser()`, wait 5 seconds,
reload the project, and retry.

### Track Index vs Visual Layer

Track index 0 is the topmost visual layer. When a video clip is on track 0 and
another is on track 1, the track 0 clip covers track 1. For a B-Roll / Presenter
setup: put B-Roll at index 0 so B-Roll covers the presenter when a clip is present,
and the presenter shows through where no B-Roll exists.

### Proxy File Naming

`generate-proxies.sh` outputs `.mp4` for all video, regardless of source extension.
`relinkForEditing()` accounts for this by remapping the extension to `.mp4` when
building proxy URLs. Do not rename proxy files — the SDK expects this convention.

### Large File Timeouts

`importMediaFromUrl()` has a 60-second timeout. For files over ~500MB on a slow
disk, increase the timeout by calling `openreel.call('importMedia', {...}, 120_000)`.
`relinkMedia()` has a 30-second timeout per file. For very large files, call it
directly with a custom timeout.

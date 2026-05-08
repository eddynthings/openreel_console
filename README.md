# OpenReel Console

A Claude Code skill that gives your terminal direct programmatic control over the
[OpenReel](https://openreel.com) browser-based video editor. Load projects, arrange
clips, import media, add text, relink assets, and switch between editing proxies
and full-resolution files — all from Claude Code or a Node.js script.

---

> **OpenReel must be installed.** This skill integrates with a locally running
> OpenReel instance. If you don't have it yet, visit [openreel.com](https://openreel.com).

---

## Why This Beats the Built-in AI Integration

OpenReel ships with native AI tools that connect directly to Anthropic, OpenAI,
and ElevenLabs. Those are useful for individual features inside the editor UI —
but they can only do what OpenReel built into each panel.

OpenReel Console is different. Instead of talking to an AI from inside the app,
it opens the entire Zustand store to Claude Code running in your terminal. That
means Claude has access to everything: every track, every clip, every media item,
every marker, the full timeline state. It can read it, modify it, and react to it.

Here's what that unlocks that the native integration can't do:

**Full automation across the whole timeline.** Claude can load a project, inspect
every clip, rearrange tracks, trim clips by timestamp, split on cue points, and
re-order b-roll — in a single script. The native AI works on one feature at a time.

**Multi-tool workflows in a single session.** Claude Code has access to the file
system, the internet, and every Claude Code skill you've installed. A single session
can pull b-roll from Pexels, generate a voiceover via ElevenLabs, import both into
OpenReel, add them to the timeline at the right positions, and drop in text overlays
— without you touching the mouse.

**Composable Claude Code skills.** Because OpenReel is now just another API from
Claude's perspective, you can write skills that treat it the same way you'd treat
Remotion or any other tool. Describe the edit you want and Claude handles the
sequence of store calls. The native AI can't be scripted this way.

**Proxy workflow for smooth editing.** OpenReel composites multiple video tracks
in real time in the browser. Full-resolution 1080p files can be choppy on complex
timelines. This skill includes a proxy generator that creates 960x540 editing copies
and a one-call SDK method to swap between proxy and full-res. The native integration
has no equivalent.

**Version-controlled automation.** Your edit workflows become `.mjs` scripts you
can save, run again, share with a team, or build into a CI pipeline. The native
integration produces no artifacts.

---

## Architecture

```
Your terminal (Claude Code / Node.js)
        │
        │  WebSocket  ws://localhost:7175
        ▼
vite-plugin-bridge.ts   ← Vite plugin (Node.js, WS + HTTP server)
        │
        │  WebSocket relay + HTTP file server
        ▼
dev-bridge.ts           ← Browser client (connects on page load)
        │
        │  Zustand store calls
        ▼
OpenReel editor         ← Live state: tracks, clips, media, timeline
```

The Vite plugin opens a WebSocket server on port 7175. The browser client
(`dev-bridge.ts`) connects to it on startup. When you call `openreel.addClip(...)`
from the terminal, the SDK sends a JSON command to the plugin, which relays it to
the browser, which calls the Zustand action directly and sends the result back.

The plugin also runs a local HTTP server on the same port that serves files from
registered directories — this is how `relinkMedia` and `importMediaFromUrl` move
local files into the browser without a file picker.

---

## Prerequisites

- **OpenReel** installed locally ([openreel.com](https://openreel.com))
- **Node.js** >= 18
- **ffmpeg** for proxy generation (`brew install ffmpeg` on macOS)
- **ws** npm package (`npm install ws` or `pnpm add -D ws`)
- The Vite dev server running (`pnpm dev`) — bridge is dev-only

---

## Installation

**1. Clone this repo:**

```bash
git clone git@github.com:eddynthings/openreel_console.git ~/Development/openreel_console
cd ~/Development/openreel_console
```

**2. Run the installer:**

```bash
./install.sh /path/to/your/openreel-project
```

The installer copies the plugin and SDK files into your OpenReel project, installs
the Claude Code skill, and prints the exact code changes you need to make.

**3. Apply the two manual patches** printed by the installer:

In `apps/web/vite.config.ts`:
```typescript
import { openreelBridgePlugin } from "./vite-plugin-bridge";

export default defineConfig({
  plugins: [react(), openreelBridgePlugin()],
  // ...
});
```

In `apps/web/src/main.tsx`:
```typescript
import { initDevBridge } from "./services/dev-bridge";

// before ReactDOM.createRoot:
initDevBridge();
```

**4. Start OpenReel:**

```bash
cd /path/to/your/openreel-project
pnpm dev
```

You should see:
```
🌉 OpenReel Bridge  ws://localhost:7175
```

**5. Open OpenReel in your browser.** The console should show:
```
[OpenReel Console] Connected — ready for commands
```

---

## Quick Start

```javascript
import { openreel } from './openreel-sdk.mjs';

// Check the connection
const state = await openreel.getState();
console.log(state.name, state.duration + 's', state.mediaCount + ' items');

// Load a project from disk
await openreel.loadProjectFile('./my-project.json');

// Inspect tracks
const project = await openreel.getProject();
project.timeline.tracks.forEach((t, i) =>
  console.log(`[${i}] ${t.name} (${t.type}) — ${t.clips.length} clips`)
);

await openreel.disconnect();
```

---

## Proxy Editing Workflow

Browser Canvas compositing of multiple 1080p tracks can be choppy. Use proxies
for editing and swap to full-res before export.

**Generate proxies** (960x540, H.264 ultrafast):
```bash
./generate-proxies.sh /path/to/assets /path/to/proxies
```

**Load project and relink for editing:**
```javascript
await openreel.loadProjectFile('./project.json');
await openreel.relinkForEditing('/path/to/assets', '/path/to/proxies');
// Video → 960x540 proxies, Audio → full-res, all in one pass
```

**Swap back to full-res for export:**
```javascript
await openreel.loadProjectFile('./project.json');  // reload from source
await openreel.relinkAll('/path/to/assets');        // all files full-res
```

---

## SDK Reference

Full command reference and workflow patterns are in [SKILL.md](SKILL.md).
That file is also installed to `~/.claude/skills/openreel/SKILL.md` by `install.sh`,
making it available to Claude Code in every project.

### Highlights

| Method | Description |
|---|---|
| `getState()` | Lightweight project summary |
| `getProject()` | Full project object from the store |
| `loadProjectFile(path)` | Load a project JSON from disk |
| `addTrack(type, position)` | Add a track at a given layer |
| `addClip(trackId, mediaId, time)` | Place a media clip on a track |
| `trimClip(clipId, in, out)` | Trim clip handles |
| `splitClip(clipId, time)` | Split a clip at a point |
| `importMediaFromUrl(url, name)` | Import a file into the media library |
| `relinkAll(assetDir)` | Relink all placeholders to full-res files |
| `relinkForEditing(assetDir, proxyDir)` | Relink for proxy editing |
| `createTextClip(trackId, time, text)` | Add a text overlay |
| `importSRT(srtString)` | Import subtitles from SRT |
| `exportSRT()` | Export subtitle track as SRT |
| `setPlayhead(time)` | Seek to a position |

---

## Repository

[github.com/eddynthings/openreel_console](https://github.com/eddynthings/openreel_console)

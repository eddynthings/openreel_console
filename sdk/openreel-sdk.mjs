/**
 * OpenReel Console SDK
 *
 * Terminal / Claude Code interface to the live OpenReel browser editor.
 * Requires the Vite dev server running with openreelBridgePlugin() active
 * and the browser open at the OpenReel URL.
 *
 * Usage:
 *   import { openreel } from './openreel-sdk.mjs';
 *   await openreel.connect();
 *   const state = await openreel.getState();
 */

import WebSocket from "ws";
import { readFile } from "fs/promises";

const BRIDGE_URL = "ws://localhost:7175";

let _ws = null;
const _pending = new Map();

// ── Connection ────────────────────────────────────────────────────────────────

async function _ensureConnected() {
  if (_ws?.readyState === WebSocket.OPEN) return;
  await connect();
}

function connect(url = BRIDGE_URL) {
  return new Promise((resolve, reject) => {
    _ws = new WebSocket(url);

    _ws.on("open", () => {
      console.log("[OpenReel Console] Connected to bridge at", url);
      resolve(_ws);
    });

    _ws.on("error", (err) => {
      console.error("[OpenReel Console] Connection error:", err.message);
      reject(err);
    });

    _ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id && _pending.has(msg.id)) {
          const { resolve, reject, timer } = _pending.get(msg.id);
          _pending.delete(msg.id);
          clearTimeout(timer);
          if (msg.ok === false) {
            reject(new Error(msg.error ?? "Command failed"));
          } else {
            resolve(msg.result ?? msg);
          }
        }
      } catch {
        // ignore malformed messages
      }
    });

    _ws.on("close", () => {
      console.log("[OpenReel Console] Bridge disconnected");
    });
  });
}

function disconnect() {
  _ws?.close();
  _ws = null;
}

// ── Core call ─────────────────────────────────────────────────────────────────

async function call(command, args, timeoutMs = 10_000) {
  await _ensureConnected();

  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();

    const timer = setTimeout(() => {
      _pending.delete(id);
      reject(new Error(`Timeout (${timeoutMs}ms): browser did not respond to '${command}'`));
    }, timeoutMs);

    _pending.set(id, { resolve, reject, timer });
    _ws.send(JSON.stringify({ id, command, args }));
  });
}

// ── MIME map ──────────────────────────────────────────────────────────────────

const MIME_MAP = {
  ".mp4": "video/mp4",
  ".m4a": "audio/aac",
  ".mp3": "audio/mpeg",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
};

function _mimeFor(fileName) {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

// ── Read ──────────────────────────────────────────────────────────────────────

const getState    = () => call("getState");
const getProject  = () => call("getProject");
const getTimeline = () => call("getTimeline");

// ── Project ───────────────────────────────────────────────────────────────────

const loadProject    = (project)        => call("loadProject", { project });
const createProject  = (name, settings) => call("createNewProject", { name, settings });
const renameProject  = (name)           => call("renameProject", { name });
const updateSettings = (settings)       => call("updateSettings", { settings });

async function saveProject(filePath) {
  const { writeFile } = await import("fs/promises");
  const json = await call("getProjectJson");
  await writeFile(filePath, json, "utf8");
  console.log("[OpenReel Console] Project saved to", filePath);
}

async function loadProjectFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw);
  return loadProject(data.project ?? data);
}

// ── Tracks ────────────────────────────────────────────────────────────────────

const addTrack     = (type, position)         => call("addTrack", { type, position });
const removeTrack  = (trackId)                => call("removeTrack", { trackId });
const reorderTrack = (trackId, position)      => call("reorderTrack", { trackId, position });
const renameTrack  = (trackId, name)          => call("renameTrack", { trackId, name });
const muteTrack    = (trackId, muted = true)  => call("muteTrack", { trackId, muted });
const hideTrack    = (trackId, hidden = true) => call("hideTrack", { trackId, hidden });
const lockTrack    = (trackId, locked = true) => call("lockTrack", { trackId, locked });

// ── Clips ─────────────────────────────────────────────────────────────────────

const addClip           = (trackId, mediaId, startTime)  => call("addClip", { trackId, mediaId, startTime });
const removeClip        = (clipId)                       => call("removeClip", { clipId });
const moveClip          = (clipId, startTime, trackId)   => call("moveClip", { clipId, startTime, trackId });
const trimClip          = (clipId, inPoint, outPoint)    => call("trimClip", { clipId, inPoint, outPoint });
const splitClip         = (clipId, time)                 => call("splitClip", { clipId, time });
const rippleDeleteClip  = (clipId)                       => call("rippleDeleteClip", { clipId });
const duplicateClip     = (clipId)                       => call("duplicateClip", { clipId });
const separateAudio     = (clipId)                       => call("separateAudio", { clipId });
const updateClipTransform  = (clipId, transform)          => call("updateClipTransform", { clipId, transform });
const addVideoEffect       = (clipId, effectType, params) => call("addVideoEffect", { clipId, effectType, params });
const updateClipKeyframes  = (clipId, keyframes)          => call("updateClipKeyframes", { clipId, keyframes });

// ── Media ─────────────────────────────────────────────────────────────────────

const addPlaceholderMedia = (item)           => call("addPlaceholderMedia", { item });
const deleteMedia          = (mediaId)       => call("deleteMedia", { mediaId });
const renameMedia          = (mediaId, name) => call("renameMedia", { mediaId, name });

function importMediaFromUrl(fileUrl, fileName) {
  return call("importMedia", { fileUrl, fileName, mimeType: _mimeFor(fileName) }, 60_000);
}

// ── Markers ───────────────────────────────────────────────────────────────────

const addMarker    = (time, label, color) => call("addMarker", { time, label, color });
const removeMarker = (markerId)           => call("removeMarker", { markerId });

// ── Text ──────────────────────────────────────────────────────────────────────

const createTextClip    = (trackId, startTime, text, duration, style) =>
  call("createTextClip", { trackId, startTime, text, duration, style });
const updateTextContent = (clipId, text) => call("updateTextContent", { clipId, text });

// ── SRT / Subtitles ───────────────────────────────────────────────────────────

const importSRT = (srtContent) => call("importSRT", { srtContent });
const exportSRT = ()           => call("exportSRT");

// ── Timeline ──────────────────────────────────────────────────────────────────

const setPlayhead = (time) => call("setPlayhead", { time });

// ── Auto-save ─────────────────────────────────────────────────────────────────

const forceSave     = () => call("forceSave");
const clearAutoSaves = () => call("clearAutoSaves");

// ── Browser control ───────────────────────────────────────────────────────────

const reloadBrowser      = () => call("reloadBrowser");
const showWelcomeScreen  = () => call("showWelcomeScreen");

// ── Asset relinking ───────────────────────────────────────────────────────────

async function registerAssetRoot(key, dir) {
  const result = await call("registerAssetRoot", { key, dir });
  return result.url ?? `http://localhost:7175/assets/${key}/`;
}

function relinkMedia(mediaId, fileUrl, fileName) {
  return call("relinkMedia", { mediaId, fileUrl, fileName, mimeType: _mimeFor(fileName) }, 30_000);
}

/**
 * Relink media items to files on disk.
 *
 * Scans the provided directories recursively and matches by filename — no
 * reliance on sourceFile.folder, which may be absent after initial relinking.
 *
 * @param {string} assetDir  - Absolute path containing full-res assets (and audio)
 * @param {object} opts
 * @param {string}   [opts.proxyDir]         - If provided, video items use this dir instead of assetDir
 * @param {boolean}  [opts.placeholdersOnly] - Only relink items where isPlaceholder === true (default: false = all items)
 * @param {function} [opts.onProgress]       - (done, total, name) => void
 *
 * @example
 * // Load project fresh from disk, relink everything with proxies
 * await openreel.loadProjectFile('./project-live.json');
 * await openreel.relink('/path/to/assets', { proxyDir: '/path/to/proxies' });
 * await openreel.forceSave();
 *
 * @example
 * // Relink placeholders only (initial setup from seed project)
 * await openreel.relink('/path/to/assets', { proxyDir: '/path/to/proxies', placeholdersOnly: true });
 */
async function relink(assetDir, { proxyDir, placeholdersOnly = false, onProgress } = {}) {
  const { readdirSync, statSync } = await import("fs");
  const path = await import("path");

  function buildIndex(root, dir = root) {
    const index = {};
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        Object.assign(index, buildIndex(root, full));
      } else {
        index[entry] = path.relative(root, full);
      }
    }
    return index;
  }

  const AUDIO_EXTS = new Set([".mp3", ".m4a", ".wav", ".aac", ".flac"]);

  const assetIndex = buildIndex(assetDir);
  const proxyIndex = proxyDir ? buildIndex(proxyDir) : assetIndex;

  const [assetBase, proxyBase] = await Promise.all([
    registerAssetRoot("assets", assetDir),
    proxyDir ? registerAssetRoot("proxies", proxyDir) : Promise.resolve(null),
  ]);
  const resolvedProxyBase = proxyBase ?? assetBase;

  const project = await call("getProject");
  const allItems = (project?.mediaLibrary?.items ?? []).filter((m) => m.sourceFile?.name);
  const items = placeholdersOnly ? allItems.filter((m) => m.isPlaceholder) : allItems;

  if (items.length === 0) {
    console.log(`[OpenReel Console] No${placeholdersOnly ? " placeholder" : ""} media items found.`);
    return { linked: 0, failed: 0, errors: [] };
  }

  let linked = 0, failed = 0;
  const errors = [];

  for (const item of items) {
    const name = item.sourceFile.name;
    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    const isAudio = AUDIO_EXTS.has(ext);

    let fileUrl, fileName;

    if (isAudio) {
      const rel = assetIndex[name];
      if (!rel) {
        errors.push({ id: item.id, name, error: "not found in asset dir" });
        failed++;
        continue;
      }
      fileUrl = `${assetBase}${rel}`;
      fileName = name;
    } else {
      // Proxy files always output as .mp4 (generate-proxies.sh convention)
      const proxyName = name.slice(0, name.lastIndexOf(".")) + ".mp4";
      const rel = proxyIndex[proxyName];
      if (!rel) {
        errors.push({ id: item.id, name, error: `no proxy found for ${proxyName}` });
        failed++;
        continue;
      }
      fileUrl = `${resolvedProxyBase}${rel}`;
      fileName = proxyName;
    }

    onProgress?.(linked + failed + 1, items.length, name);

    try {
      await call("relinkMedia", { mediaId: item.id, fileUrl, fileName, mimeType: _mimeFor(fileName) }, 30_000);
      linked++;
    } catch (e) {
      errors.push({ id: item.id, name, error: e.message });
      failed++;
    }
  }

  if (!onProgress) {
    console.log(`[OpenReel Console] Relink complete: ${linked} linked, ${failed} failed`);
  }
  return { linked, failed, errors };
}

// ── Export ────────────────────────────────────────────────────────────────────

export const openreel = {
  // Connection
  connect,
  disconnect,

  // Read
  getState,
  getProject,
  getTimeline,

  // Project
  loadProject,
  loadProjectFile,
  saveProject,
  createProject,
  renameProject,
  updateSettings,

  // Tracks
  addTrack,
  removeTrack,
  reorderTrack,
  renameTrack,
  muteTrack,
  hideTrack,
  lockTrack,

  // Clips
  addClip,
  removeClip,
  moveClip,
  trimClip,
  splitClip,
  rippleDeleteClip,
  duplicateClip,
  separateAudio,
  updateClipTransform,
  addVideoEffect,
  updateClipKeyframes,

  // Media
  importMediaFromUrl,
  addPlaceholderMedia,
  deleteMedia,
  renameMedia,

  // Markers
  addMarker,
  removeMarker,

  // Text
  createTextClip,
  updateTextContent,

  // SRT / Subtitles
  importSRT,
  exportSRT,

  // Timeline
  setPlayhead,

  // Auto-save
  forceSave,
  clearAutoSaves,

  // UI
  showWelcomeScreen,

  // Browser control
  reloadBrowser,

  // Asset relinking
  registerAssetRoot,
  relinkMedia,
  relink,

  // Low-level escape hatch
  call,
};

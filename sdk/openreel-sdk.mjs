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
      reject(new Error(`[OpenReel Console] Command '${command}' timed out after ${timeoutMs}ms`));
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

const loadProject   = (project)          => call("loadProject", { project });
const createProject = (name, settings)   => call("createNewProject", { name, settings });

/**
 * Save the current project state to a JSON file on disk.
 * Media blobs are stripped (they live in IndexedDB by ID) — the saved file is
 * safe to commit and can be reloaded instantly without relinking.
 *
 * This is the correct source of truth to use after the first full setup.
 * Future calls to loadProjectFile(savedPath) will load in seconds because
 * IndexedDB already has the blobs keyed by the same media IDs.
 *
 * @param {string} filePath - Absolute path to write, e.g. './project-live.json'
 */
async function saveProject(filePath) {
  const { writeFile } = await import("fs/promises");
  const json = await call("getProjectJson");
  await writeFile(filePath, json, "utf8");
  console.log("[OpenReel Console] Project saved to", filePath);
}

/**
 * Load a project from a JSON file on disk.
 * Supports both { project: {...} } wrapper and raw Project objects.
 */
async function loadProjectFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw);
  const project = data.project ?? data;
  return loadProject(project);
}

// ── Tracks ────────────────────────────────────────────────────────────────────

const addTrack    = (type, position)         => call("addTrack", { type, position });
const removeTrack = (trackId)                => call("removeTrack", { trackId });
const renameTrack = (trackId, name)          => call("renameTrack", { trackId, name });
const muteTrack   = (trackId, muted = true)  => call("muteTrack", { trackId, muted });
const hideTrack   = (trackId, hidden = true) => call("hideTrack", { trackId, hidden });
const lockTrack   = (trackId, locked = true) => call("lockTrack", { trackId, locked });

// ── Clips ─────────────────────────────────────────────────────────────────────

const addClip          = (trackId, mediaId, startTime)         => call("addClip", { trackId, mediaId, startTime });
const removeClip       = (clipId)                              => call("removeClip", { clipId });
const moveClip         = (clipId, startTime, trackId)          => call("moveClip", { clipId, startTime, trackId });
const trimClip         = (clipId, inPoint, outPoint)           => call("trimClip", { clipId, inPoint, outPoint });
const splitClip        = (clipId, time)                        => call("splitClip", { clipId, time });
const rippleDeleteClip = (clipId)                              => call("rippleDeleteClip", { clipId });

// ── Media ─────────────────────────────────────────────────────────────────────

const addPlaceholderMedia = (item)          => call("addPlaceholderMedia", { item });
const deleteMedia          = (mediaId)      => call("deleteMedia", { mediaId });
const renameMedia          = (mediaId, name) => call("renameMedia", { mediaId, name });

/**
 * Import a media file from a URL served by the bridge's asset server.
 * Mirrors the UI's "Add Media" button — generates thumbnails, waveform, and metadata.
 * Returns { mediaId } with the new item's UUID.
 *
 * Use registerAssetRoot() first to make your local directory accessible.
 *
 * @param {string} fileUrl  - URL accessible from the browser (e.g. from registerAssetRoot)
 * @param {string} fileName - Filename including extension
 * @returns {Promise<{ mediaId: string }>}
 */
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
const exportSRT = ()            => call("exportSRT");

// ── Timeline ──────────────────────────────────────────────────────────────────

const setPlayhead   = (time) => call("setPlayhead", { time });

// ── Browser control ───────────────────────────────────────────────────────────

const reloadBrowser = () => call("reloadBrowser");

// ── Asset relinking ───────────────────────────────────────────────────────────

/**
 * Register a local directory to be served by the bridge's HTTP asset server.
 * Returns the base URL to use when building file URLs.
 *
 * @param {string} key - Short identifier, e.g. "assets" or "proxies"
 * @param {string} dir - Absolute path on disk, e.g. "/Users/you/project/public"
 * @returns {Promise<string>} Base URL, e.g. "http://localhost:7175/assets/assets/"
 */
async function registerAssetRoot(key, dir) {
  const result = await call("registerAssetRoot", { key, dir });
  return result.url ?? `http://localhost:7175/assets/${key}/`;
}

/**
 * Relink a single placeholder media item to a real file fetched from a local URL.
 * The file must be accessible from the browser — use registerAssetRoot() first.
 *
 * @param {string} mediaId  - ID of the placeholder in the OpenReel media library
 * @param {string} fileUrl  - URL accessible from the browser
 * @param {string} fileName - Filename including extension (used to determine MIME type)
 */
function relinkMedia(mediaId, fileUrl, fileName) {
  return call("relinkMedia", { mediaId, fileUrl, fileName, mimeType: _mimeFor(fileName) }, 30_000);
}

/**
 * Relink all placeholder media items to real files in a single asset directory.
 * Resolves each item's path from its sourceFile.folder + sourceFile.name.
 *
 * The folder map:
 *   "assets/recordings/"      → assetDir/recordings/
 *   "assets/broll/timed/"     → assetDir/broll/timed/
 *   "assets/audio/presenter/" → assetDir/audio/presenter/
 *
 * @param {string} assetDir - Absolute path to the asset root
 * @param {{ onProgress?: (done, total, name) => void }} opts
 */
async function relinkAll(assetDir, { onProgress } = {}) {
  const baseUrl = await registerAssetRoot("assets", assetDir);
  const project = await call("getProject");
  const placeholders = (project?.mediaLibrary?.items ?? []).filter((m) => m.isPlaceholder);

  if (placeholders.length === 0) {
    console.log("[OpenReel Console] No placeholder media items found.");
    return { linked: 0, failed: 0, errors: [] };
  }

  let linked = 0, failed = 0;
  const errors = [];

  for (const item of placeholders) {
    const sf = item.sourceFile;
    if (!sf?.name) {
      failed++;
      errors.push({ id: item.id, name: item.name, error: "No sourceFile.name" });
      continue;
    }

    const relFolder = (sf.folder ?? "").replace(/^assets\//, "");
    const fileUrl = `${baseUrl}${relFolder}${sf.name}`;

    try {
      await relinkMedia(item.id, fileUrl, sf.name);
      linked++;
      if (onProgress) onProgress(linked + failed, placeholders.length, item.name);
      else process.stdout.write(`\r  Linked ${linked + failed}/${placeholders.length}: ${item.name.padEnd(40)}`);
    } catch (e) {
      failed++;
      errors.push({ id: item.id, name: item.name, error: e.message });
      if (onProgress) onProgress(linked + failed, placeholders.length, `FAILED: ${item.name}`);
    }
  }

  if (!onProgress) process.stdout.write("\n");
  return { linked, failed, errors };
}

/**
 * Relink all media in a single pass for the proxy editing workflow:
 * - Video files  → proxyDir (960x540 proxies for smooth browser playback)
 * - Audio files  → assetDir (full-res, no proxy needed)
 *
 * Call this immediately after loading a project (while items are still placeholders
 * and have sourceFile info). Generate proxies first with scripts/generate-proxies.sh.
 *
 * Proxy files must use .mp4 extension (generate-proxies.sh outputs .mp4 for all video).
 *
 * When ready to export: reload the project and call relinkAll(assetDir) for full-res.
 *
 * @param {string} assetDir  - Absolute path to original full-res asset root
 * @param {string} proxyDir  - Absolute path to proxy root (mirrors assetDir structure)
 * @param {{ onProgress?: (done, total, name) => void }} opts
 */
async function relinkForEditing(assetDir, proxyDir, { onProgress } = {}) {
  const [assetBase, proxyBase] = await Promise.all([
    registerAssetRoot("assets", assetDir),
    registerAssetRoot("proxies", proxyDir),
  ]);

  const project = await call("getProject");
  const placeholders = (project?.mediaLibrary?.items ?? []).filter((m) => m.isPlaceholder);

  if (placeholders.length === 0) {
    console.log("[OpenReel Console] No placeholder media items found.");
    return { linked: 0, failed: 0, errors: [] };
  }

  const AUDIO_EXTS = new Set([".mp3", ".m4a", ".wav", ".aac"]);

  let linked = 0, failed = 0;
  const errors = [];

  for (const item of placeholders) {
    const sf = item.sourceFile;
    if (!sf?.name) {
      failed++;
      errors.push({ id: item.id, name: item.name ?? item.id, error: "No sourceFile.name" });
      continue;
    }

    const ext = sf.name.slice(sf.name.lastIndexOf(".")).toLowerCase();
    const isAudio = AUDIO_EXTS.has(ext);
    const relFolder = (sf.folder ?? "").replace(/^assets\//, "");

    let fileName, fileUrl;
    if (isAudio) {
      // Full-res audio — use exact filename
      fileName = sf.name;
      fileUrl = `${assetBase}${relFolder}${fileName}`;
    } else {
      // Proxy video — generate-proxies.sh outputs .mp4 for all video
      fileName = sf.name.replace(/\.[^.]+$/, ".mp4");
      fileUrl = `${proxyBase}${relFolder}${fileName}`;
    }

    try {
      await relinkMedia(item.id, fileUrl, fileName);
      linked++;
      if (onProgress) onProgress(linked + failed, placeholders.length, item.name);
      else process.stdout.write(`\r  ${linked + failed}/${placeholders.length}: ${item.name.padEnd(40)}`);
    } catch (e) {
      failed++;
      errors.push({ id: item.id, name: item.name, error: e.message });
    }
  }

  if (!onProgress) process.stdout.write("\n");
  return { linked, failed, errors };
}

/**
 * @deprecated Use relinkForEditing(assetDir, proxyDir) instead.
 * This function only relinks video items and does not handle audio.
 */
async function relinkAllProxies(proxyDir, { onProgress } = {}) {
  console.warn("[OpenReel Console] relinkAllProxies is deprecated. Use relinkForEditing(assetDir, proxyDir) instead.");
  const baseUrl = await registerAssetRoot("proxies", proxyDir);
  const project = await call("getProject");
  const items = project?.mediaLibrary?.items ?? [];
  const videoItems = items.filter((m) => m.type === "video" || (m.isPlaceholder && !m.sourceFile?.name?.endsWith(".m4a")));

  let linked = 0, failed = 0;
  const errors = [];

  for (const item of videoItems) {
    const sf = item.sourceFile;
    if (!sf?.name) { failed++; continue; }
    const relFolder = (sf.folder ?? "").replace(/^assets\//, "");
    const proxyName = sf.name.replace(/\.[^.]+$/, ".mp4");
    const fileUrl = `${baseUrl}${relFolder}${proxyName}`;
    try {
      await relinkMedia(item.id, fileUrl, proxyName);
      linked++;
      if (onProgress) onProgress(linked + failed, videoItems.length, item.name);
      else process.stdout.write(`\r  Proxied ${linked + failed}/${videoItems.length}: ${item.name.padEnd(40)}`);
    } catch (e) {
      failed++;
      errors.push({ id: item.id, name: item.name, error: e.message });
    }
  }

  if (!onProgress) process.stdout.write("\n");
  return { linked, failed, errors };
}

/**
 * Relink ALL media items (regardless of placeholder status) to files on disk.
 * Use this to repopulate browser IndexedDB after blob loss (e.g. browser cache clear).
 *
 * Videos are linked to proxy files (.mp4), audio to full-res originals.
 * Files are located by scanning the directory tree — sourceFile.folder is not required.
 *
 * @param {string} assetDir  - Absolute path to original full-res asset root
 * @param {string} proxyDir  - Absolute path to proxy root (mirrors assetDir structure)
 * @param {{ onProgress?: (done, total, name) => void }} opts
 */
async function relinkAllMedia(assetDir, proxyDir, { onProgress } = {}) {
  const { readdirSync, statSync } = await import("fs");
  const path = await import("path");

  // Recursively build name → relative-path index for a directory
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
  const MIME = {
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".mp3": "audio/mpeg", ".m4a": "audio/aac", ".wav": "audio/wav", ".aac": "audio/aac",
  };

  const assetIndex = buildIndex(assetDir);
  const proxyIndex = buildIndex(proxyDir);

  const [assetBase, proxyBase] = await Promise.all([
    registerAssetRoot("assets", assetDir),
    registerAssetRoot("proxies", proxyDir),
  ]);

  const project = await call("getProject");
  const items = (project?.mediaLibrary?.items ?? []).filter((m) => m.sourceFile?.name);

  if (items.length === 0) {
    console.log("[OpenReel Console] No media items with sourceFile found.");
    return { linked: 0, failed: 0, errors: [] };
  }

  let linked = 0, failed = 0;
  const errors = [];

  for (const item of items) {
    const name = item.sourceFile.name;
    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    const isAudio = AUDIO_EXTS.has(ext);
    const baseName = name.slice(0, name.lastIndexOf("."));

    let fileUrl, fileName, mimeType;

    if (isAudio) {
      const rel = assetIndex[name];
      if (!rel) { errors.push({ id: item.id, name, error: "not found in asset dir" }); failed++; continue; }
      fileUrl = `${assetBase}${rel}`;
      fileName = name;
      mimeType = MIME[ext] || "audio/mpeg";
    } else {
      // Match proxy by base name (proxy files always use .mp4 extension)
      const proxyName = baseName + ".mp4";
      const proxyRel = proxyIndex[proxyName];
      if (!proxyRel) { errors.push({ id: item.id, name, error: "no proxy found" }); failed++; continue; }
      fileUrl = `${proxyBase}${proxyRel}`;
      fileName = proxyName;
      mimeType = "video/mp4";
    }

    onProgress?.(linked + failed + 1, items.length, name);

    try {
      await call("relinkMedia", { mediaId: item.id, fileUrl, fileName, mimeType }, 30_000);
      linked++;
    } catch (e) {
      errors.push({ id: item.id, name, error: e.message });
      failed++;
    }
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

  // Tracks
  addTrack,
  removeTrack,
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

  // Browser control
  reloadBrowser,

  // Asset relinking
  registerAssetRoot,
  relinkMedia,
  relinkAll,
  relinkForEditing,
  relinkAllMedia,     // relinks all items regardless of placeholder status
  relinkAllProxies,   // deprecated — use relinkForEditing

  // Low-level escape hatch for commands not yet wrapped as SDK methods
  call,
};

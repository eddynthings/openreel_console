/**
 * OpenReel Console — Browser Bridge Client
 *
 * Connects to the Vite plugin's WebSocket server and maps incoming commands
 * to Zustand store actions. Active only in development mode.
 *
 * Commands originate from the terminal SDK (openreel-sdk.mjs).
 *
 * Installation:
 *   1. Copy this file to <openreel-project>/apps/web/src/services/dev-bridge.ts
 *   2. In main.tsx add:
 *        import { initDevBridge } from "./services/dev-bridge";
 *        initDevBridge();   // call before ReactDOM.createRoot
 */

import type {
  Project, MediaItem, ProjectSettings, TextStyle, Transform, Keyframe,
  Action, Effect,
  TextAnimation, TextAnimationPreset, TextAnimationParams,
  ShapeClip, ShapeType, ShapeStyle, SVGClip, StickerClip,
  PhotoProject, CreateLayerOptions, PhotoBlendMode,
  BlendMode, EmphasisAnimation, Subtitle, Marker,
} from "@openreel/core";
import type { VideoEffect, VideoEffectType, ColorGradingSettings } from "../bridges/effects-bridge";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { autoSaveManager } from "./auto-save";

const BRIDGE_URL = "ws://localhost:7175";

// Opt out of React Fast Refresh partial updates for this module.
// Without this, HMR remounts components but never re-runs initDevBridge(),
// leaving the WebSocket handler bound to stale code. The decline() forces
// a full page reload whenever this file changes.
if (import.meta.hot) {
  import.meta.hot.decline();
}

interface BridgeCommand {
  id: string;
  command: string;
  args?: Record<string, unknown>;
}

interface BridgeResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Converts an ActionError object (or any error value) to a plain string. */
function serializeError(e: unknown): string | undefined {
  if (!e) return undefined;
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    return JSON.stringify(e);
  }
  return String(e);
}

async function dispatch(msg: BridgeCommand): Promise<BridgeResponse> {
  const { id, command, args = {} } = msg;
  const store = useProjectStore.getState();

  try {
    switch (command) {
      // ── Read ──────────────────────────────────────────────────────────────
      case "getState": {
        const p = store.project;
        return {
          id,
          ok: true,
          result: {
            projectId: p.id,
            name: p.name,
            duration: p.timeline.duration,
            trackCount: p.timeline.tracks.length,
            tracks: p.timeline.tracks.map((t) => ({
              id: t.id,
              type: t.type,
              name: t.name,
              clipCount: t.clips.length,
            })),
            mediaCount: p.mediaLibrary.items.length,
          },
        };
      }

      case "getProject": {
        return { id, ok: true, result: store.project };
      }

      case "getProjectJson": {
        const p = store.project;
        const exportable = {
          ...p,
          mediaLibrary: {
            ...p.mediaLibrary,
            items: p.mediaLibrary.items.map(
              ({ blob: _blob, thumbnailUrl: _thumb, filmstripThumbnails: _film, waveformData: _wave, ...rest }) => rest,
            ),
          },
        };
        return { id, ok: true, result: JSON.stringify(exportable, null, 2) };
      }

      // ── Project ──────────────────────────────────────────────────────────
      case "loadProject": {
        store.loadProject(args.project as Project);
        return { id, ok: true, result: { loaded: true, projectId: (args.project as Project).id } };
      }

      case "createNewProject": {
        store.createNewProject(
          args.name as string | undefined,
          args.settings as Partial<ProjectSettings> | undefined,
        );
        return { id, ok: true, result: { created: true } };
      }

      case "renameProject": {
        const r = await store.renameProject(args.name as string);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "updateSettings": {
        const r = await store.updateSettings(args.settings as Partial<ProjectSettings>);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      // ── Tracks ───────────────────────────────────────────────────────────
      case "addTrack": {
        const r = await store.addTrack(
          args.type as "video" | "audio" | "image" | "text" | "graphics",
          args.position as number | undefined,
        );
        return { id, ok: r.success, result: r, error: serializeError(r.error) };
      }

      case "removeTrack": {
        const r = await store.removeTrack(args.trackId as string);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "reorderTrack": {
        const r = await store.reorderTrack(args.trackId as string, args.position as number);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "renameTrack": {
        store.renameTrack(args.trackId as string, args.name as string);
        return { id, ok: true };
      }

      case "lockTrack": {
        const r = await store.lockTrack(args.trackId as string, args.locked as boolean);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "muteTrack": {
        const r = await store.muteTrack(args.trackId as string, args.muted as boolean);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "hideTrack": {
        const r = await store.hideTrack(args.trackId as string, args.hidden as boolean);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      // ── Clips ────────────────────────────────────────────────────────────
      case "addClip": {
        const r = await store.addClip(
          args.trackId as string,
          args.mediaId as string,
          args.startTime as number,
        );
        return { id, ok: r.success, result: r, error: serializeError(r.error) };
      }

      case "removeClip": {
        const r = await store.removeClip(args.clipId as string);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "moveClip": {
        const r = await store.moveClip(
          args.clipId as string,
          args.startTime as number,
          args.trackId as string | undefined,
        );
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "trimClip": {
        const r = await store.trimClip(
          args.clipId as string,
          args.inPoint as number | undefined,
          args.outPoint as number | undefined,
        );
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "splitClip": {
        const r = await store.splitClip(args.clipId as string, args.time as number);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "rippleDeleteClip": {
        const r = await store.rippleDeleteClip(args.clipId as string);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "duplicateClip": {
        const r = await store.duplicateClip(args.clipId as string);
        return { id, ok: r.success, result: r, error: serializeError(r.error) };
      }

      case "separateAudio": {
        const r = await store.separateAudio(args.clipId as string);
        return { id, ok: r.success, result: r, error: serializeError(r.error) };
      }

      case "updateClipTransform": {
        const ok = store.updateClipTransform(
          args.clipId as string,
          args.transform as Partial<Transform>,
        );
        return { id, ok };
      }

      case "addVideoEffect": {
        const r = await store.addVideoEffect(
          args.clipId as string,
          args.effectType as VideoEffectType,
          args.params as Record<string, unknown>,
        );
        return { id, ok: r.success, result: r, error: serializeError(r.error) };
      }

      case "updateClipKeyframes": {
        const ok = store.updateClipKeyframes(
          args.clipId as string,
          args.keyframes as Keyframe[],
        );
        return { id, ok };
      }

      // ── Media library ────────────────────────────────────────────────────
      case "importMedia": {
        const { fileUrl, fileName, mimeType } = args as {
          fileUrl: string;
          fileName: string;
          mimeType: string;
        };
        const resp = await fetch(fileUrl);
        if (!resp.ok) {
          return { id, ok: false, error: `Fetch failed: ${resp.status} ${resp.statusText} — ${fileUrl}` };
        }
        const blob = await resp.blob();
        const file = new File([blob], fileName, { type: mimeType });
        const r = await store.importMedia(file);
        return { id, ok: r.success, result: { mediaId: r.actionId }, error: serializeError(r.error) };
      }

      case "addPlaceholderMedia": {
        store.addPlaceholderMedia(args.item as MediaItem);
        return { id, ok: true };
      }

      case "deleteMedia": {
        const r = await store.deleteMedia(args.mediaId as string);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "renameMedia": {
        const r = await store.renameMedia(args.mediaId as string, args.name as string);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      // ── Asset relinking ──────────────────────────────────────────────────
      case "relinkMedia": {
        const { mediaId, fileUrl, fileName, mimeType } = args as {
          mediaId: string;
          fileUrl: string;
          fileName: string;
          mimeType: string;
        };
        const resp = await fetch(fileUrl);
        if (!resp.ok) {
          return { id, ok: false, error: `Fetch failed: ${resp.status} ${resp.statusText} — ${fileUrl}` };
        }
        const blob = await resp.blob();
        const file = new File([blob], fileName, { type: mimeType });
        const r = await store.replaceMediaAsset(mediaId, file);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      // ── Markers ──────────────────────────────────────────────────────────
      case "addMarker": {
        store.addMarker(
          args.time as number,
          args.label as string | undefined,
          args.color as string | undefined,
        );
        return { id, ok: true };
      }

      case "removeMarker": {
        store.removeMarker(args.markerId as string);
        return { id, ok: true };
      }

      // ── Text clips ───────────────────────────────────────────────────────
      case "createTextClip": {
        const clip = store.createTextClip(
          args.trackId as string,
          args.startTime as number,
          args.text as string,
          args.duration as number | undefined,
          args.style as Partial<TextStyle> | undefined,
        );
        return { id, ok: !!clip, result: clip };
      }

      case "updateTextContent": {
        const clip = store.updateTextContent(args.clipId as string, args.text as string);
        return { id, ok: !!clip, result: clip };
      }

      // ── SRT / subtitles ──────────────────────────────────────────────────
      case "importSRT": {
        const r = await store.importSRT(args.srtContent as string);
        return { id, ok: r.success, result: r, error: serializeError(r.error) };
      }

      case "exportSRT": {
        const srt = await store.exportSRT();
        return { id, ok: true, result: srt };
      }

      // ── Timeline ─────────────────────────────────────────────────────────
      case "getTimeline": {
        return { id, ok: true, result: store.project.timeline };
      }

      case "setPlayhead": {
        useTimelineStore.getState().seekTo(args.time as number);
        return { id, ok: true };
      }

      // ── UI ───────────────────────────────────────────────────────────────
      case "showWelcomeScreen": {
        const ui = useUIStore.getState();
        ui.setSkipWelcomeScreen(false);
        ui.setShowWelcomeScreen(true);
        return { id, ok: true };
      }

      // ── Auto-save ────────────────────────────────────────────────────────
      case "forceSave": {
        const project = useProjectStore.getState().project;
        await autoSaveManager.forceSave(project);
        return { id, ok: true, result: { savedProjectId: project.id, name: project.name } };
      }

      case "clearAutoSaves": {
        await autoSaveManager.clearAllSaves();
        return { id, ok: true };
      }

      case "initializeAutoSave": {
        await store.initializeAutoSave();
        return { id, ok: true };
      }

      case "checkForRecovery": {
        const saves = await store.checkForRecovery();
        return { id, ok: true, result: saves };
      }

      case "recoverFromAutoSave": {
        const ok = await store.recoverFromAutoSave(args.saveId as string);
        return { id, ok };
      }

      // ── Clip editing (advanced) ───────────────────────────────────────────
      case "addClipToNewTrack": {
        const r = await store.addClipToNewTrack(
          args.mediaId as string,
          args.startTime as number | undefined,
        );
        return { id, ok: r.success, result: r, error: serializeError(r.error) };
      }

      case "slipClip": {
        const r = await store.slipClip(args.clipId as string, args.delta as number);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "slideClip": {
        const r = await store.slideClip(args.clipId as string, args.delta as number);
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "rollEdit": {
        const r = await store.rollEdit(
          args.leftClipId as string,
          args.rightClipId as string,
          args.delta as number,
        );
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "trimToPlayhead": {
        const r = await store.trimToPlayhead(
          args.clipId as string,
          args.playheadTime as number,
          args.trimStart as boolean,
        );
        return { id, ok: r.success, error: serializeError(r.error) };
      }

      case "updateClipBlendMode": {
        const ok = store.updateClipBlendMode(args.clipId as string, args.blendMode as BlendMode);
        return { id, ok };
      }

      case "updateClipBlendOpacity": {
        const ok = store.updateClipBlendOpacity(args.clipId as string, args.opacity as number);
        return { id, ok };
      }

      case "updateClipRotate3D": {
        const ok = store.updateClipRotate3D(
          args.clipId as string,
          args.rotate3d as { x: number; y: number; z: number },
        );
        return { id, ok };
      }

      case "updateClipPerspective": {
        const ok = store.updateClipPerspective(args.clipId as string, args.perspective as number);
        return { id, ok };
      }

      case "updateClipTransformStyle": {
        const ok = store.updateClipTransformStyle(
          args.clipId as string,
          args.transformStyle as "flat" | "preserve-3d",
        );
        return { id, ok };
      }

      case "updateClipEmphasisAnimation": {
        const ok = store.updateClipEmphasisAnimation(
          args.clipId as string,
          args.emphasisAnimation as EmphasisAnimation,
        );
        return { id, ok };
      }

      case "getClip": {
        const clip = store.getClip(args.clipId as string);
        return { id, ok: !!clip, result: clip };
      }

      case "getTrack": {
        const track = store.getTrack(args.trackId as string);
        return { id, ok: !!track, result: track };
      }

      case "getTimelineDuration": {
        return { id, ok: true, result: store.getTimelineDuration() };
      }

      // ── Clipboard ────────────────────────────────────────────────────────
      case "copyClips": {
        store.copyClips(args.clipIds as string[]);
        return { id, ok: true };
      }

      case "pasteClips": {
        const results = await store.pasteClips(args.trackId as string, args.startTime as number);
        return { id, ok: true, result: results };
      }

      case "copyEffects": {
        store.copyEffects(args.clipId as string);
        return { id, ok: true };
      }

      case "pasteEffects": {
        const r = await store.pasteEffects(args.clipId as string);
        return { id, ok: r.success, result: r, error: serializeError(r.error) };
      }

      // ── Text (extended) ──────────────────────────────────────────────────
      case "updateTextStyle": {
        const clip = store.updateTextStyle(args.clipId as string, args.style as Partial<TextStyle>);
        return { id, ok: !!clip, result: clip };
      }

      case "updateTextAnimation": {
        const clip = store.updateTextAnimation(args.clipId as string, args.animation as TextAnimation);
        return { id, ok: !!clip, result: clip };
      }

      case "updateTextTransform": {
        const clip = store.updateTextTransform(args.clipId as string, args.transform as Partial<Transform>);
        return { id, ok: !!clip, result: clip };
      }

      case "getTextClip": {
        const clip = store.getTextClip(args.clipId as string);
        return { id, ok: !!clip, result: clip };
      }

      case "getAllTextClips": {
        return { id, ok: true, result: store.getAllTextClips() };
      }

      case "updateTextClipKeyframes": {
        const clip = store.updateTextClipKeyframes(args.clipId as string, args.keyframes as Keyframe[]);
        return { id, ok: !!clip, result: clip };
      }

      case "applyTextAnimationPreset": {
        const clip = store.applyTextAnimationPreset(
          args.clipId as string,
          args.preset as TextAnimationPreset,
          args.inDuration as number | undefined,
          args.outDuration as number | undefined,
          args.params as Partial<TextAnimationParams> | undefined,
        );
        return { id, ok: !!clip, result: clip };
      }

      case "getAvailableAnimationPresets": {
        return { id, ok: true, result: store.getAvailableAnimationPresets() };
      }

      case "deleteTextClip": {
        const ok = store.deleteTextClip(args.clipId as string);
        return { id, ok };
      }

      // ── Subtitles (extended) ─────────────────────────────────────────────
      case "addSubtitle": {
        await store.addSubtitle(args.subtitle as Subtitle);
        return { id, ok: true };
      }

      case "removeSubtitle": {
        store.removeSubtitle(args.subtitleId as string);
        return { id, ok: true };
      }

      case "updateSubtitle": {
        store.updateSubtitle(args.subtitleId as string, args.updates as Partial<Subtitle>);
        return { id, ok: true };
      }

      case "getSubtitle": {
        const subtitle = store.getSubtitle(args.subtitleId as string);
        return { id, ok: !!subtitle, result: subtitle };
      }

      case "applySubtitleStylePreset": {
        const ok = await store.applySubtitleStylePreset(args.presetName as string);
        return { id, ok };
      }

      case "getSubtitleStylePresets": {
        const presets = await store.getSubtitleStylePresets();
        return { id, ok: true, result: presets };
      }

      // ── Markers (extended) ───────────────────────────────────────────────
      case "updateMarker": {
        store.updateMarker(args.markerId as string, args.updates as Partial<Marker>);
        return { id, ok: true };
      }

      case "getMarker": {
        const marker = store.getMarker(args.markerId as string);
        return { id, ok: !!marker, result: marker };
      }

      case "getMarkers": {
        return { id, ok: true, result: store.getMarkers() };
      }

      // ── Graphics — shapes ────────────────────────────────────────────────
      case "createShapeClip": {
        const clip = store.createShapeClip(
          args.trackId as string,
          args.startTime as number,
          args.shapeType as ShapeType,
          args.duration as number | undefined,
          args.style as Partial<ShapeStyle> | undefined,
        );
        return { id, ok: !!clip, result: clip };
      }

      case "updateShapeStyle": {
        const clip = store.updateShapeStyle(args.clipId as string, args.style as Partial<ShapeStyle>);
        return { id, ok: !!clip, result: clip };
      }

      case "updateShapeTransform": {
        const clip = store.updateShapeTransform(args.clipId as string, args.transform as Partial<Transform>);
        return { id, ok: !!clip, result: clip };
      }

      case "getShapeClip": {
        const clip = store.getShapeClip(args.clipId as string);
        return { id, ok: !!clip, result: clip };
      }

      case "deleteShapeClip": {
        const ok = store.deleteShapeClip(args.clipId as string);
        return { id, ok };
      }

      // ── Graphics — SVG ───────────────────────────────────────────────────
      case "importSVG": {
        const clip = store.importSVG(
          args.svgContent as string,
          args.trackId as string,
          args.startTime as number,
          args.duration as number | undefined,
        );
        return { id, ok: !!clip, result: clip };
      }

      case "getSVGClip": {
        const clip = store.getSVGClip(args.clipId as string);
        return { id, ok: !!clip, result: clip };
      }

      case "getSVGClipById": {
        const clip = store.getSVGClipById(args.clipId as string);
        return { id, ok: !!clip, result: clip };
      }

      case "updateSVGClip": {
        const clip = store.updateSVGClip(
          args.clipId as string,
          args.updates as Parameters<typeof store.updateSVGClip>[1],
        );
        return { id, ok: !!clip, result: clip };
      }

      case "deleteSVGClip": {
        const ok = store.deleteSVGClip(args.clipId as string);
        return { id, ok };
      }

      // ── Graphics — stickers ──────────────────────────────────────────────
      case "createStickerClip": {
        const clip = store.createStickerClip(args.clip as StickerClip);
        return { id, ok: !!clip, result: clip };
      }

      case "getStickerClip": {
        const clip = store.getStickerClip(args.clipId as string);
        return { id, ok: !!clip, result: clip };
      }

      case "deleteStickerClip": {
        const ok = store.deleteStickerClip(args.clipId as string);
        return { id, ok };
      }

      // ── Photo editing ────────────────────────────────────────────────────
      case "createPhotoProject": {
        const project = store.createPhotoProject(
          args.width as number | undefined,
          args.height as number | undefined,
          args.name as string | undefined,
        );
        return { id, ok: !!project, result: project };
      }

      case "importPhotoForEditing": {
        // Fetch image from URL, decode to ImageBitmap, then pass to store
        const resp = await fetch(args.imageUrl as string);
        if (!resp.ok) return { id, ok: false, error: `Fetch failed: ${resp.status}` };
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);
        const project = store.importPhotoForEditing(bitmap, args.name as string | undefined);
        return { id, ok: !!project, result: project };
      }

      case "addPhotoLayer": {
        const project = store.addPhotoLayer(
          args.projectId as string,
          args.options as CreateLayerOptions | undefined,
        );
        return { id, ok: !!project, result: project };
      }

      case "removePhotoLayer": {
        const project = store.removePhotoLayer(args.projectId as string, args.layerId as string);
        return { id, ok: !!project, result: project };
      }

      case "reorderPhotoLayers": {
        const project = store.reorderPhotoLayers(
          args.projectId as string,
          args.fromIndex as number,
          args.toIndex as number,
        );
        return { id, ok: !!project, result: project };
      }

      case "setPhotoLayerVisibility": {
        const project = store.setPhotoLayerVisibility(
          args.projectId as string,
          args.layerId as string,
          args.visible as boolean | undefined,
        );
        return { id, ok: !!project, result: project };
      }

      case "setPhotoLayerOpacity": {
        const project = store.setPhotoLayerOpacity(
          args.projectId as string,
          args.layerId as string,
          args.opacity as number,
        );
        return { id, ok: !!project, result: project };
      }

      case "setPhotoLayerBlendMode": {
        const project = store.setPhotoLayerBlendMode(
          args.projectId as string,
          args.layerId as string,
          args.blendMode as PhotoBlendMode,
        );
        return { id, ok: !!project, result: project };
      }

      case "getPhotoProject": {
        const project = store.getPhotoProject(args.projectId as string);
        return { id, ok: !!project, result: project };
      }

      // ── Video effects (extended) ─────────────────────────────────────────
      case "updateVideoEffect": {
        const effect = store.updateVideoEffect(
          args.clipId as string,
          args.effectId as string,
          args.params as Record<string, unknown>,
        );
        return { id, ok: !!effect, result: effect };
      }

      case "removeVideoEffect": {
        const ok = store.removeVideoEffect(args.clipId as string, args.effectId as string);
        return { id, ok };
      }

      case "reorderVideoEffects": {
        const ok = store.reorderVideoEffects(args.clipId as string, args.effectIds as string[]);
        return { id, ok };
      }

      case "toggleVideoEffect": {
        const effect = store.toggleVideoEffect(
          args.clipId as string,
          args.effectId as string,
          args.enabled as boolean,
        );
        return { id, ok: !!effect, result: effect };
      }

      case "getVideoEffects": {
        return { id, ok: true, result: store.getVideoEffects(args.clipId as string) };
      }

      case "getVideoEffect": {
        const effect = store.getVideoEffect(args.clipId as string, args.effectId as string);
        return { id, ok: !!effect, result: effect };
      }

      // ── Color grading ────────────────────────────────────────────────────
      case "updateColorGrading": {
        const ok = store.updateColorGrading(
          args.clipId as string,
          args.settings as Partial<ColorGradingSettings>,
        );
        return { id, ok };
      }

      case "getColorGrading": {
        return { id, ok: true, result: store.getColorGrading(args.clipId as string) };
      }

      case "resetColorGrading": {
        const ok = store.resetColorGrading(args.clipId as string);
        return { id, ok };
      }

      // ── Audio effects ────────────────────────────────────────────────────
      case "addAudioEffect": {
        const ok = store.addAudioEffect(args.clipId as string, args.effect as Effect);
        return { id, ok };
      }

      case "updateAudioEffect": {
        const ok = store.updateAudioEffect(
          args.clipId as string,
          args.effectId as string,
          args.params as Record<string, unknown>,
        );
        return { id, ok };
      }

      case "removeAudioEffect": {
        const ok = store.removeAudioEffect(args.clipId as string, args.effectId as string);
        return { id, ok };
      }

      case "toggleAudioEffect": {
        const ok = store.toggleAudioEffect(
          args.clipId as string,
          args.effectId as string,
          args.enabled as boolean,
        );
        return { id, ok };
      }

      case "getAudioEffects": {
        return { id, ok: true, result: store.getAudioEffects(args.clipId as string) };
      }

      // ── Media (extended) ─────────────────────────────────────────────────
      case "getMediaItem": {
        const item = store.getMediaItem(args.mediaId as string);
        return { id, ok: !!item, result: item };
      }

      case "replacePlaceholderMedia": {
        const resp = await fetch(args.fileUrl as string);
        if (!resp.ok) return { id, ok: false, error: `Fetch failed: ${resp.status}` };
        const blob = await resp.blob();
        await store.replacePlaceholderMedia(args.mediaId as string, blob, args.name as string);
        return { id, ok: true };
      }

      case "setKieAIItemState": {
        store.setKieAIItemState(
          args.mediaId as string,
          args.isPending as boolean,
          args.kieaiError as boolean,
        );
        return { id, ok: true };
      }

      // ── Undo / Redo ──────────────────────────────────────────────────────
      case "undo": {
        const r = await store.undo();
        return { id, ok: r.success, result: r, error: serializeError(r.error) };
      }

      case "redo": {
        const r = await store.redo();
        return { id, ok: r.success, result: r, error: serializeError(r.error) };
      }

      case "canUndo": {
        return { id, ok: true, result: store.canUndo() };
      }

      case "canRedo": {
        return { id, ok: true, result: store.canRedo() };
      }

      // ── Execute raw action ───────────────────────────────────────────────
      case "executeAction": {
        const r = await store.executeAction(args.action as Action);
        return { id, ok: r.success, result: r, error: serializeError(r.error) };
      }

      // ── Utility reads ────────────────────────────────────────────────────
      case "getFullProject": {
        return { id, ok: true, result: store.project };
      }

      default:
        return {
          id,
          ok: false,
          error: `Unknown command: "${command}". Check openreel-sdk.mjs for the full command list.`,
        };
    }
  } catch (e) {
    return { id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function initDevBridge(): void {
  if (!import.meta.env.DEV) return;

  const connect = () => {
    const ws = new WebSocket(BRIDGE_URL);

    ws.addEventListener("open", () => {
      console.log(
        "%c[OpenReel Console] Connected — ready for commands",
        "color: #22c55e; font-weight: bold",
      );
      (window as Record<string, unknown>).__openreel = {
        call: (command: string, args?: Record<string, unknown>) => {
          if (ws.readyState !== WebSocket.OPEN)
            return Promise.reject(new Error("Bridge not connected"));
          const id = crypto.randomUUID();
          ws.send(JSON.stringify({ id, command, args }));
          return Promise.resolve({ id, queued: true });
        },
      };
    });

    ws.addEventListener("message", async (event) => {
      try {
        const msg = JSON.parse(event.data as string) as BridgeCommand;
        if (!msg.id || !msg.command) return;
        const response = await dispatch(msg);
        ws.send(JSON.stringify(response));
      } catch (e) {
        console.error("[OpenReel Console] dispatch error:", e);
      }
    });

    ws.addEventListener("close", () => {
      console.log(
        "%c[OpenReel Console] Disconnected — waiting for Vite to reload",
        "color: #f59e0b",
      );
    });

    ws.addEventListener("error", () => {
      // Suppress — close handler covers reconnect
    });
  };

  // Slight delay to let all stores initialize before accepting commands
  setTimeout(connect, 800);
}

import {
  CHECKPOINT_WIDTH_MULTIPLIER,
  centerlineSmoothingLabel,
  ctx,
  WIDTH,
  HEIGHT,
  CURB_MAX_WIDTH,
  CURB_MIN_WIDTH,
  CURB_STRIPE_LENGTH,
  DEFAULT_AI_OPPONENT_COUNT,
  getCarColorHex,
  checkpoints,
  getConnectedCenterlinePoints,
  getTrackPreset,
  MAX_AI_OPPONENT_COUNT,
  MIN_AI_OPPONENT_COUNT,
  physicsConfig,
  track,
  trackOptions,
  worldObjects,
} from "./parameters.js";
import {
  appLogo,
  appLogoReady,
  car,
  curbSegments,
  facebookLogo,
  facebookLogoReady,
  getActiveAiCars,
  getActiveAiLapDataList,
  getActiveAiOpponentCount,
  getActiveAiPhysicsRuntimes,
  kartSprite,
  kartSpriteReady,
  lapData,
  physicsRuntime,
  skidMarks,
  state,
} from "./state.js";
import {
  getBreadcrumbs,
  getEditorTopBarLayout,
  getEditorToolbarLayout,
  getGameModeRenderModel,
  getLoginProviderRenderModel,
  getMainMenuRenderModel,
  getSettingsHeaderRenderModel,
  getSettingsRenderLayout,
  getTrackSelectRenderModel,
  getTournamentStandingsData,
} from "./menus.js";
import { getFinishCelebrationStandings, getRacePosition, getRaceStandings } from "./physics.js";
import { tournamentRoomActive } from "./tournament-room.js";
import { formatTime } from "./utils.js";
import {
  checkpointFrame,
  blobRadius,
  drawPath,
  drawStripedCurb,
  getEditorWorldScale,
  getRaceWorldScale,
  getTrackWorldScale,
  initCurbSegments,
  normalizeWorldObject,
  pointOnCenterLine,
  sampleCenterlineHalfWidth,
  sampleClosedPath,
  surfaceAtForTrack,
  trackBoundaryPaths,
  trackFrameAtAngle,
  trackStartAngle,
} from "./track.js";
import { drawAsphaltMaterial, getAsphaltPattern } from "./material.js";
import { drawParticles, drawScreenParticles } from "./particles.js";
import { ambientAnimals } from "./ambient-animals.js";
import { ASSET_PLACEABLES, drawAnimalSprite, getAssetPlaceable } from "./asset-sprites.js";

const TOP_BAR_HEIGHT = 56;
const TRACK_SEGMENTS = 260;
const POND_PATH_SEGMENTS = 64;
const POND_BORDER_WIDTH = 3;
const POND_RENDER_SCALE = 2;
const POND_RENDER_PADDING = 10;
const POND_FILL_COLOR = "#7aa1c2";
const POND_BORDER_COLOR = "#8de2ff";
const OIL_BORDER_WIDTH = 3;
const OIL_FILL_COLOR = "#121212";
const OIL_BORDER_COLOR = "#49422a";

function aiOpponentsEnabled() {
  return physicsConfig.flags.AI_OPPONENTS_ENABLED !== false;
}

function playerAccentColor() {
  return getCarColorHex(state.playerColor);
}

function rivalAccentColor(index) {
  return getCarColorHex(state.aiRoster[index]?.color);
}

function activeMenuTagline() {
  const rotation = state.menuTagline;
  if (!rotation || !rotation.list.length) return { text: "", alpha: 0 };

  const text = rotation.list[rotation.index] || "";
  const fadeStart = rotation.displaySeconds;
  const fadeEnd = rotation.displaySeconds + rotation.fadeSeconds;
  let alpha = 1;
  if (rotation.elapsed > fadeStart) {
    const fadeT = Math.min(
      1,
      (rotation.elapsed - fadeStart) / Math.max(rotation.fadeSeconds, 0.0001),
    );
    alpha = 1 - fadeT;
  }
  if (rotation.elapsed >= fadeEnd) alpha = 0;

  return { text, alpha };
}

let pixelNoiseOverlay = null;
let cachedTrackBoundaries = null;
let cachedTrackSignature = null;
const mergedPondRenderCache = new WeakMap();
const mergedOilRenderCache = new WeakMap();
const previewTrackDataCache = new Map();
const centerlineLengthCache = new WeakMap();

function createTextureCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvasEl = document.createElement("canvas");
  canvasEl.width = width;
  canvasEl.height = height;
  return canvasEl;
}

function ensurePixelNoiseOverlay() {
  if (pixelNoiseOverlay) return pixelNoiseOverlay;
  const noiseCanvas = createTextureCanvas(256, 144);
  const noiseCtx = noiseCanvas.getContext("2d");
  noiseCtx.clearRect(0, 0, noiseCanvas.width, noiseCanvas.height);
  for (let i = 0; i < 2200; i++) {
    const x = Math.floor(Math.random() * noiseCanvas.width);
    const y = Math.floor(Math.random() * noiseCanvas.height);
    noiseCtx.fillStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
    noiseCtx.fillRect(x, y, 1, 1);
  }
  pixelNoiseOverlay = noiseCanvas;
  return pixelNoiseOverlay;
}

function tracePath(context, points) {
  if (!points.length) return;
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    context.lineTo(points[i].x, points[i].y);
  }
  context.closePath();
}

function getBlobPathPoints(blob) {
  const angle = blob.angle || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return sampleClosedPath((a) => {
    const radius = blobRadius(blob.rx, blob.ry, a, blob.seed || 0);
    const localX = Math.cos(a) * radius;
    const localY = Math.sin(a) * radius;
    return {
      x: blob.x + localX * cos - localY * sin,
      y: blob.y + localX * sin + localY * cos,
    };
  }, POND_PATH_SEGMENTS);
}

function getBlobRenderSignature(blobs) {
  if (!blobs.length) return "";
  return blobs
    .map((blob) =>
      [blob.x, blob.y, blob.rx, blob.ry, blob.seed || 0, blob.angle || 0]
        .map((value) => Number(value).toFixed(3))
        .join(":"),
    )
    .join("|");
}

function getBlobOutlineOffsets(radiusPx) {
  const offsets = [];
  const limit = Math.max(1, Math.round(radiusPx));
  for (let y = -limit; y <= limit; y++) {
    for (let x = -limit; x <= limit; x++) {
      if (!x && !y) continue;
      if (Math.hypot(x, y) <= limit + 0.15) offsets.push({ x, y });
    }
  }
  return offsets;
}

function buildMergedBlobRender(objects, { type, fillColor, borderColor, borderWidth, cache }) {
  if (!Array.isArray(objects)) return null;
  const blobs = objects.map(normalizeWorldObject).filter((obj) => obj?.type === type);
  if (!blobs.length) return null;

  const signature = getBlobRenderSignature(blobs);
  const cached = cache.get(objects);
  if (cached?.signature === signature) return cached.render;

  const blobPaths = blobs.map(getBlobPathPoints);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of blobPaths) {
    for (const point of path) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }

  if (!Number.isFinite(minX)) return null;

  minX = Math.floor(minX - POND_RENDER_PADDING);
  minY = Math.floor(minY - POND_RENDER_PADDING);
  maxX = Math.ceil(maxX + POND_RENDER_PADDING);
  maxY = Math.ceil(maxY + POND_RENDER_PADDING);

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const pixelWidth = Math.max(1, Math.ceil(width * POND_RENDER_SCALE));
  const pixelHeight = Math.max(1, Math.ceil(height * POND_RENDER_SCALE));

  const maskCanvas = createTextureCanvas(pixelWidth, pixelHeight);
  const fillCanvas = createTextureCanvas(pixelWidth, pixelHeight);
  const resultCanvas = createTextureCanvas(pixelWidth, pixelHeight);
  const maskCtx = maskCanvas.getContext("2d");
  const fillCtx = fillCanvas.getContext("2d");
  const resultCtx = resultCanvas.getContext("2d");
  const drawMergedPaths = (context) => {
    context.save();
    context.scale(POND_RENDER_SCALE, POND_RENDER_SCALE);
    context.translate(-minX, -minY);
    for (const path of blobPaths) {
      context.beginPath();
      tracePath(context, path);
      context.fill();
    }
    context.restore();
  };

  maskCtx.clearRect(0, 0, pixelWidth, pixelHeight);
  maskCtx.fillStyle = borderColor;
  drawMergedPaths(maskCtx);

  fillCtx.clearRect(0, 0, pixelWidth, pixelHeight);
  fillCtx.fillStyle = fillColor;
  drawMergedPaths(fillCtx);

  resultCtx.clearRect(0, 0, pixelWidth, pixelHeight);
  const outlineOffsets = getBlobOutlineOffsets(borderWidth * POND_RENDER_SCALE);
  for (const offset of outlineOffsets) {
    resultCtx.drawImage(maskCanvas, offset.x, offset.y);
  }
  resultCtx.globalCompositeOperation = "destination-out";
  resultCtx.drawImage(maskCanvas, 0, 0);
  resultCtx.globalCompositeOperation = "source-over";
  resultCtx.drawImage(fillCanvas, 0, 0);

  const render = { canvas: resultCanvas, minX, minY, width, height };
  cache.set(objects, { signature, render });
  return render;
}

function drawMergedPonds(objects) {
  const render = buildMergedBlobRender(objects, {
    type: "pond",
    fillColor: POND_FILL_COLOR,
    borderColor: POND_BORDER_COLOR,
    borderWidth: POND_BORDER_WIDTH,
    cache: mergedPondRenderCache,
  });
  if (!render) return false;
  ctx.drawImage(render.canvas, render.minX, render.minY, render.width, render.height);
  return true;
}

function drawMergedOilPatches(objects) {
  const render = buildMergedBlobRender(objects, {
    type: "oil",
    fillColor: OIL_FILL_COLOR,
    borderColor: OIL_BORDER_COLOR,
    borderWidth: OIL_BORDER_WIDTH,
    cache: mergedOilRenderCache,
  });
  if (!render) return false;
  ctx.drawImage(render.canvas, render.minX, render.minY, render.width, render.height);
  return true;
}

function widthProfileSignature(values) {
  if (!Array.isArray(values) || !values.length) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += (Number(values[i]) || 0) * ((i % 7) + 1);
  }
  return Number(sum.toFixed(3));
}

function trackSignature(trackDef, segments) {
  return {
    segments,
    cx: trackDef.cx,
    cy: trackDef.cy,
    borderSize: trackDef.borderSize,
    worldScale: getTrackWorldScale(trackDef),
    centerlineHalfWidth: trackDef.centerlineHalfWidth,
    centerlineWidthSig: widthProfileSignature(trackDef.centerlineWidthProfile),
    centerlineWidthLength: Array.isArray(trackDef.centerlineWidthProfile)
      ? trackDef.centerlineWidthProfile.length
      : 0,
    centerlineLoopRef: trackDef.centerlineLoop,
    centerlineLoopLength: trackDef.centerlineLoop ? trackDef.centerlineLoop.length : 0,
  };
}

function sameTrackSignature(a, b) {
  if (!a || !b) return false;
  return (
    a.segments === b.segments &&
    a.cx === b.cx &&
    a.cy === b.cy &&
    a.borderSize === b.borderSize &&
    a.worldScale === b.worldScale &&
    a.centerlineHalfWidth === b.centerlineHalfWidth &&
    a.centerlineWidthSig === b.centerlineWidthSig &&
    a.centerlineWidthLength === b.centerlineWidthLength &&
    a.centerlineLoopRef === b.centerlineLoopRef &&
    a.centerlineLoopLength === b.centerlineLoopLength
  );
}

function getTrackBoundariesCached(trackDef, segments) {
  const nextSignature = trackSignature(trackDef, segments);
  if (!sameTrackSignature(cachedTrackSignature, nextSignature)) {
    cachedTrackBoundaries = trackBoundaryPaths(trackDef, segments);
    cachedTrackSignature = nextSignature;
  }
  return cachedTrackBoundaries;
}

function getPreviewTrackData(preset) {
  const cached = previewTrackDataCache.get(preset.id);
  const signature = trackSignature(preset.track, TRACK_SEGMENTS);
  if (cached && sameTrackSignature(cached.signature, signature)) return cached.data;

  const data = {
    boundaries: trackBoundaryPaths(preset.track, TRACK_SEGMENTS),
    curbs: initCurbSegments(preset.track),
  };
  previewTrackDataCache.set(preset.id, { signature, data });
  return data;
}

function applyWorldScaleTransform(trackDef = track) {
  const worldScale = getTrackWorldScale(trackDef);
  applyWorldTransform(trackDef, { worldScale });
}

function applyWorldTransform(
  trackDef = track,
  { worldScale = getTrackWorldScale(trackDef), viewOffsetX = 0, viewOffsetY = 0 } = {},
) {
  ctx.translate(viewOffsetX, viewOffsetY);
  ctx.translate(trackDef.cx, trackDef.cy);
  ctx.scale(worldScale, worldScale);
  ctx.translate(-trackDef.cx, -trackDef.cy);
}

function getViewportCenter() {
  return {
    x: WIDTH * 0.5,
    y: (HEIGHT - TOP_BAR_HEIGHT) * 0.5,
  };
}

export function getRaceCameraState(trackDef = track, vehicle = car) {
  const authoringScale = getTrackWorldScale(trackDef);
  const worldScale = getRaceWorldScale(trackDef);
  const scrolling = authoringScale < 0.5;
  if (!scrolling) {
    return {
      worldScale,
      viewOffsetX: Number.isFinite(trackDef.editorViewOffsetX)
        ? Number(trackDef.editorViewOffsetX)
        : state.editor.viewOffsetX,
      viewOffsetY: Number.isFinite(trackDef.editorViewOffsetY)
        ? Number(trackDef.editorViewOffsetY)
        : state.editor.viewOffsetY,
      scrolling,
    };
  }

  const viewportCenter = getViewportCenter();
  const viewOffsetX = viewportCenter.x - (trackDef.cx + (vehicle.x - trackDef.cx) * worldScale);
  const viewOffsetY = viewportCenter.y - (trackDef.cy + (vehicle.y - trackDef.cy) * worldScale);
  return { worldScale, viewOffsetX, viewOffsetY, scrolling };
}

function getEditorCameraState(trackDef = track) {
  return {
    worldScale: getEditorWorldScale(trackDef),
    viewOffsetX: state.editor.viewOffsetX,
    viewOffsetY: state.editor.viewOffsetY,
  };
}

function transformPointByWorldScale(point, trackDef) {
  const worldScale = getTrackWorldScale(trackDef);
  return {
    x: trackDef.cx + (point.x - trackDef.cx) * worldScale,
    y: trackDef.cy + (point.y - trackDef.cy) * worldScale,
  };
}

function expandBounds(bounds, x, y) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function getPathBounds(points, padding = 0) {
  if (!Array.isArray(points) || !points.length) return null;
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const point of points) {
    if (!point) continue;
    expandBounds(bounds, point.x, point.y);
  }
  if (!Number.isFinite(bounds.minX)) return null;
  return {
    minX: Math.floor(bounds.minX - padding),
    minY: Math.floor(bounds.minY - padding),
    maxX: Math.ceil(bounds.maxX + padding),
    maxY: Math.ceil(bounds.maxY + padding),
  };
}

function getPreviewBounds(preset, boundaries, curbs) {
  const trackDef = preset.track;
  const worldScale = getTrackWorldScale(trackDef);
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };

  for (const p of boundaries.outer || []) {
    const scaled = transformPointByWorldScale(p, trackDef);
    expandBounds(bounds, scaled.x, scaled.y);
  }
  for (const segment of curbs.outer || []) {
    for (const p of segment.points || segment) {
      const scaled = transformPointByWorldScale(p, trackDef);
      expandBounds(bounds, scaled.x, scaled.y);
    }
  }
  for (const segment of curbs.inner || []) {
    for (const p of segment.points || segment) {
      const scaled = transformPointByWorldScale(p, trackDef);
      expandBounds(bounds, scaled.x, scaled.y);
    }
  }
  for (const obj of preset.worldObjects || []) {
    if (obj.type === "tree" || obj.type === "barrel" || obj.type === "spring") {
      const radius = (Number(obj.r) || 0) * worldScale;
      const center = transformPointByWorldScale(obj, trackDef);
      expandBounds(bounds, center.x - radius, center.y - radius);
      expandBounds(bounds, center.x + radius, center.y + radius);
      continue;
    }
    if (obj.type === "wall") {
      const center = transformPointByWorldScale(obj, trackDef);
      const halfLength = (Number(obj.length) || 0) * worldScale * 0.5;
      const halfWidth = (Number(obj.width) || 0) * worldScale * 0.5;
      expandBounds(bounds, center.x - halfLength, center.y - halfWidth);
      expandBounds(bounds, center.x + halfLength, center.y + halfWidth);
      continue;
    }
    if (obj.type === "pond" || obj.type === "oil") {
      const radius = Math.max(Number(obj.rx) || 0, Number(obj.ry) || 0) * worldScale;
      const center = transformPointByWorldScale(obj, trackDef);
      expandBounds(bounds, center.x - radius, center.y - radius);
      expandBounds(bounds, center.x + radius, center.y + radius);
      continue;
    }
    if (obj.type === "animal") {
      const radius = (Number(obj.r) || 12) * worldScale * 1.35;
      const center = transformPointByWorldScale(obj, trackDef);
      expandBounds(bounds, center.x - radius, center.y - radius);
      expandBounds(bounds, center.x + radius, center.y + radius);
    }
  }

  if (!Number.isFinite(bounds.minX)) {
    return {
      minX: preset.track.cx - 100,
      minY: preset.track.cy - 100,
      maxX: preset.track.cx + 100,
      maxY: preset.track.cy + 100,
    };
  }

  return bounds;
}

function drawPixelNoise() {
  const overlay = ensurePixelNoiseOverlay();
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(overlay, 0, 0, WIDTH, HEIGHT);
  ctx.restore();
}

function drawStaticAnimalObject(object, { shouldFlash = false } = {}) {
  const direction =
    Math.abs(Math.cos(object.angle || 0)) > Math.abs(Math.sin(object.angle || 0))
      ? Math.cos(object.angle || 0) < 0
        ? "left"
        : "right"
      : Math.sin(object.angle || 0) < 0
        ? "back"
        : "front";
  drawAnimalSprite(ctx, {
    kind: object.kind,
    x: object.x,
    y: object.y,
    radius: object.r,
    direction,
    animation: "idle",
    elapsed: 0,
  });
  if (shouldFlash) {
    ctx.save();
    ctx.strokeStyle = "#ffe167";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(object.x, object.y, object.r + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawAmbientAnimals() {
  for (const animal of ambientAnimals) {
    if (!animal.active) continue;
    drawAnimalSprite(ctx, {
      kind: animal.kind,
      x: animal.x,
      y: animal.y,
      radius: animal.r,
      direction: animal.facing,
      animation: animal.speed > 10 ? "walk" : "idle",
      elapsed: animal.animationTime,
    });
  }
}

function drawDecor(objects = worldObjects) {
  const flash = state.editor.selectionFlash;
  const selectedObjectIndex =
    state.mode === "editor" && state.editor.latestEditTarget?.kind === "object"
      ? state.editor.latestEditTarget.objectIndex
      : -1;
  drawMergedPonds(objects);
  drawMergedOilPatches(objects);
  for (const [index, obj] of objects.entries()) {
    const normalized = normalizeWorldObject(obj);
    if (!normalized) continue;
    const shouldFlash =
      state.mode === "editor" &&
      selectedObjectIndex === index &&
      flash.kind === "object" &&
      flash.index === index &&
      flash.time > 0 &&
      Math.floor(flash.time / 0.08) % 2 === 0;
    if (normalized.type === "tree") {
      const angle = normalized.angle || 0;
      const lift = normalized.height * 5;
      ctx.save();
      ctx.translate(normalized.x, normalized.y + 10);
      ctx.scale(1, 0.45);
      ctx.fillStyle = "rgba(12, 18, 14, 0.22)";
      ctx.beginPath();
      ctx.arc(0, 0, normalized.r * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#4a2f1e";
      ctx.save();
      ctx.translate(normalized.x, normalized.y);
      ctx.rotate(angle);
      ctx.fillRect(-4, 8 - lift, 8, 16 + lift);
      ctx.fillStyle = "#2f9c4a";
      const canopy = sampleClosedPath((a) => {
        const radius =
          normalized.r *
          (1 +
            0.2 * Math.sin(a * 3 + normalized.x * 0.02 + angle) +
            0.12 * Math.sin(a * 5 + normalized.y * 0.02 - angle * 0.7));
        return {
          x: Math.cos(a) * radius,
          y: Math.sin(a) * radius - lift,
        };
      }, 40);
      ctx.beginPath();
      drawPath(canopy);
      ctx.fill();
      ctx.fillStyle = "#3dcf60";
      const highlight = sampleClosedPath((a) => {
        const radius =
          normalized.r * 0.4 * (1 + 0.12 * Math.sin(a * 4 + normalized.x * 0.08 + angle));
        return {
          x: -8 + Math.cos(a) * radius,
          y: -6 + Math.sin(a) * radius - lift,
        };
      }, 24);
      ctx.beginPath();
      drawPath(highlight);
      ctx.fill();
      if (shouldFlash) {
        ctx.strokeStyle = "#ffe167";
        ctx.lineWidth = 4;
        ctx.beginPath();
        drawPath(canopy);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (normalized.type === "pond") {
      if (shouldFlash) {
        ctx.strokeStyle = "#ffe167";
        ctx.lineWidth = 4;
        const waterPath = getBlobPathPoints(normalized);
        ctx.beginPath();
        tracePath(ctx, waterPath);
        ctx.stroke();
      }
      continue;
    }

    if (normalized.type === "oil") {
      if (shouldFlash) {
        ctx.strokeStyle = "#ffe167";
        ctx.lineWidth = 4;
        const oilPath = getBlobPathPoints(normalized);
        ctx.beginPath();
        tracePath(ctx, oilPath);
        ctx.stroke();
      }
      continue;
    }

    if (normalized.type === "animal") {
      if (state.mode === "racing" && objects === worldObjects) continue;
      drawStaticAnimalObject(normalized, { shouldFlash });
      continue;
    }

    if (normalized.type === "barrel") {
      const angle = normalized.angle || 0;
      const lift = normalized.height * 4.5;
      ctx.save();
      ctx.translate(normalized.x, normalized.y + normalized.r * 0.8);
      ctx.scale(1, 0.45);
      ctx.fillStyle = "rgba(16, 12, 8, 0.24)";
      ctx.beginPath();
      ctx.arc(0, 0, normalized.r * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(normalized.x, normalized.y);
      ctx.rotate(angle);
      ctx.fillStyle = "#8e4a0a";
      ctx.beginPath();
      ctx.arc(0, -lift * 0.22, normalized.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#d16f0d";
      ctx.beginPath();
      ctx.arc(0, -lift * 0.4, normalized.r * 0.82, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#3a2a12";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -lift * 0.22, normalized.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#ffe0a2";
      ctx.beginPath();
      ctx.arc(0, -lift * 0.34, normalized.r * 0.55, 0.15, Math.PI - 0.15);
      ctx.stroke();
      if (shouldFlash) {
        ctx.strokeStyle = "#ffe167";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, -lift * 0.22, normalized.r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (normalized.type === "spring") {
      ctx.save();
      ctx.translate(normalized.x, normalized.y);
      ctx.rotate(normalized.angle);
      ctx.scale(1, 0.45);
      ctx.fillStyle = "rgba(19, 14, 26, 0.2)";
      ctx.beginPath();
      ctx.arc(0, 0, normalized.r * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(normalized.x, normalized.y);
      ctx.rotate(normalized.angle);
      ctx.strokeStyle = "#ffe46a";
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const y = normalized.r * 0.7 - i * 5;
        if (i === 0) ctx.moveTo(-normalized.r * 0.55, y);
        ctx.quadraticCurveTo(0, y - 4, normalized.r * 0.55, y - 8);
        ctx.quadraticCurveTo(0, y - 12, -normalized.r * 0.55, y - 16);
      }
      ctx.stroke();
      ctx.fillStyle = "#ff6d3d";
      ctx.beginPath();
      ctx.roundRect(-normalized.r * 0.9, normalized.r * 0.38, normalized.r * 1.8, 8, 4);
      ctx.fill();
      if (shouldFlash) {
        ctx.strokeStyle = "#ffe167";
        ctx.lineWidth = 3;
        ctx.strokeRect(
          -normalized.r - 4,
          -normalized.r - 18,
          normalized.r * 2 + 8,
          normalized.r * 2 + 22,
        );
      }
      ctx.restore();
    }

    if (normalized.type === "wall") {
      const halfLength = normalized.length * 0.5;
      const halfWidth = normalized.width * 0.5;
      const extrude = normalized.height * 6;
      const top = [
        { x: -halfLength, y: -halfWidth - extrude },
        { x: halfLength, y: -halfWidth - extrude },
        { x: halfLength, y: halfWidth - extrude },
        { x: -halfLength, y: halfWidth - extrude },
      ];
      const front = [
        { x: -halfLength, y: halfWidth - extrude },
        { x: halfLength, y: halfWidth - extrude },
        { x: halfLength, y: halfWidth },
        { x: -halfLength, y: halfWidth },
      ];
      ctx.save();
      ctx.translate(normalized.x, normalized.y + 8);
      ctx.rotate(normalized.angle);
      ctx.fillStyle = "rgba(18, 20, 24, 0.2)";
      ctx.fillRect(-halfLength, -halfWidth, normalized.length, normalized.width);
      ctx.restore();
      ctx.save();
      ctx.translate(normalized.x, normalized.y);
      ctx.rotate(normalized.angle);
      ctx.fillStyle = "#56636d";
      ctx.beginPath();
      drawPath(front);
      ctx.fill();
      ctx.fillStyle = "#8e9ca8";
      ctx.beginPath();
      drawPath(top);
      ctx.fill();
      ctx.strokeStyle = "#d7e0e7";
      ctx.lineWidth = 2;
      ctx.beginPath();
      drawPath(top);
      ctx.stroke();
      if (shouldFlash) {
        ctx.strokeStyle = "#ffe167";
        ctx.lineWidth = 3;
        ctx.strokeRect(
          -halfLength - 4,
          -halfWidth - extrude - 4,
          normalized.length + 8,
          normalized.width + extrude + 8,
        );
      }
      ctx.restore();
    }
  }
}

function drawRoadDetails(trackDef = track) {
  ctx.strokeStyle = "rgba(235, 235, 235, 0.45)";
  ctx.lineWidth = 4;
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    const p = pointOnCenterLine(t, trackDef);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawSkidMarks() {
  if (!skidMarks.length) return;

  ctx.save();
  ctx.lineCap = "round";
  for (const mark of skidMarks) {
    ctx.strokeStyle = mark.color;
    ctx.lineWidth = mark.width;
    ctx.beginPath();
    ctx.moveTo(mark.x1, mark.y1);
    ctx.lineTo(mark.x2, mark.y2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawVertexAsterisks(points, size = 3.2, color = "rgba(255, 245, 120, 0.95)") {
  if (!Array.isArray(points) || !points.length) return;
  const d = size * 0.72;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const p of points) {
    ctx.beginPath();
    ctx.moveTo(p.x - size, p.y);
    ctx.lineTo(p.x + size, p.y);
    ctx.moveTo(p.x, p.y - size);
    ctx.lineTo(p.x, p.y + size);
    ctx.moveTo(p.x - d, p.y - d);
    ctx.lineTo(p.x + d, p.y + d);
    ctx.moveTo(p.x + d, p.y - d);
    ctx.lineTo(p.x - d, p.y + d);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCheckpointFlags() {
  const CHECKPOINT_PIN_WIDTH_MULTIPLIER = 1.2;
  for (const cp of checkpoints) {
    if (cp.isStart) continue;
    const frame = checkpointFrame(cp, track);
    const center = frame.point;
    const normal = frame.normal;
    const tangent = frame.tangent;
    const roadWidth = frame.roadWidth;
    const checkpointSpan = roadWidth * CHECKPOINT_WIDTH_MULTIPLIER;
    const pinSpan = roadWidth * CHECKPOINT_PIN_WIDTH_MULTIPLIER;
    const posts = [-pinSpan * 0.5, pinSpan * 0.5];

    if (physicsConfig.flags.DEBUG_MODE) {
      const innerPin = {
        x: center.x + normal.x * (checkpointSpan * -0.5),
        y: center.y + normal.y * (checkpointSpan * -0.5),
      };
      const outerPin = {
        x: center.x + normal.x * (checkpointSpan * 0.5),
        y: center.y + normal.y * (checkpointSpan * 0.5),
      };
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.moveTo(innerPin.x, innerPin.y);
      ctx.lineTo(outerPin.x, outerPin.y);
      ctx.stroke();
      ctx.restore();
    }

    for (const radius of posts) {
      const baseX = center.x + normal.x * radius;
      const baseY = center.y + normal.y * radius;
      const topX = baseX;
      const topY = baseY - 16;
      const side = radius < 0 ? 1 : -1;
      const flagTipX = topX + tangent.x * 10 * side;
      const flagTipY = topY + tangent.y * 10 * side;

      ctx.strokeStyle = "#e5e5e5";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(topX, topY);
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(flagTipX, flagTipY + 4);
      ctx.lineTo(topX, topY + 7);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawStartLine(trackDef = track) {
  const startAngle = trackStartAngle(trackDef);
  const frame = trackFrameAtAngle(startAngle, trackDef);
  const center = frame.point;
  const span = frame.roadWidth;
  const thickness = 20;
  const cols = Math.max(8, Math.floor(span / 18));
  const rows = 2;
  const cellW = span / cols;
  const cellH = thickness / rows;
  const normalAngle = Math.atan2(frame.normal.y, frame.normal.x);

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(normalAngle);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      ctx.fillStyle = (c + r) % 2 ? "#ffffff" : "#111111";
      ctx.fillRect(-span * 0.5 + c * cellW, -thickness * 0.5 + r * cellH, cellW, cellH);
    }
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-span * 0.5, -thickness * 0.5, span, thickness);
  ctx.restore();
}

function drawTrackSurface(trackDef, boundaries, segments, showCurbs, objects = worldObjects) {
  const outerPath = boundaries.outer;
  const innerPath = boundaries.inner;
  if (!outerPath.length || !innerPath.length) return;
  const worldScale = Math.max(getTrackWorldScale(trackDef), 0.01);
  const asphaltPadding = Math.ceil(Math.max(WIDTH, HEIGHT) / worldScale + CURB_MAX_WIDTH * 2);
  const asphaltBounds = getPathBounds(outerPath, asphaltPadding);

  ctx.save();
  ctx.beginPath();
  const centerCount = boundaries.center?.length || 0;
  const alignedCounts =
    centerCount > 0 && centerCount === outerPath.length && centerCount === innerPath.length;
  if (alignedCounts) {
    for (let i = 0; i < centerCount; i++) {
      const next = (i + 1) % centerCount;
      ctx.moveTo(outerPath[i].x, outerPath[i].y);
      ctx.lineTo(outerPath[next].x, outerPath[next].y);
      ctx.lineTo(innerPath[next].x, innerPath[next].y);
      ctx.lineTo(innerPath[i].x, innerPath[i].y);
      ctx.closePath();
    }
    ctx.clip();
  } else {
    drawPath(outerPath);
    drawPath([...innerPath].reverse());
    ctx.clip("evenodd");
  }
  drawAsphaltMaterial(ctx, asphaltBounds);
  ctx.restore();

  if (showCurbs) {
    const drawCurbSegment = (segment, defaultSign) => {
      const pts = segment.points || segment;
      const sign = segment.outwardSign ?? defaultSign;
      const stripeScale = Number.isFinite(segment.stripeScale) ? segment.stripeScale : 1;
      const scaledMinWidth = Math.max(CURB_MIN_WIDTH, CURB_MIN_WIDTH * stripeScale);
      const scaledMaxWidth = Math.max(scaledMinWidth + 1, CURB_MAX_WIDTH * stripeScale);
      if (segment.renderStyle === "dotted") {
        const widthCaps = buildCurbWidthCaps(pts, sign, trackDef, objects);
        if (shouldRenderExplicitGuideSegment(pts, sign, trackDef, objects, widthCaps)) {
          drawDottedCurbGuide(pts);
        }
        return;
      }
      const widthCaps = buildCurbWidthCaps(pts, sign, trackDef, objects);
      const runs = splitCurbRenderRuns(pts, sign, trackDef, objects, widthCaps);
      if (runs.length) {
        const visibleRuns = runs.filter((run) =>
          shouldRenderCurbSubsection(run, sign, trackDef, objects),
        );
        const hasVisibleCurb = visibleRuns.some((run) => run.kind === "curb");
        for (const run of visibleRuns) {
          if (run.kind === "guide") {
            if (hasVisibleCurb) drawDottedCurbGuide(run.points);
          } else {
            drawStripedCurb(
              run.points,
              sign,
              scaledMinWidth,
              scaledMaxWidth,
              CURB_STRIPE_LENGTH,
              run.widthCaps,
            );
          }
        }
        return;
      }
      drawStripedCurb(pts, sign, scaledMinWidth, scaledMaxWidth, CURB_STRIPE_LENGTH);
    };
    segments.outer.forEach((segment) => drawCurbSegment(segment, -1));
    segments.inner.forEach((segment) => drawCurbSegment(segment, 1));
  }
}

function splitCurbRenderRuns(
  points,
  sideSign,
  trackDef = track,
  objects = worldObjects,
  widthCaps = null,
) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const minCurbRunArcLength = CURB_STRIPE_LENGTH * 1.5;
  const minGuideRunArcLength = CURB_STRIPE_LENGTH * 2;
  const classes = points.map((_, index) => {
    const cap = Array.isArray(widthCaps) ? (widthCaps[index] ?? CURB_MAX_WIDTH) : CURB_MAX_WIDTH;
    if (cap > CURB_MIN_WIDTH * 0.25) return "curb";
    const probe = curbOuterProbePoint(points, index, sideSign, CURB_MAX_WIDTH);
    const surface = surfaceAtForTrack(probe.x, probe.y, trackDef, objects);
    return surface === "grass" ? "curb" : "guide";
  });
  smoothCurbRunClasses(points, classes, minGuideRunArcLength);
  smoothCurbRunClasses(points, classes, minCurbRunArcLength);
  const runs = [];
  let currentKind = classes[0];
  let currentPoints = [points[0]];
  let currentCaps = [Array.isArray(widthCaps) ? (widthCaps[0] ?? CURB_MAX_WIDTH) : CURB_MAX_WIDTH];

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    const nextKind = classes[i];
    const nextCap = Array.isArray(widthCaps) ? (widthCaps[i] ?? CURB_MAX_WIDTH) : CURB_MAX_WIDTH;
    if (nextKind === currentKind) {
      currentPoints.push(point);
      currentCaps.push(nextCap);
      continue;
    }
    currentPoints.push(point);
    currentCaps.push(nextCap);
    const completed = finalizeCurbRenderRun(
      currentPoints,
      currentCaps,
      currentKind,
      currentKind === "guide" ? minGuideRunArcLength : minCurbRunArcLength,
    );
    if (completed) runs.push(completed);
    currentKind = nextKind;
    currentPoints = [points[i - 1], point];
    currentCaps = [
      Array.isArray(widthCaps) ? (widthCaps[i - 1] ?? CURB_MAX_WIDTH) : CURB_MAX_WIDTH,
      nextCap,
    ];
  }

  const tail = finalizeCurbRenderRun(
    currentPoints,
    currentCaps,
    currentKind,
    currentKind === "guide" ? minGuideRunArcLength : minCurbRunArcLength,
  );
  if (tail) runs.push(tail);
  return runs;
}

function shouldRenderCurbSubsection(run, sideSign, trackDef = track, objects = worldObjects) {
  const points = run?.points;
  if (!Array.isArray(points) || points.length < 2) return false;
  let curbHits = 0;
  let asphaltHits = 0;
  let samples = 0;
  const stride = Math.max(1, Math.floor(points.length / 8));
  for (let i = 0; i < points.length; i += stride) {
    const probe = curbOuterProbePoint(points, i, sideSign, CURB_MAX_WIDTH);
    const surface = surfaceAtForTrack(probe.x, probe.y, trackDef, objects);
    if (surface === "asphalt") asphaltHits += 1;
    else curbHits += 1;
    samples += 1;
  }
  if (samples === 0) return false;
  if (run.kind === "guide") return asphaltHits > 0 && curbHits > 0;
  return curbHits > 0;
}

function shouldRenderExplicitGuideSegment(
  points,
  sideSign,
  trackDef = track,
  objects = worldObjects,
  widthCaps = null,
) {
  if (!Array.isArray(points) || points.length < 2) return false;
  let nonAsphaltHits = 0;
  let samples = 0;
  let supportedWidthHits = 0;
  let widthSamples = 0;
  let widthSum = 0;
  const stride = Math.max(1, Math.floor(points.length / 8));
  const probeDistance = CURB_MAX_WIDTH * 0.8;
  for (let i = 0; i < points.length; i += stride) {
    const probe = curbOuterProbePoint(points, i, sideSign, probeDistance);
    const surface = surfaceAtForTrack(probe.x, probe.y, trackDef, objects);
    if (surface !== "asphalt") nonAsphaltHits += 1;
    if (Array.isArray(widthCaps)) {
      const width = Math.max(0, widthCaps[i] ?? 0);
      widthSum += width;
      widthSamples += 1;
      if (width >= CURB_MIN_WIDTH * 1.4) supportedWidthHits += 1;
    }
    samples += 1;
  }
  if (samples === 0) return false;
  const nonAsphaltRatio = nonAsphaltHits / samples;
  if (nonAsphaltRatio < 0.6) return false;
  if (!Array.isArray(widthCaps) || widthSamples === 0) return true;
  const supportedWidthRatio = supportedWidthHits / widthSamples;
  const averageWidth = widthSum / widthSamples;
  return supportedWidthRatio >= 0.55 && averageWidth >= CURB_MIN_WIDTH * 1.55;
}

export function measureCurbSupportWidth(
  points,
  index,
  sideSign,
  trackDef = track,
  objects = worldObjects,
) {
  if (!Array.isArray(points) || !points.length) return 0;
  let sawGrassGap = false;
  let lastGrassDistance = 0;
  const sampleCount = 12;

  for (let step = 0; step <= sampleCount; step++) {
    const distance = (step / sampleCount) * CURB_MAX_WIDTH;
    const probe = curbOuterProbePoint(points, index, sideSign, distance);
    const surface = surfaceAtForTrack(probe.x, probe.y, trackDef, objects);

    if (!sawGrassGap) {
      if (surface === "grass") {
        sawGrassGap = true;
        lastGrassDistance = distance;
      }
    } else if (surface !== "grass") {
      let lo = lastGrassDistance;
      let hi = distance;
      for (let refine = 0; refine < 8; refine++) {
        const mid = (lo + hi) * 0.5;
        const midProbe = curbOuterProbePoint(points, index, sideSign, mid);
        const midSurface = surfaceAtForTrack(midProbe.x, midProbe.y, trackDef, objects);
        if (midSurface === "grass") lo = mid;
        else hi = mid;
      }
      return lo < CURB_MIN_WIDTH * 0.25 ? 0 : lo;
    }
  }

  // If the probe never reaches grass, the curb edge is facing asphalt or
  // another drivable branch, so there is no valid curb width to render.
  return sawGrassGap ? CURB_MAX_WIDTH : 0;
}

function buildCurbWidthCaps(points, sideSign, trackDef = track, objects = worldObjects) {
  if (!Array.isArray(points) || !points.length) return null;
  const caps = points.map((_, index) =>
    measureCurbSupportWidth(points, index, sideSign, trackDef, objects),
  );

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < caps.length - 1; i++) {
      caps[i] = Math.min(caps[i], (caps[i - 1] + caps[i] + caps[i + 1]) / 3);
    }
  }

  return caps;
}

function smoothCurbRunClasses(points, classes, minArcLength) {
  if (!Array.isArray(points) || points.length < 2 || !Array.isArray(classes)) return;
  let start = 0;
  while (start < classes.length) {
    let end = start + 1;
    while (end < classes.length && classes[end] === classes[start]) end++;
    const previousKind = start > 0 ? classes[start - 1] : null;
    const nextKind = end < classes.length ? classes[end] : null;
    if (previousKind && previousKind === nextKind) {
      let arcLen = 0;
      for (let i = start; i < end; i++) {
        const prevIndex = Math.max(0, i - 1);
        arcLen += Math.hypot(points[i].x - points[prevIndex].x, points[i].y - points[prevIndex].y);
      }
      if (arcLen < minArcLength) {
        for (let i = start; i < end; i++) classes[i] = previousKind;
      }
    }
    start = end;
  }
}

function curbOuterProbePoint(points, index, sideSign, width) {
  const point = points[index];
  let nx = 0;
  let ny = 0;
  if (index > 0) {
    const dx = point.x - points[index - 1].x;
    const dy = point.y - points[index - 1].y;
    const len = Math.hypot(dx, dy) || 1;
    nx -= dy / len;
    ny += dx / len;
  }
  if (index < points.length - 1) {
    const dx = points[index + 1].x - point.x;
    const dy = points[index + 1].y - point.y;
    const len = Math.hypot(dx, dy) || 1;
    nx -= dy / len;
    ny += dx / len;
  }
  const nlen = Math.hypot(nx, ny) || 1;
  nx = (nx / nlen) * sideSign;
  ny = (ny / nlen) * sideSign;
  return {
    x: point.x + nx * width,
    y: point.y + ny * width,
  };
}

function finalizeCurbRenderRun(points, widthCaps, kind, minRunArcLength) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let arcLen = 0;
  for (let i = 1; i < points.length; i++) {
    arcLen += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  if (arcLen < minRunArcLength) return null;
  return { kind, points, widthCaps };
}

function drawDottedCurbGuide(points) {
  if (!Array.isArray(points) || points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.98)";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawEditorHiddenCurbOverlay(segments) {
  const drawRuns = (runs, palette) => {
    runs.forEach((segment, index) => {
      const pts = segment.points || segment;
      if (!Array.isArray(pts) || pts.length < 2) return;
      ctx.save();
      ctx.strokeStyle = palette[index % palette.length];
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
      ctx.restore();
    });
  };

  drawRuns(segments.outer || [], ["rgba(160, 92, 255, 0.95)", "rgba(72, 120, 255, 0.95)"]);
  drawRuns(segments.inner || [], ["rgba(208, 92, 255, 0.95)", "rgba(66, 188, 255, 0.95)"]);
}

function drawTrack() {
  const boundaries = getTrackBoundariesCached(track, TRACK_SEGMENTS);
  const showCurbs = state.mode !== "editor" || state.editor.showCurbs;
  drawTrackSurface(track, boundaries, curbSegments, showCurbs, worldObjects);
  if (
    state.mode === "editor" &&
    !state.editor.showCurbs &&
    boundaries.outer.length &&
    boundaries.inner.length
  ) {
    drawEditorHiddenCurbOverlay(curbSegments);
    drawVertexAsterisks(boundaries.outer);
    drawVertexAsterisks(boundaries.inner);
  }

  drawDecor();
  drawSkidMarks();
  if (boundaries.center.length) {
    drawRoadDetails(track);
    drawStartLine(track);
    drawCheckpointFlags();
  }
}

function getRaceOrder() {
  return getRacePosition("player");
}

function getBestLapTime(lapTimes) {
  if (!Array.isArray(lapTimes) || !lapTimes.length) return null;
  return lapTimes.reduce((best, value) => (value < best ? value : best), lapTimes[0]);
}

function traceKartOutlinePath() {
  ctx.beginPath();
  ctx.moveTo(0, -29);
  ctx.quadraticCurveTo(10, -28, 13, -20);
  ctx.lineTo(14, -7);
  ctx.quadraticCurveTo(15, 6, 12, 20);
  ctx.quadraticCurveTo(9, 29, 4, 30);
  ctx.lineTo(-4, 30);
  ctx.quadraticCurveTo(-9, 29, -12, 20);
  ctx.quadraticCurveTo(-15, 6, -14, -7);
  ctx.lineTo(-13, -20);
  ctx.quadraticCurveTo(-10, -28, 0, -29);
  ctx.closePath();
}

function drawVehicle(vehicle, { accent = "#d22525", blink = false, label = "" } = {}) {
  const blinkActive = blink && state.checkpointBlink.time > 0;
  let blinkT = 0;
  if (blinkActive) {
    blinkT = state.checkpointBlink.time / Math.max(state.checkpointBlink.duration, 0.0001);
  }

  const airCfg = physicsConfig.air;
  const scale = Math.max(1, vehicle.visualScale || 1);
  const screenLiftPx = Math.max(0, vehicle.z) * airCfg.liftPxPerMeter;

  ctx.save();
  ctx.translate(vehicle.x, vehicle.y + 7);
  ctx.scale(1 + Math.max(0, vehicle.z) * 0.015, 0.5);
  ctx.fillStyle = `rgba(10, 12, 18, ${Math.max(0.08, 0.26 - vehicle.z * 0.025).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(vehicle.x, vehicle.y - screenLiftPx);
  ctx.rotate(vehicle.angle + Math.PI * 0.5);
  ctx.scale(scale, scale);

  if (blinkActive) {
    const pulse = 0.5 + 0.5 * Math.sin((1 - blinkT) * Math.PI * 7);
    const glowStrength = Math.max(0, Math.min(1, blinkT * 0.5 + pulse * 0.5));
    ctx.shadowColor = `rgba(255, 255, 255, ${(0.9 * glowStrength).toFixed(3)})`;
    ctx.shadowBlur = 18 + 24 * glowStrength;
  }

  ctx.save();
  ctx.scale(1.11, 1.11);
  traceKartOutlinePath();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  if (kartSpriteReady) {
    const spriteWidth = 30;
    const spriteLength = 56;
    ctx.drawImage(kartSprite, -spriteWidth * 0.5, -spriteLength * 0.5, spriteWidth, spriteLength);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(-8, -24, 16, 7);
    ctx.globalAlpha = 1;
  } else {
    traceKartOutlinePath();
    ctx.fillStyle = "#243541";
    ctx.fill();
    traceKartOutlinePath();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.fillStyle = "#ffd34d";
    ctx.fillRect(-6, -8, 12, 16);
  }

  ctx.restore();

  if (label) {
    ctx.save();
    ctx.fillStyle = "#f4fbff";
    ctx.font = "bold 12px Verdana";
    ctx.textAlign = "center";
    ctx.fillText(label, vehicle.x, vehicle.y - screenLiftPx - 18);
    ctx.restore();
  }
}

function drawCar() {
  const activeAiCars = getActiveAiCars();
  const vehicles = [
    {
      vehicle: car,
      accent: playerAccentColor(),
      blink: true,
      label: state.playerName,
    },
  ];
  if (aiOpponentsEnabled()) {
    activeAiCars.forEach((vehicle, index) => {
      vehicles.push({
        vehicle,
        accent: rivalAccentColor(index),
        label: vehicle.label,
      });
    });
  }
  vehicles
    .sort((a, b) => a.vehicle.y + a.vehicle.z - (b.vehicle.y + b.vehicle.z))
    .forEach(({ vehicle, accent, blink = false, label }) => {
      drawVehicle(vehicle, { accent, blink, label });
    });
}

function drawDebugVectors() {
  if (!physicsConfig.flags.DEBUG_MODE || state.mode !== "racing") return;
  const activeAiCount = getActiveAiOpponentCount();

  const forwardX = Math.cos(car.angle);
  const forwardY = Math.sin(car.angle);
  const rightX = -forwardY;
  const rightY = forwardX;
  const velMag = Math.hypot(car.vx, car.vy);
  const velDirX = velMag > 0.001 ? car.vx / velMag : 0;
  const velDirY = velMag > 0.001 ? car.vy / velMag : 0;
  const lateralWorldX = rightX * physicsRuntime.debug.vLateral;
  const lateralWorldY = rightY * physicsRuntime.debug.vLateral;
  const scale = 0.08;
  const originX = physicsRuntime.debug.pivotX;
  const originY = physicsRuntime.debug.pivotY;

  ctx.save();
  const camera = getRaceCameraState(track);
  applyWorldTransform(track, camera);
  ctx.lineWidth = 3;

  ctx.strokeStyle = "#ffe167";
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.lineTo(originX + forwardX * 60, originY + forwardY * 60);
  ctx.stroke();

  ctx.strokeStyle = "#4da6ff";
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.lineTo(originX + velDirX * 70, originY + velDirY * 70);
  ctx.stroke();

  ctx.strokeStyle = "#ff6969";
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.lineTo(originX + lateralWorldX * scale, originY + lateralWorldY * scale);
  ctx.stroke();

  if (aiOpponentsEnabled()) {
    getActiveAiPhysicsRuntimes().forEach((runtime, index) => {
      const accent = rivalAccentColor(index);
      if (runtime.debugPathPoints.length > 1) {
        ctx.strokeStyle = `${accent}cc`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(runtime.debugPathPoints[0].x, runtime.debugPathPoints[0].y);
        for (let i = 1; i < runtime.debugPathPoints.length; i++) {
          ctx.lineTo(runtime.debugPathPoints[i].x, runtime.debugPathPoints[i].y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(runtime.targetPoint.x, runtime.targetPoint.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();

  const panelX = 20;
  const panelY = HEIGHT - TOP_BAR_HEIGHT - 126;
  const panelW = 330;
  const panelH = 114;
  const lineX = panelX + 14;
  const firstLineY = panelY + 24;
  const lineStep = 20;
  const toStableInt = (value) => {
    const rounded = Math.round(value);
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  ctx.fillStyle = "rgba(5, 8, 18, 0.84)";
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.fillStyle = "#e9f0ff";
  ctx.font = "15px Verdana";
  ctx.fillText(`SURFACE AT: ${physicsRuntime.debug.surface.toUpperCase()}`, lineX, firstLineY);
  ctx.fillText(
    `SLIP: ${(physicsRuntime.debug.slipAngle * 57.2958).toFixed(1)} DEG`,
    lineX,
    firstLineY + lineStep,
  );
  ctx.fillText(
    `Vf: ${toStableInt(physicsRuntime.debug.vForward)} Vl: ${toStableInt(physicsRuntime.debug.vLateral)}`,
    lineX,
    firstLineY + lineStep * 2,
  );
  ctx.fillText(
    `CHECKPOINTS: ${lapData.passed.size}/${checkpoints.length}`,
    lineX,
    firstLineY + lineStep * 3,
  );
  ctx.fillText(
    aiOpponentsEnabled() ? `AI: ${activeAiCount} ACTIVE` : "AI: OFF",
    lineX,
    firstLineY + lineStep * 4,
  );
  ctx.fillText(
    `FPS: ${toStableInt(state.performance.fps)}`,
    lineX + 150,
    firstLineY + lineStep * 4,
  );
}

function drawStartSequenceOverlay() {
  const seq = state.startSequence;
  if (!seq.active && seq.goFlash <= 0) return;

  const viewportCenter = getViewportCenter();
  const cx = viewportCenter.x;
  const cy = viewportCenter.y;

  if (seq.active) {
    const readyHold = 0.95;
    const readyFadeEnd = 1.8;
    let readyAlpha = 0;
    if (seq.elapsed < readyHold) readyAlpha = 1;
    else
      readyAlpha = Math.max(
        0,
        Math.min(1, 1 - (seq.elapsed - readyHold) / (readyFadeEnd - readyHold)),
      );

    if (readyAlpha > 0) {
      const pulse = 1 + Math.sin(seq.elapsed * 9) * 0.06;
      ctx.save();
      ctx.translate(cx, cy - 82);
      ctx.scale(pulse, pulse);
      ctx.globalAlpha = readyAlpha;
      ctx.fillStyle = "rgba(11, 19, 28, 0.78)";
      ctx.fillRect(-165, -54, 330, 82);
      ctx.fillStyle = "#fff2a6";
      ctx.font = "bold 56px Verdana";
      ctx.fillText("READY?", -145, 4);
      ctx.restore();
    }

    const redCount = Math.min(3, Math.floor(seq.elapsed));
    const plateX = cx - 146;
    const plateY = cy - 18;
    const plateW = 292;
    const plateH = 112;

    ctx.save();
    const plateGradient = ctx.createLinearGradient(plateX, plateY, plateX, plateY + plateH);
    plateGradient.addColorStop(0, "#707985");
    plateGradient.addColorStop(1, "#2b3138");
    ctx.fillStyle = plateGradient;
    ctx.fillRect(plateX, plateY, plateW, plateH);
    ctx.strokeStyle = "#181d21";
    ctx.lineWidth = 4;
    ctx.strokeRect(plateX, plateY, plateW, plateH);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillRect(plateX + 8, plateY + 8, plateW - 16, 18);

    for (let i = 0; i < 3; i++) {
      const x = cx - 92 + i * 92;
      const y = cy + 38;
      const lit = i < redCount;
      const glow = lit ? "rgba(255, 72, 72, 0.5)" : "rgba(0, 0, 0, 0.35)";
      const lamp = ctx.createRadialGradient(x - 6, y - 8, 5, x, y, 29);
      if (lit) {
        lamp.addColorStop(0, "#ffd8d8");
        lamp.addColorStop(0.45, "#fa4747");
        lamp.addColorStop(1, "#640f0f");
      } else {
        lamp.addColorStop(0, "#797f89");
        lamp.addColorStop(0.55, "#444a54");
        lamp.addColorStop(1, "#1e232a");
      }

      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.fillStyle = lamp;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - 7, y - 8, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.fill();
    }
    ctx.restore();
  }

  if (!seq.active && seq.goFlash > 0) {
    const a = Math.max(0, Math.min(1, seq.goFlash / 0.85));
    const pop = 1 + (1 - a) * 0.12;
    ctx.save();
    const plateX = cx - 146;
    const plateY = cy - 18;
    const plateW = 292;
    const plateH = 112;
    const plateGradient = ctx.createLinearGradient(plateX, plateY, plateX, plateY + plateH);
    plateGradient.addColorStop(0, "#707985");
    plateGradient.addColorStop(1, "#2b3138");
    ctx.globalAlpha = Math.min(1, a + 0.2);
    ctx.fillStyle = plateGradient;
    ctx.fillRect(plateX, plateY, plateW, plateH);
    ctx.strokeStyle = "#181d21";
    ctx.lineWidth = 4;
    ctx.strokeRect(plateX, plateY, plateW, plateH);

    for (let i = 0; i < 3; i++) {
      const x = cx - 92 + i * 92;
      const y = cy + 38;
      const lamp = ctx.createRadialGradient(x - 6, y - 8, 5, x, y, 29);
      lamp.addColorStop(0, "#d5ffe3");
      lamp.addColorStop(0.45, "#57e58a");
      lamp.addColorStop(1, "#0f5228");
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(96, 255, 162, 0.45)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.fillStyle = lamp;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - 7, y - 8, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.fill();
    }

    ctx.translate(cx, cy - 18);
    ctx.scale(pop, pop);
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(9, 19, 16, 0.8)";
    ctx.fillRect(-125, -58, 250, 92);
    ctx.fillStyle = "#6af0a8";
    ctx.font = "bold 64px Verdana";
    ctx.fillText("GO!", -85, 12);
    ctx.restore();
  }
}

function drawTitleBar() {
  const activeAiCars = getActiveAiCars();
  const activeAiLapDataList = getActiveAiLapDataList();
  const activeAiCount = activeAiCars.length;
  const gradient = ctx.createLinearGradient(0, 0, 0, TOP_BAR_HEIGHT);
  gradient.addColorStop(0, "#1f3342");
  gradient.addColorStop(1, "#142431");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, TOP_BAR_HEIGHT);
  ctx.strokeStyle = "#0c161e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, TOP_BAR_HEIGHT - 1);
  ctx.lineTo(WIDTH, TOP_BAR_HEIGHT - 1);
  ctx.stroke();

  const drawHudPanel = (x, y, w, h, strokeStyle) => {
    ctx.fillStyle = "rgba(8, 18, 30, 0.72)";
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();
  };

  const top = 7;
  const panelHeight = TOP_BAR_HEIGHT - 14;
  const playerPanelWidth = 238;
  const lapPanelWidth = 118;
  const panelGap = 8;
  const aiTileWidth = 112;
  const aiAreaWidth = aiOpponentsEnabled()
    ? activeAiCount * aiTileWidth + Math.max(0, activeAiCount - 1) * panelGap
    : 0;
  const rightPad = 18;

  let x = 18;
  ctx.fillStyle = "#ffe167";
  ctx.font = "bold 24px Verdana";
  ctx.fillText("Carun", x, 34);
  x += ctx.measureText("Carun").width + 10;

  if (appLogoReady) {
    ctx.drawImage(appLogo, x, 8, 38, 38);
  }
  x += 38 + 12;

  const liveLap = state.finished
    ? lapData.lapTimes[lapData.lapTimes.length - 1] || 0
    : state.raceTime - lapData.currentLapStart;
  const fastestIndex =
    lapData.lapTimes.length > 0
      ? lapData.lapTimes.reduce((bestIdx, t, idx, arr) => (t < arr[bestIdx] ? idx : bestIdx), 0)
      : -1;

  drawHudPanel(x, top, playerPanelWidth, panelHeight, `${playerAccentColor()}66`);
  ctx.fillStyle = playerAccentColor();
  ctx.font = "bold 17px Verdana";
  ctx.fillText(state.playerName, x + 12, 25);
  ctx.fillStyle = playerAccentColor();
  ctx.font = "bold 11px Verdana";
  ctx.fillText(
    `P${getRaceOrder()}/${aiOpponentsEnabled() ? activeAiCount + 1 : 1}  L${Math.min(lapData.lap, lapData.maxLaps)}/${lapData.maxLaps}`,
    x + 12,
    42,
  );

  const lapPanelX = x + playerPanelWidth + panelGap;
  drawHudPanel(lapPanelX, top, lapPanelWidth, panelHeight, "rgba(255, 225, 103, 0.28)");
  ctx.font = "bold 10px Verdana";
  for (let i = 0; i < lapData.maxLaps; i++) {
    const isCurrent = !state.finished && i === lapData.lapTimes.length;
    const isCompleted = i < lapData.lapTimes.length;
    const value = isCurrent ? liveLap : lapData.lapTimes[i];
    if (isCurrent) ctx.fillStyle = "#f3f8ff";
    else if (isCompleted && i === fastestIndex) ctx.fillStyle = "#ffe167";
    else if (isCompleted) ctx.fillStyle = "#8b98a7";
    else ctx.fillStyle = "rgba(180, 194, 208, 0.45)";
    const label = value !== undefined ? `L${i + 1} ${formatTime(value)}` : `L${i + 1} --:--.---`;
    ctx.fillText(label, lapPanelX + 10, 21 + i * 11);
  }

  if (aiOpponentsEnabled()) {
    const aiStandings = getRaceStandings().filter((entry) => String(entry.id).startsWith("ai-"));
    let aiX = WIDTH - rightPad - aiAreaWidth;
    aiStandings.forEach((entry) => {
      const index = activeAiCars.findIndex((vehicle) => vehicle.id === entry.id);
      if (index < 0) return;
      const vehicle = activeAiCars[index];
      const aiLapData = activeAiLapDataList[index];
      const bestLap = getBestLapTime(aiLapData.lapTimes);
      const accent = rivalAccentColor(index);
      drawHudPanel(aiX, top, aiTileWidth, panelHeight, `${accent}66`);
      ctx.fillStyle = accent;
      ctx.font = "bold 15px Verdana";
      ctx.fillText(`P${getRacePosition(vehicle.id)}`, aiX + 8, 36);
      ctx.save();
      ctx.textAlign = "left";
      ctx.font = "bold 10px Verdana";
      ctx.fillText(vehicle.label, aiX + 8, 20);
      ctx.fillStyle = "#d8e8f7";
      ctx.fillText(
        aiLapData.finished
          ? "FINISHED"
          : `L${Math.min(aiLapData.lap, aiLapData.maxLaps)}/${aiLapData.maxLaps}`,
        aiX + 35,
        33,
      );
      ctx.restore();
      ctx.fillStyle = "#b9ccdc";
      ctx.font = "bold 9px Verdana";
      ctx.fillText(`BEST ${bestLap ? formatTime(bestLap) : "--:--.---"}`, aiX + 8, 46);
      aiX += aiTileWidth + panelGap;
    });
  }
}

function drawEditorTitleBar() {
  const preset = getTrackPreset(state.editor.trackIndex);
  const topBarLayout = getEditorTopBarLayout();
  ctx.save();

  const gradient = ctx.createLinearGradient(0, 0, 0, TOP_BAR_HEIGHT);
  gradient.addColorStop(0, "#1f3342");
  gradient.addColorStop(1, "#142431");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, TOP_BAR_HEIGHT);
  ctx.strokeStyle = "#0c161e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, TOP_BAR_HEIGHT - 1);
  ctx.lineTo(WIDTH, TOP_BAR_HEIGHT - 1);
  ctx.stroke();

  const leftPad = 18;
  const brandBox = { x: leftPad, y: 8, width: 320, height: 40 };
  if (appLogoReady) ctx.drawImage(appLogo, brandBox.x, brandBox.y + 2, 36, 36);

  ctx.fillStyle = "#ffe167";
  ctx.font = "bold 11px Verdana";
  ctx.textAlign = "left";
  ctx.fillText("EDITOR", brandBox.x + 48, 20);

  ctx.fillStyle = "#f4fbff";
  ctx.font = "bold 20px Verdana";
  const trackName = String(preset.name || "UNTITLED").slice(0, 24);
  ctx.fillText(trackName, brandBox.x + 48, 40);

  const drawTopBarButton = (rect, label, shortcut) => {
    const active = rect.id === "toggleCurbs" && state.editor.showCurbs;
    ctx.fillStyle = active ? "#264c61" : "rgba(16, 33, 45, 0.92)";
    ctx.strokeStyle = active ? "#9be9ff" : "rgba(184, 215, 232, 0.28)";
    ctx.lineWidth = active ? 2.5 : 2;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f4fbff";
    ctx.font = "bold 15px Verdana";
    ctx.textAlign = "left";
    ctx.fillText(label, rect.x + 12, rect.y + 22);
    ctx.fillStyle = "#9cb9c8";
    ctx.font = "12px Verdana";
    ctx.textAlign = "right";
    ctx.fillText(`[${shortcut}]`, rect.x + rect.width - 10, rect.y + 21);
  };

  drawTopBarButton(topBarLayout.save, "Save", topBarLayout.save.shortcut);
  drawTopBarButton(topBarLayout.curbs, "Curbs", topBarLayout.curbs.shortcut);
  drawTopBarButton(topBarLayout.back, "Esc", topBarLayout.back.shortcut);
  drawTopBarButton(topBarLayout.race, "Race", topBarLayout.race.shortcut);
  drawTopBarButton(topBarLayout.build, "Build", topBarLayout.build.shortcut);
  ctx.restore();
}

function selectedObjectValueLabel(preset) {
  const target = state.editor.latestEditTarget;
  if (target?.kind !== "object") return "--";
  if (target.kind === "object") {
    const object = preset.worldObjects?.[target.objectIndex];
    if (!object) return "--";
    if (object.type === "pond" || object.type === "oil")
      return `${Math.round(object.rx)}x${Math.round(object.ry)}`;
    if (object.type === "wall") return `${Math.round(object.length)}x${Math.round(object.width)}`;
    if (Number.isFinite(object.r)) return `${Math.round(object.r)}`;
  }
  return "--";
}

function selectedObjectLabel(preset) {
  const objects = preset.worldObjects || [];
  if (!objects.length) return "--";
  const iconForObject = (object) =>
    object?.type === "pond"
      ? "≈"
      : object?.type === "oil"
        ? "●"
        : object?.type === "barrel"
          ? "◉"
          : object?.type === "tree"
            ? "♣"
            : object?.type === "spring"
              ? "✹"
              : object?.type === "wall"
                ? "▭"
                : object?.type === "animal"
                  ? getAssetPlaceable(object.kind).icon
                  : "•";
  const target = state.editor.latestEditTarget;
  if (target?.kind !== "object" || !objects[target.objectIndex]) {
    const last = objects[objects.length - 1];
    return `${objects.length}/${objects.length} ${iconForObject(last)}`;
  }
  return `${target.objectIndex + 1}/${objects.length} ${iconForObject(objects[target.objectIndex])}`;
}

function selectedRoadLabel(preset) {
  const strokes = preset.centerlineStrokes || [];
  if (!strokes.length) return "Road --";
  const target = state.editor.latestEditTarget;
  if (target?.kind !== "stroke" || !strokes[target.strokeIndex]) {
    return `Road ${strokes.length}/${strokes.length}`;
  }
  return `Road ${target.strokeIndex + 1}/${strokes.length}`;
}

function selectedCheckpointLabel(preset) {
  const checkpointsList = preset.checkpoints || [];
  if (!checkpointsList.length) return "CheckPoint --";
  const target = state.editor.latestEditTarget;
  if (target?.kind !== "checkpoint" || !checkpointsList[target.checkpointIndex]) {
    return `CheckPoint ${checkpointsList.length}/${checkpointsList.length}`;
  }
  return `CheckPoint ${target.checkpointIndex + 1}/${checkpointsList.length}`;
}

function selectedRoadWidthLabel(preset) {
  const target = state.editor.latestEditTarget;
  if (target?.kind !== "stroke") return "--";
  const stroke = preset.centerlineStrokes?.[target.strokeIndex];
  if (Number.isFinite(stroke?.[0]?.halfWidth)) return `${Math.round(stroke[0].halfWidth * 2)} px`;
  return "--";
}

function drawToolbarButton(rect, text, { active = false } = {}) {
  ctx.save();
  ctx.fillStyle = active ? "#264c61" : "rgba(14, 27, 35, 0.82)";
  ctx.strokeStyle = active ? "#9be9ff" : "rgba(184, 215, 232, 0.3)";
  ctx.lineWidth = active ? 2 : 1.5;
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f3fbff";
  ctx.font = "bold 15px Verdana";
  ctx.textAlign = "center";
  ctx.fillText(text, rect.x + rect.width * 0.5, rect.y + 17);
  ctx.restore();
}

function drawEditorToolbar() {
  const preset = getTrackPreset(state.editor.trackIndex);
  const layout = getEditorToolbarLayout();
  const objectValue = selectedObjectValueLabel(preset);
  const objectLabel = selectedObjectLabel(preset);
  const roadLabel = selectedRoadLabel(preset);
  const checkpointLabel = selectedCheckpointLabel(preset);
  const roadWidth = selectedRoadWidthLabel(preset);
  const smoothingText = centerlineSmoothingLabel(preset.track.centerlineSmoothingMode);
  const zoomText = `${Math.round(getTrackWorldScale(preset.track) * 100)}%`;
  const activeToolLabel = state.editor.panMode
    ? "PAN"
    : state.editor.activeTool === "road"
      ? state.editor.roadMode === "checkpoint"
        ? "CHECKPOINT"
        : "ROAD"
      : state.editor.activeTool === "asset"
        ? getAssetPlaceable(state.editor.selectedAssetKind).label.toUpperCase()
        : state.editor.activeTool === "pond"
          ? "WATER"
          : state.editor.activeTool === "oil"
            ? "OIL"
            : state.editor.activeTool.toUpperCase();
  const toolbarHeaderLabel = state.editor.toolbar.hoverLabel || activeToolLabel;

  ctx.save();
  ctx.fillStyle = "rgba(6, 14, 20, 0.86)";
  ctx.beginPath();
  ctx.roundRect(layout.panel.x, layout.panel.y, layout.panel.width, layout.panel.height, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(184, 215, 232, 0.26)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const titleGradient = ctx.createLinearGradient(
    layout.titleBar.x,
    layout.titleBar.y,
    layout.titleBar.x,
    layout.titleBar.y + layout.titleBar.height,
  );
  titleGradient.addColorStop(0, "#2e5568");
  titleGradient.addColorStop(1, "#1d3948");
  ctx.fillStyle = titleGradient;
  ctx.beginPath();
  ctx.roundRect(
    layout.titleBar.x,
    layout.titleBar.y,
    layout.titleBar.width,
    layout.titleBar.height,
    10,
  );
  ctx.fill();

  ctx.fillStyle = "#ffe167";
  ctx.font = "bold 16px Verdana";
  ctx.textAlign = "left";
  ctx.fillText("✥", layout.titleBar.x + 12, layout.titleBar.y + 21);
  ctx.fillStyle = "#f4fbff";
  ctx.fillText("Tool", layout.titleBar.x + 36, layout.titleBar.y + 21);
  ctx.fillStyle = "#9cb9c8";
  ctx.font = "12px Verdana";
  ctx.textAlign = "right";
  ctx.fillText(
    toolbarHeaderLabel,
    layout.titleBar.x + layout.titleBar.width - 12,
    layout.titleBar.y + 21,
  );

  ctx.fillStyle = "#9cb9c8";
  ctx.font = "bold 12px Verdana";
  ctx.textAlign = "left";
  ctx.fillText("OBJECTS", layout.objectHeader.x, layout.objectHeader.y + 15);

  for (const row of layout.objectToolButtons) {
    const active =
      (row.id === "water" && state.editor.activeTool === "pond") ||
      (row.id === "oil" && state.editor.activeTool === "oil") ||
      (row.id === "barrel" && state.editor.activeTool === "barrel") ||
      (row.id === "tree" && state.editor.activeTool === "tree") ||
      (row.id === "spring" && state.editor.activeTool === "spring") ||
      (row.id === "wall" && state.editor.activeTool === "wall") ||
      (row.id === "assets" &&
        (state.editor.activeTool === "asset" || state.editor.assetPaletteOpen));
    drawToolbarButton(row, "", { active });
    ctx.fillStyle = "#dff7ff";
    ctx.font = "bold 20px Verdana";
    ctx.textAlign = "center";
    ctx.fillText(row.icon, row.x + row.width * 0.5, row.y + 22);
  }

  if (layout.assetPalette?.panel) {
    ctx.save();
    ctx.fillStyle = "rgba(9, 18, 24, 0.96)";
    ctx.strokeStyle = "rgba(155, 233, 255, 0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(
      layout.assetPalette.panel.x,
      layout.assetPalette.panel.y,
      layout.assetPalette.panel.width,
      layout.assetPalette.panel.height,
      8,
    );
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#9cb9c8";
    ctx.font = "bold 11px Verdana";
    ctx.textAlign = "left";
    ctx.fillText("ASSETS", layout.assetPalette.panel.x + 10, layout.assetPalette.panel.y + 15);
    for (const item of layout.assetPalette.items) {
      const active = state.editor.selectedAssetKind === item.kind;
      drawToolbarButton(item, "", { active });
      ctx.fillStyle = "#dff7ff";
      ctx.font = "bold 16px Verdana";
      ctx.textAlign = "left";
      ctx.fillText(item.icon, item.x + 10, item.y + 17);
      ctx.fillStyle = "#f4fbff";
      ctx.font = "bold 12px Verdana";
      ctx.fillText(item.label, item.x + 30, item.y + 17);
    }
    ctx.restore();
  }

  drawToolbarButton(layout.objectPrev, "‹");
  drawToolbarButton(layout.objectNext, "›");
  ctx.fillStyle = "#d7ebf7";
  ctx.textAlign = "center";
  ctx.fillText(
    objectLabel,
    layout.objectValue.x + layout.objectValue.width * 0.5,
    layout.objectValue.y + 18,
  );

  drawToolbarButton(layout.objectDeleteButton, "", { active: false });
  ctx.fillStyle = "#dff7ff";
  ctx.font = "bold 18px Verdana";
  ctx.textAlign = "center";
  ctx.fillText(
    "🗑",
    layout.objectDeleteButton.x + layout.objectDeleteButton.width * 0.5,
    layout.objectDeleteButton.y + 19,
  );
  drawToolbarButton(layout.objectSizeDown, "−");
  ctx.fillStyle = "#d7ebf7";
  ctx.font = "bold 12px Verdana";
  ctx.fillText(
    objectValue,
    layout.objectSizeValue.x + layout.objectSizeValue.width * 0.5,
    layout.objectSizeValue.y + 17,
  );
  drawToolbarButton(layout.objectSizeUp, "+");
  drawToolbarButton(layout.rotateLeftButton, "↺");
  drawToolbarButton(layout.rotateRightButton, "↻");

  ctx.fillStyle = "#9cb9c8";
  ctx.font = "bold 12px Verdana";
  ctx.textAlign = "left";
  ctx.fillText("ROAD", layout.roadHeader.x, layout.roadHeader.y + 15);

  drawToolbarButton(layout.roadPrev, "‹");
  drawToolbarButton(layout.roadValue, "", {
    active: state.editor.roadMode !== "checkpoint",
  });
  drawToolbarButton(layout.roadNext, "›");
  ctx.fillStyle = "#d7ebf7";
  ctx.font = "bold 11px Verdana";
  ctx.textAlign = "center";
  ctx.fillText(
    roadLabel,
    layout.roadValue.x + layout.roadValue.width * 0.5,
    layout.roadValue.y + 18,
  );

  drawToolbarButton(layout.checkpointPrev, "‹");
  drawToolbarButton(layout.checkpointValue, "", {
    active: state.editor.roadMode === "checkpoint",
  });
  drawToolbarButton(layout.checkpointNext, "›");
  ctx.fillStyle = "#d7ebf7";
  ctx.font = "bold 11px Verdana";
  ctx.textAlign = "center";
  ctx.fillText(
    checkpointLabel,
    layout.checkpointValue.x + layout.checkpointValue.width * 0.5,
    layout.checkpointValue.y + 18,
  );

  drawToolbarButton(layout.roadDeleteButton, "", { active: false });
  ctx.fillStyle = "#dff7ff";
  ctx.font = "bold 18px Verdana";
  ctx.textAlign = "center";
  ctx.fillText(
    "🗑",
    layout.roadDeleteButton.x + layout.roadDeleteButton.width * 0.5,
    layout.roadDeleteButton.y + 19,
  );
  drawToolbarButton(layout.roadSizeDown, "−");
  ctx.fillStyle = "#d7ebf7";
  ctx.font = "bold 12px Verdana";
  ctx.fillText(
    roadWidth,
    layout.roadSizeValue.x + layout.roadSizeValue.width * 0.5,
    layout.roadSizeValue.y + 17,
  );
  drawToolbarButton(layout.roadSizeUp, "+");

  drawToolbarButton(layout.checkpointDeleteButton, "", { active: false });
  ctx.fillStyle = "#dff7ff";
  ctx.font = "bold 18px Verdana";
  ctx.textAlign = "center";
  ctx.fillText(
    "🗑",
    layout.checkpointDeleteButton.x + layout.checkpointDeleteButton.width * 0.5,
    layout.checkpointDeleteButton.y + 19,
  );

  ctx.fillStyle = "#f0f8ff";
  ctx.textAlign = "left";
  ctx.fillText("Smooth", layout.roadSmoothLabel.x, layout.roadSmoothLabel.y + 18);
  drawToolbarButton(layout.roadSmoothPrev, "‹");
  drawToolbarButton(layout.roadSmoothNext, "›");
  ctx.fillStyle = "#d7ebf7";
  ctx.textAlign = "center";
  ctx.fillText(
    smoothingText,
    layout.roadSmoothValue.x + layout.roadSmoothValue.width * 0.5,
    layout.roadSmoothValue.y + 17,
  );

  ctx.fillStyle = "#f0f8ff";
  ctx.textAlign = "left";
  ctx.fillText("Zoom", layout.zoomLabel.x, layout.zoomLabel.y + 18);
  drawToolbarButton(layout.zoomOut, "-");
  drawToolbarButton(layout.zoomIn, "+");
  ctx.fillStyle = "#d7ebf7";
  ctx.textAlign = "center";
  ctx.font = "bold 12px Verdana";
  ctx.fillText(
    zoomText,
    layout.zoomValue.x + layout.zoomValue.width * 0.5,
    layout.zoomValue.y + 17,
  );
  drawToolbarButton(layout.panToggle, "", { active: state.editor.panMode });
  ctx.fillStyle = "#dff7ff";
  ctx.font = "bold 16px Verdana";
  ctx.fillText("🖐", layout.panToggle.x + layout.panToggle.width * 0.5, layout.panToggle.y + 18);
  ctx.restore();
}

function drawFinishOverlay() {
  if (!state.finished || state.mode !== "racing") return;
  const viewportCenterY = TOP_BAR_HEIGHT + (HEIGHT - TOP_BAR_HEIGHT) * 0.5;
  const total = state.finishCelebration.totalTime || lapData.lapTimes.reduce((a, b) => a + b, 0);
  const bestLap =
    state.finishCelebration.bestLapTime ||
    (lapData.lapTimes.length ? Math.min(...lapData.lapTimes) : 0);
  const finishStack = getFinishCelebrationStandings();
  const stackEntries = finishStack.entries;
  const stackRows = Math.max(1, stackEntries.length);
  const panelW = 696;
  const panelH = Math.max(252, 188 + stackRows * 26);
  const panelX = WIDTH * 0.5 - panelW * 0.5;
  const panelY = viewportCenterY - panelH * 0.5;
  const dividerX = panelX + 344;
  const leftColX = panelX + 28;
  const leftValueX = panelX + 236;
  const leftDetailMaxW = dividerX - leftColX - 36;
  const stackNameX = dividerX + 28;
  const stackTimeX = panelX + panelW - 132;
  const stackGapX = panelX + panelW - 24;
  const stackNameMaxW = stackTimeX - stackNameX - 18;
  const playerPosition = state.raceStandings.playerFinishOrder || getRacePosition();

  ctx.fillStyle = "rgba(12, 22, 18, 0.88)";
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = "rgba(106, 240, 168, 0.28)";
  ctx.lineWidth = 2;
  ctx.strokeRect(panelX + 1, panelY + 1, panelW - 2, panelH - 2);

  ctx.fillStyle = "#6af0a8";
  ctx.font = "bold 40px Verdana";
  ctx.fillText("FINISH!", panelX + 28, panelY + 46);
  ctx.textAlign = "right";
  ctx.font = "bold 18px Verdana";
  ctx.fillStyle = "#dfffee";
  ctx.fillText(`P${playerPosition}`, panelX + 322, panelY + 42);
  ctx.textAlign = "left";

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(dividerX, panelY + 22);
  ctx.lineTo(dividerX, panelY + panelH - 22);
  ctx.stroke();

  const rows = [
    {
      label: "TOTAL",
      value: formatTime(total),
      rewarded: state.finishCelebration.bestRace,
      rewardLabel: "BEST RACE",
      improvementMs: state.finishCelebration.bestRaceImprovementMs,
      previousMs: state.finishCelebration.previousBestRaceMs,
      previousHolder: state.finishCelebration.previousBestRaceDisplayName,
      y: panelY + 92,
    },
    {
      label: "LAP",
      value: formatTime(bestLap),
      rewarded: state.finishCelebration.bestLap,
      rewardLabel: "BEST LAP",
      improvementMs: state.finishCelebration.bestLapImprovementMs,
      previousMs: state.finishCelebration.previousBestLapMs,
      previousHolder: state.finishCelebration.previousBestLapDisplayName,
      y: panelY + 148,
    },
  ];

  for (const row of rows) {
    ctx.fillStyle = row.rewarded ? "#ffe167" : "#f3f8ff";
    ctx.font = "bold 22px Verdana";
    ctx.fillText(`${row.label}`, leftColX, row.y);
    ctx.textAlign = "right";
    ctx.fillText(row.value, leftValueX, row.y);
    ctx.textAlign = "left";

    const detailText = getFinishRecordDetail(row);
    if (detailText) {
      ctx.fillStyle = row.rewarded ? "#fff1a8" : "#c5d0dc";
      ctx.font = "11px Verdana";
      ctx.fillText(fitTextToWidth(detailText, leftDetailMaxW), leftColX, row.y + 18);
    }

    if (!row.rewarded) continue;
    const badgeText = row.rewardLabel;
    ctx.font = "bold 12px Verdana";
    const badgeW = ctx.measureText(badgeText).width + 20;
    const badgeX = leftValueX + 10;
    const badgeY = row.y - 18;
    ctx.fillStyle = "#ffe167";
    ctx.fillRect(badgeX, badgeY, badgeW, 24);
    ctx.fillStyle = "#4e3600";
    ctx.fillText(badgeText, badgeX + 10, badgeY + 16);
  }

  if (!stackEntries.length) {
    ctx.fillStyle = "#f3f8ff";
    ctx.font = "bold 13px Verdana";
    ctx.fillText("WAITING FOR FIRST FINISHER...", stackNameX, panelY + 82);
  } else {
    stackEntries.forEach((entry, index) => {
      const rowY = panelY + 78 + index * 26;
      ctx.fillStyle = entry.accentColor || "#f3f8ff";
      ctx.font = "bold 12px Verdana";
      ctx.fillText(
        fitTextToWidth(`${entry.position}. ${entry.label}`, stackNameMaxW),
        stackNameX,
        rowY,
      );
      ctx.textAlign = "right";
      ctx.fillStyle = "#f3f8ff";
      ctx.fillText(formatTime(entry.finishTime), stackTimeX, rowY);
      ctx.fillStyle = entry.gapMs > 0 ? "#ffe167" : "#6af0a8";
      ctx.fillText(entry.gapMs > 0 ? `+${formatTime(entry.gapMs / 1000)}` : "--", stackGapX, rowY);
      ctx.textAlign = "left";
    });
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = "20px Verdana";
  const isTournament = state.gameMode === "tournament";
  const returnText = isTournament ? "ENTER FOR STANDINGS" : "ENTER TO CONTINUE";
  ctx.fillText(returnText, panelX + 28, panelY + panelH - 24);
}

export function getFinishRecordDetail(row) {
  if (!Number.isFinite(row.previousMs)) {
    return row.rewarded ? "NEW RECORD" : "";
  }

  const previousTime = formatTime(row.previousMs / 1000);
  const previousHolder = String(row.previousHolder || "").trim();

  if (!row.rewarded || !Number.isFinite(row.improvementMs)) {
    if (previousHolder) {
      return `RECORD ${previousHolder} ${previousTime}`;
    }
    return `RECORD ${previousTime}`;
  }

  const improvement = formatTime(row.improvementMs / 1000);
  if (previousHolder) {
    return `-${improvement} vs ${previousHolder} ${previousTime}`;
  }
  return `-${improvement} vs ${previousTime}`;
}

function fitTextToWidth(text, maxWidth) {
  const value = String(text || "");
  if (!value || maxWidth <= 0) return "";
  if (ctx.measureText(value).width <= maxWidth) return value;
  let end = value.length;
  while (end > 0) {
    const candidate = `${value.slice(0, end).trimEnd()}...`;
    if (ctx.measureText(candidate).width <= maxWidth) return candidate;
    end -= 1;
  }
  return "...";
}

function drawPauseOverlay() {
  if (!state.paused || state.mode !== "racing") return;

  if (tournamentRoomActive()) {
    const panelW = 560;
    const panelH = 286;
    const x = WIDTH * 0.5 - panelW * 0.5;
    const y = HEIGHT * 0.5 - panelH * 0.5;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = "rgba(8, 14, 24, 0.94)";
    ctx.fillRect(x, y, panelW, panelH);
    ctx.strokeStyle = "#c4a13c";
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, panelW, panelH);

    ctx.fillStyle = "#ffd25e";
    ctx.font = "bold 52px Verdana";
    ctx.fillText("PAUSED", x + 178, y + 74);

    ctx.fillStyle = "#f0f4fb";
    ctx.font = "bold 24px Verdana";
    const pausedBy =
      typeof state.tournamentRoom.pausedBy === "string" && state.tournamentRoom.pausedBy
        ? `${state.tournamentRoom.pausedBy.toUpperCase()} PAUSED THE RACE`
        : "RACE PAUSED FOR EVERYONE";
    const pausedByWidth = ctx.measureText(pausedBy).width;
    ctx.fillText(pausedBy, x + (panelW - pausedByWidth) * 0.5, y + 122);

    const pauseItems = ["RESUME RACE", "END RACE"];
    ctx.font = "bold 26px Verdana";
    for (let i = 0; i < pauseItems.length; i++) {
      const rowY = y + 164 + i * 46;
      if (i === state.pauseMenuIndex) {
        ctx.fillStyle = i === 0 ? "#3d7ec7" : "#ec4f4f";
        ctx.fillRect(x + 156, rowY - 28, 248, 34);
        ctx.fillStyle = "#ffffff";
      } else {
        ctx.fillStyle = "#b9cde3";
      }
      const labelWidth = ctx.measureText(pauseItems[i]).width;
      ctx.fillText(pauseItems[i], x + (panelW - labelWidth) * 0.5, rowY);
    }

    ctx.fillStyle = "#f0f4fb";
    ctx.font = "18px Verdana";
    const helpText = "W/S OR UP/DOWN: SELECT  ENTER: CONFIRM  P OR ESC: TOGGLE PAUSE";
    const helpWidth = ctx.measureText(helpText).width;
    ctx.fillText(helpText, x + (panelW - helpWidth) * 0.5, y + 248);
    return;
  }

  const panelW = 540;
  const panelH = 310;
  const x = WIDTH * 0.5 - panelW * 0.5;
  const y = HEIGHT * 0.5 - panelH * 0.5;

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "rgba(8, 14, 24, 0.94)";
  ctx.fillRect(x, y, panelW, panelH);
  ctx.strokeStyle = "#c4a13c";
  ctx.lineWidth = 4;
  ctx.strokeRect(x, y, panelW, panelH);

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 54px Verdana";
  ctx.fillText("PAUSED", x + 148, y + 78);

  const pauseItems = ["RESUME RACE", "END RACE"];
  ctx.font = "bold 28px Verdana";
  for (let i = 0; i < pauseItems.length; i++) {
    const rowY = y + 118 + i * 44;
    if (i === state.pauseMenuIndex) {
      ctx.fillStyle = "#ec4f4f";
      ctx.fillRect(x + 130, rowY - 27, 280, 34);
      ctx.fillStyle = "#ffffff";
    } else {
      ctx.fillStyle = "#b9cde3";
    }
    ctx.fillText(pauseItems[i], x + 148, rowY);
  }

  ctx.fillStyle = "#f0f4fb";
  ctx.font = "20px Verdana";
  ctx.fillText("W/S or Up/Down: Accelerate and brake", x + 46, y + 214);
  ctx.fillText("A/D or Left/Right: Steer", x + 46, y + 238);
  ctx.fillText("Space: Handbrake", x + 46, y + 262);
  ctx.fillText("P or Esc: Open pause", x + 46, y + 286);
}

const BREADCRUMB_BAR_HEIGHT = 40;

function drawBreadcrumbBar() {
  const segments = getBreadcrumbs();
  ctx.fillStyle = "rgba(6, 14, 26, 0.88)";
  ctx.fillRect(0, 0, WIDTH, BREADCRUMB_BAR_HEIGHT);
  ctx.strokeStyle = "rgba(255, 210, 94, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, BREADCRUMB_BAR_HEIGHT);
  ctx.lineTo(WIDTH, BREADCRUMB_BAR_HEIGHT);
  ctx.stroke();

  ctx.font = "bold 16px Verdana";
  let x = 18;
  const y = 26;
  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    ctx.fillStyle = isLast ? "#ffd25e" : "#8aa4b8";
    ctx.fillText(segments[i], x, y);
    x += ctx.measureText(segments[i]).width;
    if (!isLast) {
      ctx.fillStyle = "#5a7a90";
      ctx.fillText("  ›  ", x, y);
      x += ctx.measureText("  ›  ").width;
    }
  }
}

function drawGameModeSelect() {
  ctx.fillStyle = "#0f2640";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();
  drawBreadcrumbBar();

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 70px Verdana";
  const titleText = "GAME MODE";
  const titleWidth = ctx.measureText(titleText).width;
  ctx.fillText(titleText, WIDTH * 0.5 - titleWidth * 0.5, 160);

  ctx.font = "bold 42px Verdana";
  const { items, selectedIndex, highlightWidth } = getGameModeRenderModel(
    (text) => ctx.measureText(text).width,
  );
  const highlightX = WIDTH * 0.5 - highlightWidth * 0.5;
  items.forEach((item, idx) => {
    const y = 280 + idx * 80;
    const textWidth = ctx.measureText(item).width;
    const textX = WIDTH * 0.5 - textWidth * 0.5;
    if (idx === selectedIndex) {
      ctx.fillStyle = "#ec4f4f";
      ctx.fillRect(highlightX, y - 43, highlightWidth, 56);
      ctx.fillStyle = "#ffffff";
    } else {
      ctx.fillStyle = "#8aa4b8";
    }
    ctx.fillText(item, textX, y);
  });
}

function drawTournamentStandings() {
  ctx.fillStyle = "#0f2640";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();
  drawBreadcrumbBar();

  const data = getTournamentStandingsData();

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 48px Verdana";
  const titleText = `Race ${data.raceIndex} of ${data.totalRaces}`;
  const titleWidth = ctx.measureText(titleText).width;
  ctx.fillText(titleText, WIDTH * 0.5 - titleWidth * 0.5, 120);

  ctx.fillStyle = "#d8e8f7";
  ctx.font = "bold 28px Verdana";
  const subtitleText = "STANDINGS";
  const subtitleWidth = ctx.measureText(subtitleText).width;
  ctx.fillText(subtitleText, WIDTH * 0.5 - subtitleWidth * 0.5, 170);

  const panelX = WIDTH * 0.5 - 260;
  const panelW = 520;
  const rowH = 56;
  const startY = 210;

  ctx.fillStyle = "rgba(8, 18, 34, 0.72)";
  ctx.fillRect(panelX, startY - 10, panelW, data.sorted.length * rowH + 20);

  data.sorted.forEach((entry, idx) => {
    const y = startY + idx * rowH + 38;
    const isFirst = idx === 0;
    const racePoints = data.lastResult[entry.name]?.points ?? 0;

    // Medal/rank
    ctx.font = "bold 28px Verdana";
    ctx.fillStyle = isFirst ? "#ffd25e" : "#c3d9ec";
    ctx.fillText(`${idx + 1}.`, panelX + 20, y);

    // Name
    ctx.fillStyle = isFirst ? "#ffffff" : "#c3d9ec";
    ctx.fillText(entry.name, panelX + 70, y);

    // This race points
    ctx.font = "20px Verdana";
    ctx.fillStyle = "#6af0a8";
    ctx.fillText(`+${racePoints}`, panelX + 320, y);

    // Total
    ctx.font = "bold 28px Verdana";
    ctx.fillStyle = isFirst ? "#ffd25e" : "#c3d9ec";
    ctx.fillText(`${entry.total} pts`, panelX + 400, y);
  });

  const moreRaces = data.raceIndex < data.totalRaces;
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px Verdana";
  const hint = moreRaces ? "ENTER for next race" : "ENTER for final results";
  const hintWidth = ctx.measureText(hint).width;
  ctx.fillText(hint, WIDTH * 0.5 - hintWidth * 0.5, HEIGHT - 50);
}

function drawTournamentLobby() {
  drawBreadcrumbBar();
  ctx.fillStyle = "#122433";
  ctx.fillRect(0, BREADCRUMB_BAR_HEIGHT, WIDTH, HEIGHT - BREADCRUMB_BAR_HEIGHT);
  drawPixelNoise();

  const room = state.tournamentRoom;
  const titleY = BREADCRUMB_BAR_HEIGHT + 60;
  ctx.fillStyle = "#ffe167";
  ctx.font = "bold 46px Verdana";
  ctx.fillText("TOURNAMENT LOBBY", 54, titleY);

  ctx.fillStyle = "#d7e6f3";
  ctx.font = "18px Verdana";
  ctx.fillText(`STATUS ${String(room.status || "idle").toUpperCase()}`, 56, titleY + 30);

  const cardX = 56;
  const cardY = titleY + 50;
  const cardW = WIDTH - 112;
  const rowH = 50;
  const rowGap = 8;
  const slots = Array.isArray(room.slots) ? room.slots : [];

  slots.forEach((slot, index) => {
    const y = cardY + index * (rowH + rowGap);
    const selected = state.tournamentLobbyIndex === index;
    ctx.fillStyle = selected ? "rgba(61, 126, 199, 0.42)" : "rgba(10, 18, 28, 0.46)";
    ctx.fillRect(cardX, y, cardW, rowH);
    ctx.strokeStyle = selected ? "#ffffff" : "rgba(149, 181, 204, 0.65)";
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeRect(cardX, y, cardW, rowH);

    const accent = slot.kind === "human" ? (slot.is_host ? "#ffe167" : "#7ee2ff") : "#9cc8a3";
    const slotColor = getCarColorHex(slot.color);
    ctx.fillStyle = accent;
    ctx.font = "bold 12px Verdana";
    ctx.fillText(slot.kind === "human" ? "HUMAN" : "AI", cardX + 18, y + 18);

    const colorChipSize = 16;
    const colorChipX = cardX + 18;
    const colorChipY = y + 24;
    ctx.fillStyle = slotColor;
    ctx.fillRect(colorChipX, colorChipY, colorChipSize, colorChipSize);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.lineWidth = 2;
    ctx.strokeRect(colorChipX, colorChipY, colorChipSize, colorChipSize);

    ctx.fillStyle = "#f4fbff";
    ctx.font = "bold 20px Verdana";
    ctx.fillText(slot.display_name || "PLAYER", colorChipX + colorChipSize + 12, y + 39);

    ctx.fillStyle = "#b9ccdc";
    ctx.font = "15px Verdana";
    const detail =
      slot.kind === "human"
        ? slot.connected === false
          ? "Disconnected"
          : slot.is_host
            ? "Host"
            : "Joined"
        : `${String(slot.style || "precise").toUpperCase()}  SPD x${Number(
            slot.top_speed_mul || 1,
          ).toFixed(2)}`;
    const detailWidth = ctx.measureText(detail).width;
    ctx.fillText(detail, cardX + cardW - detailWidth - 20, y + 32);
  });

  const buttonY = HEIGHT - 94;
  const shareSelected = state.tournamentLobbyIndex === slots.length;
  const startSelected = room.isHost && state.tournamentLobbyIndex === slots.length + 1;

  const shareX = 56;
  const shareW = 190;
  ctx.fillStyle = shareSelected ? "#3d7ec7" : "#21394d";
  ctx.fillRect(shareX, buttonY, shareW, 48);
  ctx.strokeStyle = shareSelected ? "#ffffff" : "#8aa8bf";
  ctx.lineWidth = shareSelected ? 3 : 2;
  ctx.strokeRect(shareX, buttonY, shareW, 48);
  ctx.fillStyle = "#f4fbff";
  ctx.font = "bold 22px Verdana";
  ctx.fillText("SHARE URL", shareX + 22, buttonY + 31);

  if (room.isHost) {
    const startX = shareX + shareW + 18;
    const startW = 340;
    ctx.fillStyle = startSelected ? "#2f7e45" : "#244737";
    ctx.fillRect(startX, buttonY, startW, 48);
    ctx.strokeStyle = startSelected ? "#ffffff" : "#9cd3aa";
    ctx.lineWidth = startSelected ? 3 : 2;
    ctx.strokeRect(startX, buttonY, startW, 48);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("START TOURNAMENT", startX + 32, buttonY + 31);
  }
}

function drawTournamentFinal() {
  ctx.fillStyle = "#0a1c2e";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();
  drawBreadcrumbBar();

  const data = getTournamentStandingsData();

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 60px Verdana";
  const titleText = "TOURNAMENT RESULTS";
  const titleWidth = ctx.measureText(titleText).width;
  ctx.fillText(titleText, WIDTH * 0.5 - titleWidth * 0.5, 130);

  const medals = ["🥇", "🥈", "🥉"];
  const medalColors = ["#ffd25e", "#c0c0c0", "#cd7f32"];
  const panelX = WIDTH * 0.5 - 280;
  const panelW = 560;
  const rowH = 72;
  const startY = 190;

  ctx.fillStyle = "rgba(8, 18, 34, 0.72)";
  ctx.fillRect(panelX, startY - 10, panelW, data.sorted.length * rowH + 20);

  data.sorted.forEach((entry, idx) => {
    const y = startY + idx * rowH + 48;

    // Medal or rank
    if (idx < 3) {
      ctx.font = "36px Verdana";
      ctx.fillText(medals[idx], panelX + 16, y);
    } else {
      ctx.font = "bold 30px Verdana";
      ctx.fillStyle = "#8aa4b8";
      ctx.fillText(`${idx + 1}.`, panelX + 22, y);
    }

    // Name
    ctx.font = "bold 32px Verdana";
    ctx.fillStyle = idx < 3 ? medalColors[idx] : "#c3d9ec";
    ctx.fillText(entry.name, panelX + 80, y);

    // Total points
    ctx.font = "bold 30px Verdana";
    ctx.fillStyle = idx === 0 ? "#ffd25e" : "#c3d9ec";
    ctx.fillText(`${entry.total} pts`, panelX + 380, y);
  });

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px Verdana";
  const hint = "ENTER to return to menu";
  const hintWidth = ctx.measureText(hint).width;
  ctx.fillText(hint, WIDTH * 0.5 - hintWidth * 0.5, HEIGHT - 50);

  drawScreenParticles(ctx);
}

function drawMenu() {
  ctx.fillStyle = "#0f2640";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();

  if (appLogoReady) {
    const maxLogoWidth = 320;
    const maxLogoHeight = 130;
    const ratio = Math.min(maxLogoWidth / appLogo.width, maxLogoHeight / appLogo.height);
    const drawWidth = appLogo.width * ratio;
    const drawHeight = appLogo.height * ratio;
    ctx.drawImage(appLogo, WIDTH * 0.5 - drawWidth * 0.5, 22, drawWidth, drawHeight);
  }

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 118px Verdana";
  ctx.fillText("CARUN", WIDTH / 2 - 245, 250);

  const menuTagline = activeMenuTagline();
  if (menuTagline.text && menuTagline.alpha > 0) {
    ctx.save();
    ctx.globalAlpha = menuTagline.alpha;
    ctx.fillStyle = "#d8e8f7";
    ctx.font = "italic 30px Verdana";
    const taglineWidth = ctx.measureText(menuTagline.text).width;
    ctx.fillText(menuTagline.text, WIDTH * 0.5 - taglineWidth * 0.5, 306);
    ctx.restore();
  }

  ctx.font = "bold 42px Verdana";
  const { menuItems, selectedMenuIndex, highlightWidth } = getMainMenuRenderModel(
    (text) => ctx.measureText(text).width,
  );
  const highlightX = WIDTH * 0.5 - highlightWidth * 0.5;
  menuItems.forEach((item, idx) => {
    const y = 386 + idx * 74;
    ctx.fillStyle = idx === selectedMenuIndex ? "#ffffff" : "#8aa4b8";
    const textWidth = ctx.measureText(item).width;
    const textX = WIDTH * 0.5 - textWidth * 0.5;
    if (idx === selectedMenuIndex) {
      ctx.fillStyle = "#ec4f4f";
      ctx.fillRect(highlightX, y - 43, highlightWidth, 56);
      ctx.fillStyle = "#ffffff";
    }
    ctx.fillText(item, textX, y);
  });

  if (state.auth.authenticated && state.auth.displayName) {
    ctx.save();
    ctx.font = "16px Verdana";
    ctx.fillStyle = "rgba(235, 245, 255, 0.82)";
    const authLabel = `SIGNED IN: ${state.auth.displayName}`;
    const labelWidth = ctx.measureText(authLabel).width;
    ctx.fillText(authLabel, WIDTH - labelWidth - 18, HEIGHT - 40);
    ctx.restore();
  }

  if (state.buildLabel) {
    ctx.save();
    ctx.font = "14px Verdana";
    ctx.fillStyle = "rgba(235, 245, 255, 0.75)";
    const w = ctx.measureText(state.buildLabel).width;
    ctx.fillText(state.buildLabel, WIDTH - w - 18, HEIGHT - 20);
    ctx.restore();
  }
}

function drawTrackPreviewCard(x, y, size, selected, preset) {
  const trackDef = preset.track;
  const { boundaries, curbs } = getPreviewTrackData(preset);
  ctx.save();
  ctx.fillStyle = selected ? "#244864" : "#1a3347";
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = selected ? "#f2d26c" : "#6c879b";
  ctx.lineWidth = selected ? 5 : 3;
  ctx.strokeRect(x, y, size, size);

  const pad = 18;
  const innerX = x + pad;
  const innerY = y + pad;
  const innerSize = size - pad * 2;

  ctx.beginPath();
  ctx.rect(innerX, innerY, innerSize, innerSize);
  ctx.clip();
  ctx.fillStyle = "#2e8c42";
  ctx.fillRect(innerX, innerY, innerSize, innerSize);

  const { minX, minY, maxX, maxY } = getPreviewBounds(preset, boundaries, curbs);

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const scale = Math.min(
    innerSize / Math.max(maxX - minX, 1),
    innerSize / Math.max(maxY - minY, 1),
  );
  const cardCenterX = innerX + innerSize * 0.5;
  const cardCenterY = innerY + innerSize * 0.5;
  ctx.save();
  ctx.translate(cardCenterX, cardCenterY);
  ctx.scale(scale, scale);
  ctx.translate(-centerX, -centerY);
  applyWorldScaleTransform(trackDef);
  drawTrackSurface(trackDef, boundaries, curbs, true, preset.worldObjects || []);
  drawDecor(preset.worldObjects || []);
  drawRoadDetails(trackDef);
  drawStartLine(trackDef);
  ctx.restore();

  ctx.restore();
}

function drawLoginProviders() {
  ctx.fillStyle = "#13283a";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();
  drawBreadcrumbBar();

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 84px Verdana";
  ctx.fillText("LOGIN", WIDTH * 0.5 - 132, 220);

  ctx.font = "bold 38px Verdana";
  const { loginItems, selectedLoginIndex, highlightWidth } = getLoginProviderRenderModel(
    (text) => ctx.measureText(text).width,
  );
  const highlightX = WIDTH * 0.5 - highlightWidth * 0.5;
  const textX = WIDTH * 0.5;
  const iconX = highlightX + 26;
  loginItems.forEach((item, idx) => {
    const y = 352 + idx * 84;
    const selected = idx === selectedLoginIndex;
    if (selected) {
      ctx.fillStyle = "#ec4f4f";
      ctx.fillRect(highlightX, y - 44, highlightWidth, 58);
    }

    if (item === "LOGIN WITH FACEBOOK" && facebookLogoReady) {
      ctx.drawImage(facebookLogo, iconX, y - 33, 32, 32);
    } else if (item === "LOGIN WITH GOOGLE") {
      ctx.fillStyle = selected ? "#ffffff" : "#9db6c7";
      ctx.font = "bold 24px Verdana";
      ctx.fillText("G", iconX + 6, y - 6);
      ctx.font = "bold 38px Verdana";
    }

    ctx.fillStyle = selected ? "#ffffff" : "#9db6c7";
    const width = ctx.measureText(item).width;
    ctx.fillText(item, textX - width * 0.5, y);
  });
}

function drawTrackSelection() {
  ctx.fillStyle = "#11283e";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();
  drawBreadcrumbBar();

  const model = getTrackSelectRenderModel();
  const cardSize = model.cardSize;
  const gap = model.cardGap;
  const labelH = model.labelHeight;
  const rows = model.rows;

  // Title
  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 36px Verdana";
  const titleText = model.isTournament ? "SELECT TRACKS" : "SELECT TRACK";
  const titleWidth = ctx.measureText(titleText).width;
  ctx.fillText(titleText, WIDTH * 0.35 - titleWidth * 0.5, BREADCRUMB_BAR_HEIGHT + 38);

  // Grid area
  const gridTop = BREADCRUMB_BAR_HEIGHT + 56;
  const colWidth = cardSize + gap;
  const gridLeftMargin = 40;
  const gridWidth = model.visibleColumns * colWidth - gap;
  const startX = gridLeftMargin;

  // Draw grid cards
  for (let i = 0; i < model.gridCells.length; i++) {
    const cell = model.gridCells[i];
    const cardX = startX + cell.column * colWidth;
    const cardY = gridTop + cell.row * (cardSize + labelH + gap);
    const selected = state.trackSelectIndex === cell.trackIndex;

    drawTrackPreviewCard(cardX, cardY, cardSize, selected, getTrackPreset(cell.trackIndex));

    // Track name label
    ctx.fillStyle = selected ? "#ffffff" : "#9db6c7";
    ctx.font = "bold 13px Verdana";
    const label = cell.option.name;
    const labelWidth = ctx.measureText(label).width;
    ctx.fillText(label, cardX + cardSize * 0.5 - labelWidth * 0.5, cardY + cardSize + 16);

    // Private badge
    if (!cell.option.isPublished) {
      ctx.fillStyle = "#f26b6b";
      ctx.fillRect(cardX + 4, cardY + 4, 56, 16);
      ctx.fillStyle = "#3d1010";
      ctx.font = "bold 9px Verdana";
      ctx.fillText("PRIVATE", cardX + 10, cardY + 15);
    }

    // Tournament checkbox
    if (model.isTournament) {
      const checkX = cardX + cardSize - 24;
      const checkY = cardY + 4;
      const checked = model.tournamentSelected.has(cell.trackIndex);
      ctx.fillStyle = checked ? "#6af0a8" : "rgba(255,255,255,0.15)";
      ctx.fillRect(checkX, checkY, 20, 20);
      ctx.strokeStyle = checked ? "#2e8c42" : "#8aa4b8";
      ctx.lineWidth = 2;
      ctx.strokeRect(checkX, checkY, 20, 20);
      if (checked) {
        ctx.fillStyle = "#0a3018";
        ctx.font = "bold 14px Verdana";
        ctx.fillText("✓", checkX + 4, checkY + 16);
      }
    }
  }

  // Left/right scroll hints
  if (model.showLeftHint) {
    ctx.fillStyle = "#ffd25e";
    ctx.font = "bold 34px Verdana";
    ctx.fillText("\u2039", startX - 30, gridTop + rows * (cardSize + labelH + gap) * 0.5);
  }
  if (model.showRightHint) {
    ctx.fillStyle = "#ffd25e";
    ctx.font = "bold 34px Verdana";
    ctx.fillText(
      "\u203a",
      startX + gridWidth + 12,
      gridTop + rows * (cardSize + labelH + gap) * 0.5,
    );
  }

  // Bottom buttons
  const buttonsY = HEIGHT - 56;

  // Start tournament button (left side, only in tournament mode)
  if (model.isTournament) {
    const startTournamentIdx = trackOptions.length + 1;
    const startSelected = state.trackSelectIndex === startTournamentIdx;
    const selectedCount = model.tournamentSelected.size;
    const startLabel =
      selectedCount > 0 ? `START TOURNAMENT (${selectedCount})` : "START TOURNAMENT";
    ctx.font = "bold 28px Verdana";
    const startBtnW = ctx.measureText(startLabel).width + 40;
    const startBtnX = 40;
    if (selectedCount > 0) {
      if (startSelected) {
        ctx.fillStyle = "#2e8c42";
        ctx.fillRect(startBtnX, buttonsY - 34, startBtnW, 44);
      }
      ctx.fillStyle = startSelected ? "#ffffff" : "#6af0a8";
      ctx.fillText(startLabel, startBtnX + 20, buttonsY);
    } else {
      ctx.fillStyle = "#5a7a90";
      ctx.fillText(startLabel, startBtnX + 20, buttonsY);
    }
  }

  // Back button (right side)
  const backIndex = trackOptions.length;
  const backSelected = state.trackSelectIndex === backIndex;
  const backWidth = 160;
  const backX = WIDTH - backWidth - 320 - 40;
  if (backSelected) {
    ctx.fillStyle = "#ec4f4f";
    ctx.fillRect(backX, buttonsY - 34, backWidth, 44);
  }
  ctx.fillStyle = backSelected ? "#ffffff" : "#8aa4b8";
  ctx.font = "bold 28px Verdana";
  ctx.fillText("BACK", backX + 36, buttonsY);

  // Detail panel (bottom-right)
  const detailPanelX = WIDTH - 320;
  const detailPanelY = gridTop + 10;
  const detailPanelW = 300;
  const detailPanelH = rows * (cardSize + labelH + gap) - gap;

  if (state.trackSelectIndex >= 0 && state.trackSelectIndex < trackOptions.length) {
    const selectedPreset = getTrackPreset(state.trackSelectIndex);
    const selectedOption = trackOptions[state.trackSelectIndex];
    const ownerName = selectedOption?.ownerDisplayName || "N/A";
    const bestLapText = Number.isFinite(selectedOption?.bestLapMs)
      ? `${selectedOption.bestLapDisplayName || "UNKNOWN"} - ${formatTime(
          selectedOption.bestLapMs / 1000,
        )}`
      : "No laps yet";
    const bestRaceText = Number.isFinite(selectedOption?.bestRaceMs)
      ? `${selectedOption.bestRaceDisplayName || "UNKNOWN"} - ${formatTime(
          selectedOption.bestRaceMs / 1000,
        )}`
      : "No races yet";

    let centerlineLength = centerlineLengthCache.get(selectedPreset.track);
    if (!Number.isFinite(centerlineLength)) {
      const boundaries = trackBoundaryPaths(selectedPreset.track, TRACK_SEGMENTS);
      const points = boundaries.center || [];
      let total = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        total += Math.hypot(b.x - a.x, b.y - a.y);
      }
      centerlineLength = total;
      centerlineLengthCache.set(selectedPreset.track, centerlineLength);
    }

    // Panel background
    ctx.fillStyle = "rgba(8, 18, 34, 0.72)";
    ctx.fillRect(detailPanelX, detailPanelY, detailPanelW, detailPanelH);
    ctx.strokeStyle = "rgba(255, 210, 94, 0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(detailPanelX, detailPanelY, detailPanelW, detailPanelH);

    const sx = detailPanelX + 16;
    let sy = detailPanelY + 28;

    // Track name
    ctx.fillStyle = "#ffd25e";
    ctx.font = "bold 22px Verdana";
    ctx.fillText(selectedOption.name, sx, sy);
    sy += 36;

    const distanceMeters = centerlineLength / 15;
    const distanceLabel = Number.isInteger(distanceMeters)
      ? `${distanceMeters} m`
      : `${distanceMeters.toFixed(1)} m`;
    ctx.fillStyle = "#d8e7f5";
    ctx.font = "bold 16px Verdana";
    ctx.fillText(`Owner: ${ownerName}`, sx, sy);
    sy += 24;
    ctx.fillText(`Distance: ${distanceLabel}`, sx, sy);
    sy += 24;
    ctx.fillText(`\u{1F947}lap: ${bestLapText}`, sx, sy);
    sy += 24;
    ctx.fillText(`\u{1F3C6}race: ${bestRaceText}`, sx, sy);
    sy += 36;

    // AI toggle for single race mode
    if (!model.isTournament) {
      ctx.fillStyle = "#c3d9ec";
      ctx.font = "bold 16px Verdana";
      const configuredAiCount = Math.max(
        MIN_AI_OPPONENT_COUNT,
        Math.min(
          MAX_AI_OPPONENT_COUNT,
          Math.round(Number(physicsConfig.flags.AI_OPPONENT_COUNT) || DEFAULT_AI_OPPONENT_COUNT),
        ),
      );
      const aiLabel = aiOpponentsEnabled()
        ? `AI Opponents: ON (${configuredAiCount})`
        : `AI Opponents: OFF (${configuredAiCount})`;
      ctx.fillText(aiLabel, sx, sy);
      sy += 20;
      ctx.fillStyle = "#8aa4b8";
      ctx.font = "14px Verdana";
      ctx.fillText("Press A to toggle", sx, sy);
      sy += 24;
    } else {
      ctx.fillStyle = "#6af0a8";
      ctx.font = "bold 16px Verdana";
      ctx.fillText("AI Opponents: ALWAYS ON", sx, sy);
      sy += 24;
    }

    // Help lines inside the panel
    const helpLines = [];
    const deleteKeyLabel = (() => {
      if (typeof navigator === "undefined") return "DEL";
      const platform =
        typeof navigator.userAgentData?.platform === "string"
          ? navigator.userAgentData.platform
          : typeof navigator.platform === "string"
            ? navigator.platform
            : "";
      return /mac/i.test(platform) ? "⌫" : "DEL";
    })();
    if (model.selectedTrackCanDelete) helpLines.push(`${deleteKeyLabel} Delete`);
    if (model.selectedTrackCanPublish) {
      helpLines.push(model.selectedTrackIsPublished ? "P Unpublish" : "P Publish");
    }
    if (physicsConfig.flags.DEBUG_MODE) helpLines.push("E Edit");
    if (model.selectedTrackCanClearRecords) helpLines.push("X Clear Records");
    if (model.selectedTrackCanRename) helpLines.push("R Rename");
    if (helpLines.length > 0) {
      sy += 8;
      ctx.font = "13px Verdana";
      ctx.fillStyle = "#8aa4b8";
      for (let i = 0; i < helpLines.length; i++) {
        ctx.fillText(helpLines[i], sx, sy + i * 18);
      }
    }
  }
}

function drawStroke(stroke, color, lineWidth) {
  if (!stroke || stroke.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(stroke[0].x, stroke[0].y);
  for (let i = 1; i < stroke.length; i++) {
    ctx.lineTo(stroke[i].x, stroke[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawEditorOverlay() {
  const preset = getTrackPreset(state.editor.trackIndex);
  const strokes = preset.centerlineStrokes || [];
  const checkpointsList = preset.checkpoints || [];
  const connectedLoop = getConnectedCenterlinePoints(strokes);
  const smoothedLoop = Array.isArray(preset.track?.centerlineLoop)
    ? preset.track.centerlineLoop
    : [];
  if (state.editor.showCurbs && smoothedLoop.length >= 2) {
    drawStroke([...smoothedLoop, smoothedLoop[0]], "rgba(92, 255, 124, 0.95)", 3);
  }
  drawStroke(connectedLoop, "rgba(96, 248, 255, 0.78)", 2);
  const flash = state.editor.selectionFlash;
  const selectedStrokeIndex =
    state.editor.latestEditTarget?.kind === "stroke"
      ? state.editor.latestEditTarget.strokeIndex
      : -1;
  const selectedCheckpointIndex =
    state.editor.latestEditTarget?.kind === "checkpoint"
      ? state.editor.latestEditTarget.checkpointIndex
      : -1;
  for (const [index, stroke] of strokes.entries()) {
    const baseColor = index % 2 === 0 ? "rgba(255, 163, 72, 0.92)" : "rgba(120, 228, 255, 0.92)";
    const shouldFlash =
      selectedStrokeIndex === index &&
      flash.kind === "stroke" &&
      flash.index === index &&
      flash.time > 0 &&
      Math.floor(flash.time / 0.08) % 2 === 0;
    drawStroke(stroke, shouldFlash ? "rgba(255, 225, 103, 0.98)" : baseColor, 4);
  }
  for (const [index, checkpoint] of checkpointsList.entries()) {
    const frame = checkpointFrame(checkpoint, preset.track);
    const halfSpan = frame.roadWidth * CHECKPOINT_WIDTH_MULTIPLIER * 0.5;
    const ax = frame.point.x - frame.normal.x * halfSpan;
    const ay = frame.point.y - frame.normal.y * halfSpan;
    const bx = frame.point.x + frame.normal.x * halfSpan;
    const by = frame.point.y + frame.normal.y * halfSpan;
    const shouldFlash =
      selectedCheckpointIndex === index &&
      flash.kind === "checkpoint" &&
      flash.index === index &&
      flash.time > 0 &&
      Math.floor(flash.time / 0.08) % 2 === 0;
    const selected = selectedCheckpointIndex === index;
    ctx.save();
    ctx.strokeStyle = shouldFlash
      ? "rgba(255, 225, 103, 0.98)"
      : selected
        ? "rgba(255, 240, 140, 0.98)"
        : "rgba(143, 223, 255, 0.92)";
    ctx.lineWidth = selected ? 5 : 3;
    ctx.setLineDash(selected ? [] : [9, 6]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.fillStyle = selected ? "#fff0a8" : "#d7ebf7";
    ctx.font = "bold 12px Verdana";
    ctx.textAlign = "center";
    ctx.fillText(`${index + 1}`, frame.point.x, frame.point.y - 8);
    ctx.restore();
  }
  drawStroke(state.editor.activeStroke, "rgba(255, 255, 255, 0.95)", 3);

  const cx = state.editor.cursorX;
  const cy = state.editor.cursorY;
  ctx.save();
  ctx.strokeStyle =
    state.editor.roadMode === "checkpoint"
      ? "rgba(255, 225, 103, 0.96)"
      : "rgba(255, 255, 255, 0.92)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy);
  ctx.lineTo(cx + 12, cy);
  ctx.moveTo(cx, cy - 12);
  ctx.lineTo(cx, cy + 12);
  ctx.stroke();
  ctx.restore();
}

function drawEditor() {
  drawEditorTitleBar();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, TOP_BAR_HEIGHT, WIDTH, HEIGHT - TOP_BAR_HEIGHT);
  ctx.clip();
  ctx.translate(0, TOP_BAR_HEIGHT);
  ctx.fillStyle = "#2e8c42";
  ctx.fillRect(0, 0, WIDTH, HEIGHT - TOP_BAR_HEIGHT);
  drawPixelNoise();
  ctx.save();
  applyWorldTransform(track, getEditorCameraState(track));
  drawTrack();
  drawEditorOverlay();
  ctx.restore();
  drawEditorToolbar();
  ctx.restore();
}

function drawSettings() {
  ctx.fillStyle = "#142a36";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();
  drawBreadcrumbBar();

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 76px Verdana";
  const settingsHeader = getSettingsHeaderRenderModel();
  ctx.save();
  ctx.textAlign = settingsHeader.textAlign;
  ctx.fillText(settingsHeader.text, WIDTH * settingsHeader.xRatio, settingsHeader.y);
  ctx.restore();

  const menuTagline = activeMenuTagline();
  if (menuTagline.text && menuTagline.alpha > 0) {
    ctx.save();
    ctx.globalAlpha = menuTagline.alpha;
    ctx.fillStyle = "#d7e9f4";
    ctx.font = "italic 28px Verdana";
    const taglineWidth = ctx.measureText(menuTagline.text).width;
    ctx.fillText(menuTagline.text, WIDTH * 0.5 - taglineWidth * 0.5, 248);
    ctx.restore();
  }

  ctx.font = "bold 35px Verdana";
  const { settingsItems, selectedSettingsIndex, rowLabels, rowGap, startY, highlightWidth } =
    getSettingsRenderLayout((text) => ctx.measureText(text).width);
  const highlightX = WIDTH * 0.5 - highlightWidth * 0.5;
  const textX = highlightX + 30;
  settingsItems.forEach((_, idx) => {
    const y = startY + idx * rowGap;
    const item = settingsItems[idx];
    if (idx === selectedSettingsIndex) {
      ctx.fillStyle = "#3d7ec7";
      ctx.fillRect(highlightX, y - 42, highlightWidth, 56);
      ctx.fillStyle = item === "PLAYER COLOR" ? playerAccentColor() : "#ffffff";
    } else {
      ctx.fillStyle = item === "PLAYER COLOR" ? playerAccentColor() : "#9db6c7";
    }
    ctx.fillText(rowLabels[idx], textX, y);
  });
}

function drawSnackbar() {
  if (!state.snackbar.text || state.snackbar.time <= 0) return;
  const text = state.snackbar.text;
  const kind = state.snackbar.kind || "info";
  const isError = kind === "error";
  const isSuccess = kind === "success";
  const alpha = Math.min(1, state.snackbar.time / 0.25);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "bold 22px Verdana";
  const paddingX = 22;
  const width = ctx.measureText(text).width + paddingX * 2;
  const height = 44;
  const x = WIDTH * 0.5 - width * 0.5;
  const y = HEIGHT - 58;
  ctx.fillStyle = isError
    ? "rgba(128, 22, 34, 0.95)"
    : isSuccess
      ? "rgba(20, 106, 54, 0.9)"
      : "rgba(8, 16, 24, 0.85)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = isError
    ? "rgba(255, 171, 171, 0.95)"
    : isSuccess
      ? "rgba(176, 244, 194, 0.85)"
      : "rgba(255, 255, 255, 0.42)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = isError ? "#fff3f3" : "#f2fbff";
  ctx.fillText(text, x + paddingX, y + 30);
  ctx.restore();
}

function drawWrappedText(text, x, y, maxWidth, lineHeight) {
  const words = String(text || "").split(/\s+/);
  let line = "";
  let lineIndex = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) {
      ctx.fillText(line, x, y + lineIndex * lineHeight);
      lineIndex += 1;
    }
    line = word;
  }
  if (line) {
    ctx.fillText(line, x, y + lineIndex * lineHeight);
    lineIndex += 1;
  }
  return lineIndex;
}

function drawModal() {
  if (!state.modal.open) return;

  const panelW = 620;
  const panelH = state.modal.mode === "input" ? 340 : 270;
  const x = WIDTH * 0.5 - panelW * 0.5;
  const y = HEIGHT * 0.5 - panelH * 0.5;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "#102132";
  ctx.fillRect(x, y, panelW, panelH);
  ctx.strokeStyle = "#d5e4f1";
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, panelW, panelH);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 38px Verdana";
  ctx.fillText(state.modal.title || "Confirm", x + 34, y + 58);

  ctx.fillStyle = "#c7d8e8";
  ctx.font = "24px Verdana";
  const infoLines = drawWrappedText(state.modal.message || "", x + 34, y + 108, panelW - 68, 34);

  let contentBottomY = y + 108 + infoLines * 34;
  if (state.modal.mode === "input") {
    const inputY = contentBottomY + 12;
    const inputH = 44;
    const inputW = panelW - 68;
    const inputX = x + 34;
    const value = state.modal.inputValue || "";
    const placeholder = state.modal.inputPlaceholder || "";
    const inputText = value || placeholder || "Type here...";
    ctx.fillStyle = "#0d1e2b";
    ctx.fillRect(inputX, inputY, inputW, inputH);
    ctx.strokeStyle = "#89a6be";
    ctx.lineWidth = 2;
    ctx.strokeRect(inputX, inputY, inputW, inputH);
    ctx.fillStyle = value ? "#f4fbff" : "#7d95a9";
    ctx.font = "bold 24px Verdana";
    ctx.fillText(inputText, inputX + 14, inputY + 30);
    contentBottomY = inputY + inputH;
  }

  const noSelected = state.modal.selectedAction === "cancel";
  const yesSelected = state.modal.selectedAction === "confirm";
  const cancelLabel = state.modal.cancelLabel || "No";
  const confirmLabel = state.modal.confirmLabel || "Yes";
  const buttonY = contentBottomY + 26;
  const buttonH = 48;
  const buttonGap = 16;
  const buttonPadX = 22;
  const minButtonW = 96;
  ctx.font = "bold 24px Verdana";
  const cancelW = Math.max(minButtonW, ctx.measureText(cancelLabel).width + buttonPadX * 2);
  const confirmW = Math.max(minButtonW, ctx.measureText(confirmLabel).width + buttonPadX * 2);
  const rightEdge = x + panelW - 34;
  const yesX = rightEdge - confirmW;
  const noX = yesX - buttonGap - cancelW;

  ctx.fillStyle = noSelected ? "#2f4b61" : "#21394d";
  ctx.fillRect(noX, buttonY, cancelW, buttonH);
  ctx.strokeStyle = noSelected ? "#ffffff" : "#8aa8bf";
  ctx.lineWidth = noSelected ? 3 : 2;
  ctx.strokeRect(noX, buttonY, cancelW, buttonH);
  ctx.fillStyle = "#f0f7ff";
  ctx.font = "bold 24px Verdana";
  ctx.fillText(
    cancelLabel,
    noX + (cancelW - ctx.measureText(cancelLabel).width) * 0.5,
    buttonY + 33,
  );

  const confirmFill = state.modal.danger ? (yesSelected ? "#c32727" : "#2f7e45") : "#2f7e45";
  const confirmStroke = state.modal.danger
    ? yesSelected
      ? "#ffffff"
      : "#9cd3aa"
    : yesSelected
      ? "#ffffff"
      : "#9cd3aa";
  ctx.fillStyle = confirmFill;
  ctx.fillRect(yesX, buttonY, confirmW, buttonH);
  ctx.strokeStyle = confirmStroke;
  ctx.lineWidth = yesSelected ? 3 : 2;
  ctx.strokeRect(yesX, buttonY, confirmW, buttonH);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(
    confirmLabel,
    yesX + (confirmW - ctx.measureText(confirmLabel).width) * 0.5,
    buttonY + 33,
  );

  ctx.restore();
}

export function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  if (state.mode === "menu") drawMenu();
  else if (state.mode === "loginProviders") drawLoginProviders();
  else if (state.mode === "gameModeSelect") drawGameModeSelect();
  else if (state.mode === "trackSelect") drawTrackSelection();
  else if (state.mode === "editor") drawEditor();
  else if (state.mode === "settings") drawSettings();
  else if (state.mode === "tournamentLobby") drawTournamentLobby();
  else if (state.mode === "tournamentStandings") drawTournamentStandings();
  else if (state.mode === "tournamentFinal") drawTournamentFinal();
  else {
    drawTitleBar();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TOP_BAR_HEIGHT, WIDTH, HEIGHT - TOP_BAR_HEIGHT);
    ctx.clip();
    ctx.translate(0, TOP_BAR_HEIGHT);
    ctx.fillStyle = "#2e8c42";
    ctx.fillRect(0, 0, WIDTH, HEIGHT - TOP_BAR_HEIGHT);
    drawPixelNoise();
    ctx.save();
    const raceCamera = getRaceCameraState(track);
    state.raceCamera.viewOffsetX = raceCamera.viewOffsetX;
    state.raceCamera.viewOffsetY = raceCamera.viewOffsetY;
    applyWorldTransform(track, raceCamera);
    drawTrack();
    drawParticles(ctx, { layer: "belowCar" });
    drawAmbientAnimals();
    drawCar();
    drawParticles(ctx, { layer: "aboveCar" });
    ctx.restore();
    drawDebugVectors();
    drawStartSequenceOverlay();
    ctx.restore();
    drawFinishOverlay();
    drawPauseOverlay();
  }

  drawScreenParticles(ctx);
  drawModal();
  drawSnackbar();
}

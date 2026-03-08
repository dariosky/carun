import {
  CHECKPOINT_WIDTH_MULTIPLIER,
  centerlineSmoothingLabel,
  ctx,
  WIDTH,
  HEIGHT,
  CURB_MAX_WIDTH,
  CURB_MIN_WIDTH,
  CURB_STRIPE_LENGTH,
  checkpoints,
  getConnectedCenterlinePoints,
  getTrackPreset,
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
  kartSprite,
  kartSpriteReady,
  lapData,
  physicsRuntime,
  skidMarks,
  state,
} from "./state.js";
import {
  getEditorTopBarLayout,
  getEditorToolbarLayout,
  getLoginProviderRenderModel,
  getMainMenuRenderModel,
  getSettingsHeaderRenderModel,
  getSettingsRenderLayout,
  getTrackSelectRenderModel,
} from "./menus.js";
import { formatTime } from "./utils.js";
import {
  blobRadius,
  drawPath,
  drawStripedCurb,
  getTrackWorldScale,
  initCurbSegments,
  isCenterlineTrack,
  pointOnCenterLine,
  sampleCenterlineHalfWidth,
  sampleClosedPath,
  surfaceAtForTrack,
  trackBoundaryPaths,
  trackFrameAtAngle,
  trackStartAngle,
} from "./track.js";
import { drawAsphaltMaterial, getAsphaltPattern } from "./material.js";
import { drawParticles } from "./particles.js";

const TOP_BAR_HEIGHT = 56;
const TRACK_SEGMENTS = 260;

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
const previewTrackDataCache = new Map();
const centerlineLengthCache = new WeakMap();

function createTextureCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined")
    return new OffscreenCanvas(width, height);
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

function warpProfileSignature(waves) {
  let sum = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    sum += (w.f || 0) * 1.7 + (w.amp || 0) * 17 + (w.phase || 0) * 9;
  }
  return Number(sum.toFixed(5));
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
    outerA: trackDef.outerA,
    outerB: trackDef.outerB,
    innerA: trackDef.innerA,
    innerB: trackDef.innerB,
    borderSize: trackDef.borderSize,
    worldScale: getTrackWorldScale(trackDef),
    centerlineHalfWidth: trackDef.centerlineHalfWidth,
    centerlineWidthSig: widthProfileSignature(trackDef.centerlineWidthProfile),
    centerlineWidthLength: Array.isArray(trackDef.centerlineWidthProfile)
      ? trackDef.centerlineWidthProfile.length
      : 0,
    warpOuterSig: warpProfileSignature(trackDef.warpOuter || []),
    warpInnerSig: warpProfileSignature(trackDef.warpInner || []),
    centerlineLoopRef: trackDef.centerlineLoop,
    centerlineLoopLength: trackDef.centerlineLoop
      ? trackDef.centerlineLoop.length
      : 0,
  };
}

function sameTrackSignature(a, b) {
  if (!a || !b) return false;
  return (
    a.segments === b.segments &&
    a.cx === b.cx &&
    a.cy === b.cy &&
    a.outerA === b.outerA &&
    a.outerB === b.outerB &&
    a.innerA === b.innerA &&
    a.innerB === b.innerB &&
    a.borderSize === b.borderSize &&
    a.worldScale === b.worldScale &&
    a.centerlineHalfWidth === b.centerlineHalfWidth &&
    a.centerlineWidthSig === b.centerlineWidthSig &&
    a.centerlineWidthLength === b.centerlineWidthLength &&
    a.warpOuterSig === b.warpOuterSig &&
    a.warpInnerSig === b.warpInnerSig &&
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
  if (cached && sameTrackSignature(cached.signature, signature))
    return cached.data;

  const data = {
    boundaries: trackBoundaryPaths(preset.track, TRACK_SEGMENTS),
    curbs: initCurbSegments(preset.track),
  };
  previewTrackDataCache.set(preset.id, { signature, data });
  return data;
}

function applyWorldScaleTransform(trackDef = track) {
  const worldScale = getTrackWorldScale(trackDef);
  ctx.translate(trackDef.cx, trackDef.cy);
  ctx.scale(worldScale, worldScale);
  ctx.translate(-trackDef.cx, -trackDef.cy);
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
    if (obj.type === "tree" || obj.type === "barrel") {
      const radius = (Number(obj.r) || 0) * worldScale;
      const center = transformPointByWorldScale(obj, trackDef);
      expandBounds(bounds, center.x - radius, center.y - radius);
      expandBounds(bounds, center.x + radius, center.y + radius);
      continue;
    }
    if (obj.type === "pond") {
      const radius =
        Math.max(Number(obj.rx) || 0, Number(obj.ry) || 0) * worldScale;
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

function drawDecor(objects = worldObjects) {
  const flash = state.editor.selectionFlash;
  const selectedObjectIndex =
    state.mode === "editor" && state.editor.latestEditTarget?.kind === "object"
      ? state.editor.latestEditTarget.objectIndex
      : -1;
  for (const [index, obj] of objects.entries()) {
    const shouldFlash =
      state.mode === "editor" &&
      selectedObjectIndex === index &&
      flash.kind === "object" &&
      flash.index === index &&
      flash.time > 0 &&
      Math.floor(flash.time / 0.08) % 2 === 0;
    if (obj.type === "tree") {
      const angle = obj.angle || 0;
      ctx.fillStyle = "#4a2f1e";
      ctx.save();
      ctx.translate(obj.x, obj.y);
      ctx.rotate(angle);
      ctx.fillRect(-4, 8, 8, 16);
      ctx.fillStyle = "#2f9c4a";
      const canopy = sampleClosedPath((a) => {
        const radius =
          obj.r *
          (1 +
            0.2 * Math.sin(a * 3 + obj.x * 0.02 + angle) +
            0.12 * Math.sin(a * 5 + obj.y * 0.02 - angle * 0.7));
        return {
          x: Math.cos(a) * radius,
          y: Math.sin(a) * radius,
        };
      }, 40);
      ctx.beginPath();
      drawPath(canopy);
      ctx.fill();
      ctx.fillStyle = "#3dcf60";
      const highlight = sampleClosedPath((a) => {
        const radius =
          obj.r * 0.4 * (1 + 0.12 * Math.sin(a * 4 + obj.x * 0.08 + angle));
        return {
          x: -8 + Math.cos(a) * radius,
          y: -6 + Math.sin(a) * radius,
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

    if (obj.type === "pond") {
      const angle = obj.angle || 0;
      ctx.fillStyle = "#7aa1c2";
      const waterPath = sampleClosedPath((a) => {
        const radius = blobRadius(obj.rx, obj.ry, a, obj.seed || 0);
        return {
          x: Math.cos(a) * radius,
          y: Math.sin(a) * radius,
        };
      }, 64);
      ctx.save();
      ctx.translate(obj.x, obj.y);
      ctx.rotate(angle);
      ctx.beginPath();
      drawPath(waterPath);
      ctx.fill();
      ctx.strokeStyle = "#8de2ff";
      ctx.lineWidth = 3;
      ctx.stroke();
      if (shouldFlash) {
        ctx.strokeStyle = "#ffe167";
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      ctx.restore();
    }

    if (obj.type === "barrel") {
      const angle = obj.angle || 0;
      ctx.save();
      ctx.translate(obj.x, obj.y);
      ctx.rotate(angle);
      ctx.fillStyle = "#d16f0d";
      ctx.beginPath();
      ctx.arc(0, 0, obj.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#3a2a12";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = "#ffe0a2";
      ctx.beginPath();
      ctx.moveTo(-obj.r * 0.7, 0);
      ctx.lineTo(obj.r * 0.7, 0);
      ctx.stroke();
      if (shouldFlash) {
        ctx.strokeStyle = "#ffe167";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, obj.r + 3, 0, Math.PI * 2);
        ctx.stroke();
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

function drawVertexAsterisks(
  points,
  size = 3.2,
  color = "rgba(255, 245, 120, 0.95)",
) {
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
    const a = cp.angle;
    const frame = trackFrameAtAngle(a, track);
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
      ctx.fillRect(
        -span * 0.5 + c * cellW,
        -thickness * 0.5 + r * cellH,
        cellW,
        cellH,
      );
    }
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-span * 0.5, -thickness * 0.5, span, thickness);
  ctx.restore();
}

function drawTrackSurface(
  trackDef,
  boundaries,
  segments,
  showCurbs,
  objects = worldObjects,
) {
  const outerPath = boundaries.outer;
  const innerPath = boundaries.inner;
  const centerlineTrack = isCenterlineTrack(trackDef);

  ctx.save();
  ctx.beginPath();
  if (centerlineTrack) {
    const centerCount = boundaries.center?.length || 0;
    const alignedCounts =
      centerCount > 0 &&
      centerCount === outerPath.length &&
      centerCount === innerPath.length;
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
  } else {
    drawPath(outerPath);
    drawPath([...innerPath].reverse());
    ctx.clip("evenodd");
  }
  drawAsphaltMaterial(ctx);
  ctx.restore();

  if (showCurbs) {
    const drawCurbSegment = (segment, defaultSign) => {
      const pts = segment.points || segment;
      const sign = segment.outwardSign ?? defaultSign;
      if (centerlineTrack) {
        const widthCaps = buildCurbWidthCaps(pts, sign, trackDef, objects);
        const runs = splitCurbRenderRuns(
          pts,
          sign,
          trackDef,
          objects,
          widthCaps,
        );
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
                CURB_MIN_WIDTH,
                CURB_MAX_WIDTH,
                CURB_STRIPE_LENGTH,
                run.widthCaps,
              );
            }
          }
          return;
        }
      }
      drawStripedCurb(
        pts,
        sign,
        CURB_MIN_WIDTH,
        CURB_MAX_WIDTH,
        CURB_STRIPE_LENGTH,
      );
    };
    segments.outer.forEach((segment) => drawCurbSegment(segment, -1));
    segments.inner.forEach((segment) => drawCurbSegment(segment, 1));
  }

  if (!centerlineTrack) {
    ctx.fillStyle = "#247637";
    ctx.beginPath();
    drawPath(innerPath);
    ctx.fill();
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
    const cap = Array.isArray(widthCaps)
      ? (widthCaps[index] ?? CURB_MAX_WIDTH)
      : CURB_MAX_WIDTH;
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
  let currentCaps = [
    Array.isArray(widthCaps)
      ? (widthCaps[0] ?? CURB_MAX_WIDTH)
      : CURB_MAX_WIDTH,
  ];

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    const nextKind = classes[i];
    const nextCap = Array.isArray(widthCaps)
      ? (widthCaps[i] ?? CURB_MAX_WIDTH)
      : CURB_MAX_WIDTH;
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
      Array.isArray(widthCaps)
        ? (widthCaps[i - 1] ?? CURB_MAX_WIDTH)
        : CURB_MAX_WIDTH,
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

function shouldRenderCurbSubsection(
  run,
  sideSign,
  trackDef = track,
  objects = worldObjects,
) {
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

function buildCurbWidthCaps(
  points,
  sideSign,
  trackDef = track,
  objects = worldObjects,
) {
  if (!Array.isArray(points) || !points.length) return null;
  const caps = points.map((_, index) => {
    let sawGrassGap = false;
    let lastGrassDistance = 0;
    let previousDistance = 0;
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
          const midSurface = surfaceAtForTrack(
            midProbe.x,
            midProbe.y,
            trackDef,
            objects,
          );
          if (midSurface === "grass") lo = mid;
          else hi = mid;
        }
        return lo < CURB_MIN_WIDTH * 0.25 ? 0 : lo;
      }

      previousDistance = distance;
    }

    return sawGrassGap ? CURB_MAX_WIDTH : Math.max(0, previousDistance);
  });

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < caps.length - 1; i++) {
      caps[i] = Math.min(caps[i], (caps[i - 1] + caps[i] + caps[i + 1]) / 3);
    }
  }

  return caps;
}

function smoothCurbRunClasses(points, classes, minArcLength) {
  if (!Array.isArray(points) || points.length < 2 || !Array.isArray(classes))
    return;
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
        arcLen += Math.hypot(
          points[i].x - points[prevIndex].x,
          points[i].y - points[prevIndex].y,
        );
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
    arcLen += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }
  if (arcLen < minRunArcLength) return null;
  return { kind, points, widthCaps };
}

function drawDottedCurbGuide(points) {
  if (!Array.isArray(points) || points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = "rgba(248, 248, 248, 0.95)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([8, 10]);
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

  drawRuns(segments.outer || [], [
    "rgba(160, 92, 255, 0.95)",
    "rgba(72, 120, 255, 0.95)",
  ]);
  drawRuns(segments.inner || [], [
    "rgba(208, 92, 255, 0.95)",
    "rgba(66, 188, 255, 0.95)",
  ]);
}

function drawTrack() {
  const boundaries = getTrackBoundariesCached(track, TRACK_SEGMENTS);
  const showCurbs = state.mode !== "editor" || state.editor.showCurbs;
  drawTrackSurface(track, boundaries, curbSegments, showCurbs, worldObjects);
  if (state.mode === "editor" && !state.editor.showCurbs) {
    drawEditorHiddenCurbOverlay(curbSegments);
    drawVertexAsterisks(boundaries.outer);
    drawVertexAsterisks(boundaries.inner);
  }

  drawDecor();
  drawSkidMarks();
  drawRoadDetails(track);
  drawStartLine(track);
  drawCheckpointFlags();
}

function drawCar() {
  const blinkActive = state.checkpointBlink.time > 0;
  let blinkT = 0;
  if (blinkActive) {
    blinkT =
      state.checkpointBlink.time /
      Math.max(state.checkpointBlink.duration, 0.0001);
  }

  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle + Math.PI * 0.5);

  if (blinkActive) {
    const pulse = 0.5 + 0.5 * Math.sin((1 - blinkT) * Math.PI * 7);
    const glowStrength = Math.max(0, Math.min(1, blinkT * 0.5 + pulse * 0.5));
    ctx.shadowColor = `rgba(255, 255, 255, ${(0.9 * glowStrength).toFixed(3)})`;
    ctx.shadowBlur = 18 + 24 * glowStrength;
  }

  if (kartSpriteReady) {
    const spriteWidth = 30;
    const spriteLength = 56;
    ctx.drawImage(
      kartSprite,
      -spriteWidth * 0.5,
      -spriteLength * 0.5,
      spriteWidth,
      spriteLength,
    );
  } else {
    ctx.fillStyle = "#d22525";
    ctx.fillRect(-car.height / 2, -car.width / 2, car.height, car.width);
    ctx.fillStyle = "#ffd34d";
    ctx.fillRect(-6, -8, 12, 16);
  }

  ctx.restore();
}

function drawDebugVectors() {
  if (!physicsConfig.flags.DEBUG_MODE || state.mode !== "racing") return;

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
  applyWorldScaleTransform(track);
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
  ctx.fillText(
    `SURFACE: ${physicsRuntime.debug.surface.toUpperCase()}`,
    lineX,
    firstLineY,
  );
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
    `FPS: ${toStableInt(state.performance.fps)}`,
    lineX,
    firstLineY + lineStep * 4,
  );
}

function drawStartSequenceOverlay() {
  const seq = state.startSequence;
  if (!seq.active && seq.goFlash <= 0) return;

  const cx = track.cx;
  const cy = track.cy;

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
    const plateGradient = ctx.createLinearGradient(
      plateX,
      plateY,
      plateX,
      plateY + plateH,
    );
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
    const plateGradient = ctx.createLinearGradient(
      plateX,
      plateY,
      plateX,
      plateY + plateH,
    );
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

  let x = 18;
  ctx.fillStyle = "#ffe167";
  ctx.font = "bold 28px Verdana";
  ctx.fillText("Carun", x, 38);
  x += ctx.measureText("Carun").width + 10;

  if (appLogoReady) {
    ctx.drawImage(appLogo, x, 6, 44, 44);
  }
  x += 44 + 12;

  ctx.fillStyle = "#f4fbff";
  ctx.font = "bold 20px Verdana";
  ctx.fillText(state.playerName, x, 38);
  x += ctx.measureText(state.playerName).width + 18;

  const lapLabel = `LAP ${Math.min(lapData.lap, lapData.maxLaps)}/${lapData.maxLaps}`;
  ctx.fillStyle = "#d8e8f7";
  ctx.font = "bold 18px Verdana";
  ctx.fillText(lapLabel, x, 38);
  x += ctx.measureText(lapLabel).width + 16;

  const liveLap = state.finished
    ? lapData.lapTimes[lapData.lapTimes.length - 1] || 0
    : state.raceTime - lapData.currentLapStart;
  const fastestIndex =
    lapData.lapTimes.length > 0
      ? lapData.lapTimes.reduce(
          (bestIdx, t, idx, arr) => (t < arr[bestIdx] ? idx : bestIdx),
          0,
        )
      : -1;

  ctx.font = "16px Verdana";
  for (let i = 0; i < lapData.maxLaps; i++) {
    const isCurrent = !state.finished && i === lapData.lapTimes.length;
    const isCompleted = i < lapData.lapTimes.length;
    const value = isCurrent ? liveLap : lapData.lapTimes[i];
    if (isCurrent) ctx.fillStyle = "#f3f8ff";
    else if (isCompleted && i === fastestIndex) ctx.fillStyle = "#ffe167";
    else if (isCompleted) ctx.fillStyle = "#8b98a7";
    else ctx.fillStyle = "rgba(180, 194, 208, 0.45)";
    const label =
      value !== undefined
        ? `L${i + 1} ${formatTime(value)}`
        : `L${i + 1} --:--.---`;
    ctx.fillText(label, x, 38);
    x += ctx.measureText(label).width + 14;
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

  const helpText = ["S save", "C curbs", "Esc back"].join("   ");
  const helpX = brandBox.x + brandBox.width + 18;
  const helpW = Math.max(120, topBarLayout.race.x - helpX - 18);
  if (helpW > 140) {
    ctx.fillStyle = "rgba(13, 25, 33, 0.62)";
    ctx.beginPath();
    ctx.roundRect(helpX, 10, helpW, 36, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(184, 215, 232, 0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#c9d9e7";
    ctx.font = "13px Verdana";
    ctx.textAlign = "center";
    ctx.fillText(helpText, helpX + helpW * 0.5, 33);
  }

  const drawTopBarButton = (rect, label, shortcut) => {
    ctx.fillStyle = "rgba(16, 33, 45, 0.92)";
    ctx.strokeStyle = "rgba(184, 215, 232, 0.28)";
    ctx.lineWidth = 2;
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
    if (object.type === "pond")
      return `${Math.round(object.rx)}x${Math.round(object.ry)}`;
    if (Number.isFinite(object.r)) return `${Math.round(object.r)}`;
  }
  return "--";
}

function selectedObjectLabel(preset) {
  const objects = preset.worldObjects || [];
  if (!objects.length) return "--";
  const iconForType = (type) =>
    type === "pond"
      ? "≈"
      : type === "barrel"
        ? "◉"
        : type === "tree"
          ? "♣"
          : "•";
  const target = state.editor.latestEditTarget;
  if (target?.kind !== "object" || !objects[target.objectIndex]) {
    const last = objects[objects.length - 1];
    return `${objects.length}/${objects.length} ${iconForType(last.type)}`;
  }
  return `${target.objectIndex + 1}/${objects.length} ${iconForType(objects[target.objectIndex].type)}`;
}

function selectedRoadLabel(preset) {
  const strokes = preset.centerlineStrokes || [];
  if (!strokes.length) return "--";
  const target = state.editor.latestEditTarget;
  if (target?.kind !== "stroke" || !strokes[target.strokeIndex]) {
    return `${strokes.length}/${strokes.length}`;
  }
  return `${target.strokeIndex + 1}/${strokes.length}`;
}

function selectedRoadWidthLabel(preset) {
  const target = state.editor.latestEditTarget;
  if (target?.kind !== "stroke") return "--";
  const stroke = preset.centerlineStrokes?.[target.strokeIndex];
  if (Number.isFinite(stroke?.[0]?.halfWidth))
    return `${Math.round(stroke[0].halfWidth * 2)} px`;
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
  const roadWidth = selectedRoadWidthLabel(preset);
  const smoothingText = centerlineSmoothingLabel(
    preset.track.centerlineSmoothingMode,
  );
  const zoomText = `${Math.round(getTrackWorldScale(preset.track) * 100)}%`;
  const activeToolLabel =
    state.editor.activeTool === "road"
      ? "ROAD"
      : state.editor.activeTool === "pond"
        ? "WATER"
        : state.editor.activeTool.toUpperCase();
  const toolbarHeaderLabel = state.editor.toolbar.hoverLabel || activeToolLabel;

  ctx.save();
  ctx.fillStyle = "rgba(6, 14, 20, 0.86)";
  ctx.beginPath();
  ctx.roundRect(
    layout.panel.x,
    layout.panel.y,
    layout.panel.width,
    layout.panel.height,
    10,
  );
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
      (row.id === "barrel" && state.editor.activeTool === "barrel") ||
      (row.id === "tree" && state.editor.activeTool === "tree");
    drawToolbarButton(row, "", { active });
    ctx.fillStyle = "#dff7ff";
    ctx.font = "bold 20px Verdana";
    ctx.textAlign = "center";
    ctx.fillText(row.icon, row.x + row.width * 0.5, row.y + 22);
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

  for (const button of layout.objectActionButtons) {
    drawToolbarButton(button, "", { active: false });
    ctx.fillStyle = "#dff7ff";
    ctx.font = "bold 18px Verdana";
    ctx.textAlign = "center";
    ctx.fillText(button.icon, button.x + button.width * 0.5, button.y + 19);
  }

  ctx.fillStyle = "#9cb9c8";
  ctx.font = "bold 12px Verdana";
  ctx.textAlign = "left";
  ctx.fillText("ROAD", layout.roadHeader.x, layout.roadHeader.y + 15);

  ctx.fillStyle = "#f0f8ff";
  ctx.font = "bold 14px Verdana";
  ctx.fillText("Pick", layout.roadSelectLabel.x, layout.roadSelectLabel.y + 18);
  drawToolbarButton(layout.roadPrev, "‹");
  drawToolbarButton(layout.roadNext, "›");
  ctx.fillStyle = "#d7ebf7";
  ctx.textAlign = "center";
  ctx.fillText(
    roadLabel,
    layout.roadValue.x + layout.roadValue.width * 0.5,
    layout.roadValue.y + 18,
  );

  for (const button of layout.roadActionButtons) {
    drawToolbarButton(button, "", { active: false });
    ctx.fillStyle = "#dff7ff";
    ctx.font = "bold 18px Verdana";
    ctx.textAlign = "center";
    ctx.fillText(button.icon, button.x + button.width * 0.5, button.y + 19);
  }

  ctx.fillStyle = "#f0f8ff";
  ctx.textAlign = "left";
  ctx.fillText(
    "Smooth",
    layout.roadSmoothLabel.x,
    layout.roadSmoothLabel.y + 18,
  );
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
  ctx.restore();
}

function drawFinishOverlay() {
  if (!state.finished || state.mode !== "racing") return;
  const viewportCenterY = TOP_BAR_HEIGHT + (HEIGHT - TOP_BAR_HEIGHT) * 0.5;
  const total =
    state.finishCelebration.totalTime ||
    lapData.lapTimes.reduce((a, b) => a + b, 0);
  const bestLap =
    state.finishCelebration.bestLapTime ||
    (lapData.lapTimes.length ? Math.min(...lapData.lapTimes) : 0);

  ctx.fillStyle = "rgba(12, 22, 18, 0.86)";
  ctx.fillRect(WIDTH / 2 - 248, viewportCenterY - 104, 496, 222);
  ctx.fillStyle = "#6af0a8";
  ctx.font = "bold 42px Verdana";
  ctx.fillText("FINISH!", WIDTH / 2 - 95, viewportCenterY - 28);
  ctx.font = "20px Verdana";

  const rows = [
    {
      label: "TOTAL",
      value: formatTime(total),
      rewarded: state.finishCelebration.bestRace,
      rewardLabel: "BEST RACE",
      y: viewportCenterY + 14,
    },
    {
      label: "BEST",
      value: formatTime(bestLap),
      rewarded: state.finishCelebration.bestLap,
      rewardLabel: "BEST LAP",
      y: viewportCenterY + 54,
    },
  ];

  for (const row of rows) {
    ctx.fillStyle = row.rewarded ? "#ffe167" : "#ffffff";
    ctx.fillText(`${row.label}: ${row.value}`, WIDTH / 2 - 136, row.y);
    if (!row.rewarded) continue;
    const badgeText = row.rewardLabel;
    const badgeW = ctx.measureText(badgeText).width + 20;
    const badgeX = WIDTH / 2 + 58;
    const badgeY = row.y - 19;
    ctx.fillStyle = "#ffe167";
    ctx.fillRect(badgeX, badgeY, badgeW, 24);
    ctx.fillStyle = "#4e3600";
    ctx.font = "bold 12px Verdana";
    ctx.fillText(badgeText, badgeX + 10, badgeY + 16);
    ctx.font = "20px Verdana";
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillText("ENTER TO RETURN MENU", WIDTH / 2 - 144, viewportCenterY + 96);
}

function drawPauseOverlay() {
  if (!state.paused || state.mode !== "racing") return;

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

function drawMenu() {
  ctx.fillStyle = "#0f2640";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();

  if (appLogoReady) {
    const maxLogoWidth = 320;
    const maxLogoHeight = 130;
    const ratio = Math.min(
      maxLogoWidth / appLogo.width,
      maxLogoHeight / appLogo.height,
    );
    const drawWidth = appLogo.width * ratio;
    const drawHeight = appLogo.height * ratio;
    ctx.drawImage(
      appLogo,
      WIDTH * 0.5 - drawWidth * 0.5,
      22,
      drawWidth,
      drawHeight,
    );
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
  const { menuItems, selectedMenuIndex, highlightWidth } =
    getMainMenuRenderModel((text) => ctx.measureText(text).width);
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

  const { minX, minY, maxX, maxY } = getPreviewBounds(
    preset,
    boundaries,
    curbs,
  );

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
  drawTrackSurface(
    trackDef,
    boundaries,
    curbs,
    true,
    preset.worldObjects || [],
  );
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

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 84px Verdana";
  ctx.fillText("LOGIN", WIDTH * 0.5 - 132, 220);

  ctx.font = "bold 38px Verdana";
  const { loginItems, selectedLoginIndex, highlightWidth } =
    getLoginProviderRenderModel((text) => ctx.measureText(text).width);
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

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 70px Verdana";
  ctx.fillText("SELECT TRACK", WIDTH * 0.5 - 248, 148);

  const cardSize = 220;
  const gap = 40;
  const cardY = 198;
  const model = getTrackSelectRenderModel();
  const cardCount = model.visibleTracks.length;
  const totalWidth = cardCount * cardSize + Math.max(0, cardCount - 1) * gap;
  const startX = WIDTH * 0.5 - totalWidth * 0.5;

  for (let i = 0; i < cardCount; i++) {
    const trackIndex = model.viewOffset + i;
    const cardX = startX + i * (cardSize + gap);
    const selected = state.trackSelectIndex === trackIndex;
    const trackOption = model.visibleTracks[i];
    drawTrackPreviewCard(
      cardX,
      cardY,
      cardSize,
      selected,
      getTrackPreset(trackIndex),
    );

    ctx.fillStyle = selected ? "#ffffff" : "#9db6c7";
    ctx.font = "bold 24px Verdana";
    const label = trackOption.name;
    const labelWidth = ctx.measureText(label).width;
    ctx.fillText(
      label,
      cardX + cardSize * 0.5 - labelWidth * 0.5,
      cardY + cardSize + 34,
    );
    if (!trackOption.isPublished) {
      ctx.fillStyle = "#f26b6b";
      ctx.fillRect(cardX + 10, cardY + 10, 92, 26);
      ctx.fillStyle = "#3d1010";
      ctx.font = "bold 12px Verdana";
      ctx.fillText("PRIVATE", cardX + 26, cardY + 28);
    }
  }

  if (model.showLeftHint) {
    ctx.fillStyle = "#ffd25e";
    ctx.font = "bold 34px Verdana";
    ctx.fillText("\u2039", startX - 36, cardY + cardSize * 0.5 + 10);
  }
  if (model.showRightHint) {
    ctx.fillStyle = "#ffd25e";
    ctx.font = "bold 34px Verdana";
    ctx.fillText(
      "\u203a",
      startX + totalWidth + 12,
      cardY + cardSize * 0.5 + 10,
    );
  }

  const backY = cardY + cardSize + 106;
  const backIndex = trackOptions.length;
  const backSelected = state.trackSelectIndex === backIndex;
  const backWidth = 290;
  const backX = WIDTH - backWidth - 48;
  if (backSelected) {
    ctx.fillStyle = "#ec4f4f";
    ctx.fillRect(backX, backY - 39, backWidth, 52);
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px Verdana";
  ctx.fillText("BACK", backX + 82, backY);

  const helpLines = [];
  const deleteKeyLabel = (() => {
    if (typeof navigator === "undefined") return "DEL";
    const platform =
      typeof navigator.userAgentData?.platform === "string"
        ? navigator.userAgentData.platform
        : typeof navigator.platform === "string"
          ? navigator.platform
          : "";
    return /mac/i.test(platform) ? "BACKSPACE" : "DEL";
  })();
  if (model.selectedTrackCanDelete)
    helpLines.push(`${deleteKeyLabel} deletes your selected draft track`);
  if (model.selectedTrackCanPublish) {
    helpLines.push(
      model.selectedTrackIsPublished
        ? "Press P to unpublish selected track"
        : "Press P to publish selected track",
    );
  }
  if (physicsConfig.flags.DEBUG_MODE)
    helpLines.push("Press E to edit selected track");
  if (model.selectedTrackCanRename)
    helpLines.push("Press R to rename selected track");
  ctx.font = "20px Verdana";
  ctx.fillStyle = "#c3d9ec";
  const helpStartY = HEIGHT - 42 - Math.max(0, helpLines.length - 1) * 28;
  for (let i = 0; i < helpLines.length; i++) {
    ctx.fillText(helpLines[i], WIDTH * 0.5 - 180, helpStartY + i * 28);
  }

  if (
    state.trackSelectIndex >= 0 &&
    state.trackSelectIndex < trackOptions.length
  ) {
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
      const boundaries = trackBoundaryPaths(
        selectedPreset.track,
        TRACK_SEGMENTS,
      );
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

    const statsX = 72;
    const statsY = cardY + cardSize + 98;
    const distanceMeters = centerlineLength / 15;
    const distanceLabel = Number.isInteger(distanceMeters)
      ? `${distanceMeters} m`
      : `${distanceMeters.toFixed(1)} m`;
    ctx.fillStyle = "#d8e7f5";
    ctx.font = "bold 20px Verdana";
    ctx.fillText(`Owner: ${ownerName}`, statsX, statsY);
    ctx.fillText(`Distance: ${distanceLabel}`, statsX, statsY + 28);
    ctx.fillText(`Best lap: ${bestLapText}`, statsX, statsY + 56);
    ctx.fillText(`Best total: ${bestRaceText}`, statsX, statsY + 84);
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
  const connectedLoop = getConnectedCenterlinePoints(strokes);
  drawStroke(connectedLoop, "rgba(96, 248, 255, 0.78)", 2);
  const flash = state.editor.selectionFlash;
  const selectedStrokeIndex =
    state.editor.latestEditTarget?.kind === "stroke"
      ? state.editor.latestEditTarget.strokeIndex
      : -1;
  for (const [index, stroke] of strokes.entries()) {
    const baseColor =
      index % 2 === 0
        ? "rgba(255, 163, 72, 0.92)"
        : "rgba(120, 228, 255, 0.92)";
    const shouldFlash =
      selectedStrokeIndex === index &&
      flash.kind === "stroke" &&
      flash.index === index &&
      flash.time > 0 &&
      Math.floor(flash.time / 0.08) % 2 === 0;
    drawStroke(
      stroke,
      shouldFlash ? "rgba(255, 225, 103, 0.98)" : baseColor,
      4,
    );
  }
  drawStroke(state.editor.activeStroke, "rgba(255, 255, 255, 0.95)", 3);

  const cx = state.editor.cursorX;
  const cy = state.editor.cursorY;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
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
  applyWorldScaleTransform(track);
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

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 76px Verdana";
  const settingsHeader = getSettingsHeaderRenderModel();
  ctx.save();
  ctx.textAlign = settingsHeader.textAlign;
  ctx.fillText(
    settingsHeader.text,
    WIDTH * settingsHeader.xRatio,
    settingsHeader.y,
  );
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
  const {
    settingsItems,
    selectedSettingsIndex,
    rowLabels,
    rowGap,
    startY,
    highlightWidth,
  } = getSettingsRenderLayout((text) => ctx.measureText(text).width);
  const highlightX = WIDTH * 0.5 - highlightWidth * 0.5;
  const textX = highlightX + 30;
  settingsItems.forEach((_, idx) => {
    const y = startY + idx * rowGap;
    if (idx === selectedSettingsIndex) {
      ctx.fillStyle = "#3d7ec7";
      ctx.fillRect(highlightX, y - 42, highlightWidth, 56);
      ctx.fillStyle = "#ffffff";
    } else {
      ctx.fillStyle = "#9db6c7";
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
  const infoLines = drawWrappedText(
    state.modal.message || "",
    x + 34,
    y + 108,
    panelW - 68,
    34,
  );

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
  const cancelW = Math.max(
    minButtonW,
    ctx.measureText(cancelLabel).width + buttonPadX * 2,
  );
  const confirmW = Math.max(
    minButtonW,
    ctx.measureText(confirmLabel).width + buttonPadX * 2,
  );
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

  ctx.fillStyle = state.modal.danger ? "#c32727" : "#2f7e45";
  ctx.fillRect(yesX, buttonY, confirmW, buttonH);
  ctx.strokeStyle = yesSelected ? "#ffffff" : "#e6bcbc";
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
  else if (state.mode === "trackSelect") drawTrackSelection();
  else if (state.mode === "editor") drawEditor();
  else if (state.mode === "settings") drawSettings();
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
    applyWorldScaleTransform(track);
    drawTrack();
    drawParticles(ctx, { layer: "belowCar" });
    drawCar();
    drawParticles(ctx, { layer: "aboveCar" });
    ctx.restore();
    drawDebugVectors();
    drawStartSequenceOverlay();
    ctx.restore();
    drawFinishOverlay();
    drawPauseOverlay();
  }

  drawModal();
  drawSnackbar();
}

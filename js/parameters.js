const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

export { canvas, ctx };

export const WIDTH = canvas.width;
export const HEIGHT = canvas.height;

const PLAYER_NAME_STORAGE_KEY = "carun.playerName";

export function sanitizePlayerName(raw) {
  if (typeof raw !== "string") return "PLAYER";
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim().slice(0, 12);
  return cleaned || "PLAYER";
}

export function loadPlayerName() {
  try {
    return sanitizePlayerName(localStorage.getItem(PLAYER_NAME_STORAGE_KEY));
  } catch {
    return "PLAYER";
  }
}

export function savePlayerName(name) {
  try {
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, sanitizePlayerName(name));
  } catch {
    // Ignore storage failures (private mode, blocked storage, etc.).
  }
}

export const menuItems = ["START", "SETTINGS"];
export const settingsItems = ["PLAYER NAME", "BACK"];
const TRACK_EDITS_STORAGE_KEY = "carun.trackEdits.v1";
const TRACK_PRESETS = [
  {
    id: "classic",
    name: "CLASSIC LOOP",
    track: {
      cx: WIDTH * 0.5,
      cy: HEIGHT * 0.53,
      outerA: 500,
      outerB: 265,
      innerA: 315,
      innerB: 145,
      warpOuter: [
        { f: 2, amp: 0.055, phase: 0.45 },
        { f: 3, amp: 0.038, phase: -0.7 },
        { f: 5, amp: 0.022, phase: 1.15 },
      ],
      warpInner: [
        { f: 2, amp: 0.04, phase: 0.7 },
        { f: 3, amp: 0.025, phase: -0.5 },
        { f: 5, amp: 0.015, phase: 1.4 },
      ],
      borderSize: 22,
    },
    checkpoints: [
      { angle: 0 },
      { angle: Math.PI * 0.5 },
      { angle: Math.PI },
      { angle: Math.PI * 1.5 },
    ],
    worldObjects: [
      { type: "tree", x: 150, y: 150, r: 26 },
      { type: "tree", x: 1080, y: 136, r: 24 },
      { type: "tree", x: 172, y: 596, r: 23 },
      { type: "tree", x: 1110, y: 580, r: 22 },
      { type: "pond", x: 650, y: 350, rx: 95, ry: 52, seed: 0.8 },
      { type: "pond", x: 215, y: 340, rx: 60, ry: 34, seed: -0.55 },
      { type: "barrel", x: 447, y: 153, r: 13 },
      { type: "barrel", x: 847, y: 567, r: 13 },
    ],
    centerlineStrokes: [],
    editStack: [],
  },
];

function cloneTrackData(trackData) {
  return {
    ...trackData,
    warpOuter: (trackData.warpOuter || []).map((w) => ({ ...w })),
    warpInner: (trackData.warpInner || []).map((w) => ({ ...w })),
    centerlineLoop: Array.isArray(trackData.centerlineLoop)
      ? trackData.centerlineLoop.map((p) => ({ x: p.x, y: p.y }))
      : null,
  };
}

function clonePresetData(preset) {
  return {
    id: preset.id,
    name: preset.name,
    track: cloneTrackData(preset.track),
    checkpoints: (preset.checkpoints || []).map((cp) => ({ ...cp })),
    worldObjects: (preset.worldObjects || []).map((obj) => ({ ...obj })),
    centerlineStrokes: (preset.centerlineStrokes || []).map((stroke) =>
      stroke.map((p) => ({ x: p.x, y: p.y })),
    ),
    editStack: (preset.editStack || []).map((entry) => ({ ...entry })),
  };
}

function normalizePresetId(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-").slice(0, 48);
}

function normalizeTrackPresetData(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = normalizePresetId(raw.id || raw.name || `track-${Date.now()}`);
  if (!id) return null;

  const safeTrack = cloneTrackData(raw.track || {});
  if (
    !Number.isFinite(safeTrack.cx) ||
    !Number.isFinite(safeTrack.cy) ||
    !Number.isFinite(safeTrack.outerA) ||
    !Number.isFinite(safeTrack.outerB) ||
    !Number.isFinite(safeTrack.innerA) ||
    !Number.isFinite(safeTrack.innerB)
  ) {
    return null;
  }

  if (!Array.isArray(safeTrack.warpOuter)) safeTrack.warpOuter = [];
  if (!Array.isArray(safeTrack.warpInner)) safeTrack.warpInner = [];
  safeTrack.borderSize = Number.isFinite(safeTrack.borderSize) ? safeTrack.borderSize : 22;

  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 36) : id.toUpperCase(),
    track: safeTrack,
    checkpoints: Array.isArray(raw.checkpoints) ? raw.checkpoints.map((cp) => ({ angle: Number(cp.angle) || 0 })) : [],
    worldObjects: Array.isArray(raw.worldObjects) ? raw.worldObjects.map((obj) => ({ ...obj })) : [],
    centerlineStrokes: Array.isArray(raw.centerlineStrokes)
      ? raw.centerlineStrokes.map((stroke) => (Array.isArray(stroke) ? stroke.map((p) => ({ x: p.x, y: p.y })) : []))
      : [],
    editStack: Array.isArray(raw.editStack) ? raw.editStack.map((e) => ({ ...e })) : [],
  };
}

function readTrackEditsStorage() {
  try {
    const raw = localStorage.getItem(TRACK_EDITS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeTrackEditsStorage(value) {
  try {
    localStorage.setItem(TRACK_EDITS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

function applyPersistedTrackEdits() {
  const savedById = readTrackEditsStorage();
  for (const preset of TRACK_PRESETS) {
    const saved = savedById[preset.id];
    if (!saved || typeof saved !== "object") continue;
    if (saved.track && typeof saved.track === "object") preset.track = cloneTrackData(saved.track);
    if (Array.isArray(saved.checkpoints)) preset.checkpoints = saved.checkpoints.map((cp) => ({ ...cp }));
    if (Array.isArray(saved.worldObjects)) preset.worldObjects = saved.worldObjects.map((obj) => ({ ...obj }));
    if (Array.isArray(saved.centerlineStrokes)) {
      preset.centerlineStrokes = saved.centerlineStrokes.map((stroke) =>
        Array.isArray(stroke) ? stroke.map((p) => ({ x: p.x, y: p.y })) : [],
      );
    }
    if (Array.isArray(saved.editStack)) {
      preset.editStack = saved.editStack.map((entry) => ({ ...entry }));
    }
  }
}

applyPersistedTrackEdits();

const activePreset = TRACK_PRESETS[0];

export const trackOptions = [];

function rebuildTrackOptions() {
  trackOptions.length = 0;
  trackOptions.push(...TRACK_PRESETS.map(({ id, name }) => ({ id, name })));
}

function upsertTrackPreset(data) {
  const normalized = normalizeTrackPresetData(data);
  if (!normalized) return null;
  const existingIdx = TRACK_PRESETS.findIndex((preset) => preset.id === normalized.id);
  if (existingIdx >= 0) TRACK_PRESETS[existingIdx] = normalized;
  else TRACK_PRESETS.push(normalized);
  rebuildTrackOptions();
  return normalized;
}

rebuildTrackOptions();

export const track = {
  ...activePreset.track,
  warpOuter: activePreset.track.warpOuter.map((w) => ({ ...w })),
  warpInner: activePreset.track.warpInner.map((w) => ({ ...w })),
};

export const checkpoints = activePreset.checkpoints.map((cp) => ({ ...cp }));

export const CHECKPOINT_WIDTH_MULTIPLIER = 2;

export const worldObjects = activePreset.worldObjects.map((obj) => ({ ...obj }));

export function getTrackPreset(index) {
  return TRACK_PRESETS[index] || TRACK_PRESETS[0];
}

export function getTrackPresetById(id) {
  return TRACK_PRESETS.find((preset) => preset.id === id) || null;
}

export function applyTrackPreset(index) {
  const preset = getTrackPreset(index);

  const centerlineLoop = Array.isArray(preset.track.centerlineLoop)
    ? preset.track.centerlineLoop.map((p) => ({ x: p.x, y: p.y }))
    : null;
  Object.assign(track, {
    ...preset.track,
    warpOuter: preset.track.warpOuter.map((w) => ({ ...w })),
    warpInner: preset.track.warpInner.map((w) => ({ ...w })),
    centerlineLoop,
  });

  checkpoints.length = 0;
  checkpoints.push(...preset.checkpoints.map((cp) => ({ ...cp })));

  worldObjects.length = 0;
  worldObjects.push(...preset.worldObjects.map((obj) => ({ ...obj })));
}

function ellipseRadiusAtAngle(angle, a, b) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return 1 / Math.sqrt((c * c) / (a * a) + (s * s) / (b * b));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function appendBridge(points, from, to, spacing = 10) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-4) return;
  const steps = Math.max(1, Math.floor(distance / spacing));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({ x: from.x + dx * t, y: from.y + dy * t });
  }
}

function chaikinSmoothClosed(points, iterations = 2) {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  let current = points.map((p) => ({ x: p.x, y: p.y }));

  for (let iter = 0; iter < iterations; iter++) {
    const next = [];
    const n = current.length;
    for (let i = 0; i < n; i++) {
      const a = current[i];
      const b = current[(i + 1) % n];
      next.push({
        x: a.x * 0.75 + b.x * 0.25,
        y: a.y * 0.75 + b.y * 0.25,
      });
      next.push({
        x: a.x * 0.25 + b.x * 0.75,
        y: a.y * 0.25 + b.y * 0.75,
      });
    }
    current = next;
  }

  return current;
}

function resampleClosedLoop(points, targetCount = 220) {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  const n = points.length;
  const cumulative = [0];
  let total = 0;

  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    cumulative.push(total);
  }
  if (total < 1e-3) return points;

  const sampled = [];
  for (let i = 0; i < targetCount; i++) {
    const d = (i / targetCount) * total;
    let seg = 0;
    while (seg < n - 1 && cumulative[seg + 1] < d) seg++;
    const a = points[seg];
    const b = points[(seg + 1) % n];
    const segStart = cumulative[seg];
    const segEnd = cumulative[seg + 1];
    const t = (d - segStart) / Math.max(segEnd - segStart, 1e-6);
    sampled.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
  }

  return sampled;
}

function solveLinearSystem(matrix, values) {
  const n = values.length;
  const a = matrix.map((row) => [...row]);
  const b = [...values];

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-8) continue;
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [b[col], b[pivot]] = [b[pivot], b[col]];
    }

    const invPivot = 1 / a[col][col];
    for (let j = col; j < n; j++) a[col][j] *= invPivot;
    b[col] *= invPivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      if (Math.abs(factor) < 1e-10) continue;
      for (let j = col; j < n; j++) a[row][j] -= factor * a[col][j];
      b[row] -= factor * b[col];
    }
  }

  return b;
}

function fitWarpProfile(angles, scaleValues, freqs, ampLimit = 0.24) {
  const termCount = freqs.length * 2;
  const ata = Array.from({ length: termCount }, () => new Array(termCount).fill(0));
  const atb = new Array(termCount).fill(0);

  for (let i = 0; i < angles.length; i++) {
    const angle = angles[i];
    const y = (scaleValues[i] || 1) - 1;
    const row = [];
    for (const f of freqs) {
      row.push(Math.sin(angle * f));
      row.push(Math.cos(angle * f));
    }

    for (let r = 0; r < termCount; r++) {
      atb[r] += row[r] * y;
      for (let c = 0; c < termCount; c++) {
        ata[r][c] += row[r] * row[c];
      }
    }
  }

  const coeffs = solveLinearSystem(ata, atb);
  const profile = [];
  for (let i = 0; i < freqs.length; i++) {
    const sinCoeff = coeffs[i * 2] || 0;
    const cosCoeff = coeffs[i * 2 + 1] || 0;
    const amp = clamp(Math.hypot(sinCoeff, cosCoeff), 0, ampLimit);
    const phase = amp > 1e-6 ? Math.atan2(cosCoeff, sinCoeff) : 0;
    profile.push({
      f: freqs[i],
      amp: Number(amp.toFixed(4)),
      phase: Number(phase.toFixed(4)),
    });
  }
  return profile;
}

function raySegmentDistance(cx, cy, angle, a, b) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const det = dx * sy - dy * sx;
  if (Math.abs(det) < 1e-8) return null;

  const acx = a.x - cx;
  const acy = a.y - cy;
  const t = (acx * sy - acy * sx) / det;
  const u = (acx * dy - acy * dx) / det;
  if (t < 0 || u < 0 || u > 1) return null;
  return t;
}

function connectedSegmentsFromStrokes(strokes) {
  return (strokes || []).filter((stroke) => Array.isArray(stroke) && stroke.length > 0);
}

export function getConnectedCenterlinePoints(strokes) {
  const segments = connectedSegmentsFromStrokes(strokes);
  if (!segments.length) return [];

  const points = segments[0].map((p) => ({ x: p.x, y: p.y }));
  for (let i = 1; i < segments.length; i++) {
    const prevEnd = points[points.length - 1];
    const nextStart = segments[i][0];
    appendBridge(points, prevEnd, nextStart);
    for (let j = 1; j < segments[i].length; j++) {
      const p = segments[i][j];
      points.push({ x: p.x, y: p.y });
    }
  }

  if (points.length > 1) {
    appendBridge(points, points[points.length - 1], points[0]);
  }
  return points;
}

export function regenerateTrackFromCenterlineStrokes(index) {
  const preset = getTrackPreset(index);
  const rawLoop = getConnectedCenterlinePoints(preset.centerlineStrokes);
  if (rawLoop.length < 6) return false;
  const smoothedLoop = chaikinSmoothClosed(rawLoop, 2);
  const loopPoints = resampleClosedLoop(smoothedLoop, 220);
  if (loopPoints.length < 20) return false;

  let cx = 0;
  let cy = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of loopPoints) {
    cx += p.x;
    cy += p.y;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  cx /= loopPoints.length;
  cy /= loopPoints.length;

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX < 120 || spanY < 120) return false;

  const sampleCount = 180;
  const angles = [];
  const centerRadii = [];
  const fallbackRadius = Math.min(spanX, spanY) * 0.35;

  for (let i = 0; i < sampleCount; i++) {
    const angle = (i / sampleCount) * Math.PI * 2;
    let best = null;
    for (let j = 0; j < loopPoints.length; j++) {
      const a = loopPoints[j];
      const b = loopPoints[(j + 1) % loopPoints.length];
      const t = raySegmentDistance(cx, cy, angle, a, b);
      if (t === null) continue;
      if (best === null || t < best) best = t;
    }
    const radius = best !== null ? best : fallbackRadius;
    angles.push(angle);
    centerRadii.push(radius);
  }

  let perimeter = 0;
  for (let i = 0; i < loopPoints.length; i++) {
    const a = loopPoints[i];
    const b = loopPoints[(i + 1) % loopPoints.length];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }

  const spanBasedWidth = Math.min(spanX, spanY) * 0.11;
  const perimeterBasedWidth = perimeter / 90;
  const safeMaxWidth = Math.min(spanX, spanY) * 0.24;
  const halfWidth = clamp(Math.min(Math.max(spanBasedWidth, perimeterBasedWidth), safeMaxWidth), 24, 72);
  const outerA = Math.max(...loopPoints.map((p) => Math.abs(p.x - cx))) + halfWidth;
  const outerB = Math.max(...loopPoints.map((p) => Math.abs(p.y - cy))) + halfWidth;
  const innerA = Math.max(outerA - halfWidth * 2, 85);
  const innerB = Math.max(outerB - halfWidth * 2, 75);

  const outerScales = [];
  const innerScales = [];
  for (let i = 0; i < sampleCount; i++) {
    const angle = angles[i];
    const centerRadius = centerRadii[i];
    const outerTarget = centerRadius + halfWidth;
    const innerTarget = Math.max(28, centerRadius - halfWidth);
    const outerBase = ellipseRadiusAtAngle(angle, outerA, outerB);
    const innerBase = ellipseRadiusAtAngle(angle, innerA, innerB);
    outerScales.push(outerTarget / Math.max(outerBase, 1e-6));
    innerScales.push(innerTarget / Math.max(innerBase, 1e-6));
  }

  const frequencies = [1, 2, 3, 5, 7];
  preset.track = {
    ...preset.track,
    cx: Number(cx.toFixed(1)),
    cy: Number(cy.toFixed(1)),
    outerA: Number(outerA.toFixed(1)),
    outerB: Number(outerB.toFixed(1)),
    innerA: Number(innerA.toFixed(1)),
    innerB: Number(innerB.toFixed(1)),
    warpOuter: fitWarpProfile(angles, outerScales, frequencies, 0.22),
    warpInner: fitWarpProfile(angles, innerScales, frequencies, 0.24),
    centerlineHalfWidth: Number(halfWidth.toFixed(1)),
    centerlineLoop: loopPoints.map((p) => ({ x: Number(p.x.toFixed(1)), y: Number(p.y.toFixed(1)) })),
  };

  return true;
}

export function exportTrackPresetData(index) {
  const preset = getTrackPreset(index);
  return clonePresetData(preset);
}

export function saveTrackPreset(index) {
  const presetData = exportTrackPresetData(index);
  const savedById = readTrackEditsStorage();
  savedById[presetData.id] = presetData;
  writeTrackEditsStorage(savedById);
  return presetData;
}

export function importTrackPresetData(rawPreset, { persist = true } = {}) {
  const preset = upsertTrackPreset(rawPreset);
  if (!preset) return null;
  if (persist) {
    const savedById = readTrackEditsStorage();
    savedById[preset.id] = clonePresetData(preset);
    writeTrackEditsStorage(savedById);
  }
  return clonePresetData(preset);
}

async function discoverTrackJsonPaths() {
  try {
    const manifestRes = await fetch("tracks/index.json", { cache: "no-store" });
    if (manifestRes.ok) {
      const manifest = await manifestRes.json();
      if (Array.isArray(manifest)) {
        return manifest
          .filter((name) => typeof name === "string" && name.toLowerCase().endsWith(".json"))
          .map((name) => (name.startsWith("tracks/") ? name : `tracks/${name}`));
      }
    }
  } catch {
    // Fall through to directory listing discovery.
  }

  try {
    const dirRes = await fetch("tracks/", { cache: "no-store" });
    if (!dirRes.ok) return [];
    const html = await dirRes.text();
    const links = [...html.matchAll(/href=\"([^\"]+\.json)\"/gi)].map((m) => m[1]);
    const paths = links
      .filter((href) => !href.includes("..") && !href.toLowerCase().includes("index.json"))
      .map((href) => (href.startsWith("tracks/") ? href : `tracks/${href.replace(/^\.\//, "")}`));
    return Array.from(new Set(paths));
  } catch {
    return [];
  }
}

export async function loadTracksFromFolder() {
  const paths = await discoverTrackJsonPaths();
  let loadedCount = 0;
  for (const path of paths) {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) continue;
      const json = await res.json();
      if (importTrackPresetData(json, { persist: true })) loadedCount++;
    } catch {
      // Ignore malformed or inaccessible files.
    }
  }
  return loadedCount;
}

export const CURB_MIN_WIDTH = 3;
export const CURB_MAX_WIDTH = 22;
export const CURB_STRIPE_LENGTH = 10;
export const CURB_OUTSET = 20;

export const physicsConfig = {
  car: {
    maxSpeed: 350,
    engineAccel: 800,
    brakeDecel: 1500,
    coastDecel: 320,
    longDrag: 0.85,
    lateralGrip: 6.4,
    steerRate: 3.6,
    steerAtLowSpeedMul: 0.35,
    yawDamping: 8.0,
    reverseMaxSpeedMul: 0.32,
    inputSmoothing: 0.2,
    dtClamp: 0.033,
  },
  assists: {
    autoDriftGripCut: 0.3,
    driftAssistRecoveryBoost: 0.75,
    driftAssistRecoveryTime: 0.2,
    speedSensitiveSteer: 0.55,
    handbrakeGrip: 0.28,
    handbrakeYawBoost: 0.8,
    handbrakeLongDecel: 1400,
  },
  surfaces: {
    asphalt: { lateralGripMul: 0.95, longDragMul: 1.0, engineMul: 1.0, coastDecelMul: 1.0 },
    curb: { lateralGripMul: 1.18, longDragMul: 1.02, engineMul: 1.0, coastDecelMul: 1.05 },
    grass: { lateralGripMul: 0.85, longDragMul: 4.0, engineMul: 0.24, coastDecelMul: 5.0 },
    water: { lateralGripMul: 0.14, longDragMul: 3.3, engineMul: 0.22, coastDecelMul: 2.8 },
  },
  flags: {
    AUTO_DRIFT_ON_STEER: true,
    DRIFT_ASSIST_RECOVERY: false,
    HANDBRAKE_MODE: true,
    SPEED_SENSITIVE_STEERING: true,
    SURFACE_BLENDING: true,
    DEBUG_VECTORS: true,
    ARCADE_COLLISION_PUSH: true,
  },
  constants: {
    surfaceBlendTime: 0.05,
    driftSteerThreshold: 0.08,
    lowSpeedSteerAt: 120,
    pivotAtLowSpeedRatio: 0.5,
    pivotFromRearRatio: 0.9,
    pivotBlendSpeed: 320,
  },
};

import { deleteTrackById, fetchSharedTrack, fetchTrackById, fetchTracks, saveTrackToDb } from "./api.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

export { canvas, ctx };

export const WIDTH = canvas.width;
export const HEIGHT = canvas.height;

const PLAYER_NAME_STORAGE_KEY = "carun.playerName";
const DEBUG_MODE_STORAGE_KEY = "carun.debugMode";

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

function loadDebugMode(defaultValue) {
  try {
    const raw = localStorage.getItem(DEBUG_MODE_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // Ignore storage failures in restricted environments.
  }
  return defaultValue;
}

export function saveDebugMode(enabled) {
  try {
    localStorage.setItem(DEBUG_MODE_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export function getMenuItems(authenticated) {
  return authenticated ? ["RACE", "SETTINGS"] : ["LOGIN", "RACE ANONYMOUSLY", "SETTINGS"];
}

export function getLoginProviderItems() {
  return ["LOGIN WITH GOOGLE", "LOGIN WITH FACEBOOK", "BACK"];
}

export function getSettingsItems(authenticated) {
  return authenticated ? ["PLAYER NAME", "DEBUG MODE", "LOGOUT", "BACK"] : ["PLAYER NAME", "DEBUG MODE", "BACK"];
}
const TRACK_EDITS_STORAGE_KEY = "carun.trackEdits.v1";
const TRACK_PRESETS = [
  {
    id: "classic",
    name: "CLASSIC LOOP",
    track: {
      cx: WIDTH * 0.5,
      cy: HEIGHT * 0.53 - 60,
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
      { type: "tree", x: 150, y: 90, r: 26 },
      { type: "tree", x: 1080, y: 76, r: 24 },
      { type: "tree", x: 172, y: 536, r: 23 },
      { type: "tree", x: 1110, y: 520, r: 22 },
      { type: "pond", x: 650, y: 290, rx: 95, ry: 52, seed: 0.8 },
      { type: "pond", x: 215, y: 280, rx: 60, ry: 34, seed: -0.55 },
      { type: "barrel", x: 447, y: 93, r: 13 },
      { type: "barrel", x: 847, y: 507, r: 13 },
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
    source: preset.source || "local",
    ownerUserId: typeof preset.ownerUserId === "string" ? preset.ownerUserId : null,
    isPublished: Boolean(preset.isPublished),
    shareToken: typeof preset.shareToken === "string" ? preset.shareToken : null,
    canDelete: Boolean(preset.canDelete),
    fromDb: Boolean(preset.fromDb),
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
    source: typeof raw.source === "string" && raw.source.trim() ? raw.source.trim() : "local",
    ownerUserId:
      typeof raw.ownerUserId === "string"
        ? raw.ownerUserId
        : typeof raw.owner_user_id === "string"
          ? raw.owner_user_id
          : null,
    isPublished: Boolean(raw.isPublished ?? raw.is_published ?? false),
    shareToken:
      typeof raw.shareToken === "string"
        ? raw.shareToken
        : typeof raw.share_token === "string"
          ? raw.share_token
          : null,
    canDelete: Boolean(raw.canDelete ?? raw.can_delete ?? false),
    fromDb: Boolean(raw.fromDb ?? raw.from_db ?? false),
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
  trackOptions.push(
    ...TRACK_PRESETS.map(({ id, name, canDelete, isPublished, ownerUserId, fromDb, shareToken }) => ({
      id,
      name,
      canDelete: Boolean(canDelete),
      isPublished: Boolean(isPublished),
      ownerUserId: typeof ownerUserId === "string" ? ownerUserId : null,
      fromDb: Boolean(fromDb),
      shareToken: typeof shareToken === "string" ? shareToken : null,
    })),
  );
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

export function canDeleteTrackPreset(preset, currentUserId) {
  if (!preset || !preset.fromDb) return false;
  if (!currentUserId || preset.ownerUserId !== currentUserId) return false;
  return !preset.isPublished;
}

function updateTrackDeleteCapabilities(currentUserId) {
  for (const preset of TRACK_PRESETS) {
    preset.canDelete = canDeleteTrackPreset(preset, currentUserId);
  }
  rebuildTrackOptions();
}

export function setTrackPresetMetadata(trackId, updates, { currentUserId = null } = {}) {
  const preset = getTrackPresetById(trackId);
  if (!preset) return null;
  if (typeof updates.name === "string" && updates.name.trim()) preset.name = updates.name.trim().slice(0, 36);
  if (typeof updates.ownerUserId === "string" || updates.ownerUserId === null) preset.ownerUserId = updates.ownerUserId;
  if (typeof updates.isPublished === "boolean") preset.isPublished = updates.isPublished;
  if (typeof updates.shareToken === "string" || updates.shareToken === null) preset.shareToken = updates.shareToken;
  if (typeof updates.fromDb === "boolean") preset.fromDb = updates.fromDb;
  preset.canDelete = canDeleteTrackPreset(preset, currentUserId);
  rebuildTrackOptions();
  return clonePresetData(preset);
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

// Tunable cleanup amount applied when converting drawn centerline strokes
// into the final closed loop. Higher values remove more jitter and corners.
const CENTERLINE_SMOOTHING_COEFFICIENT = 0.1;

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

function pointToSegmentDistanceSquared(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-10) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return dx * dx + dy * dy;
  }
  const t = clamp((wx * vx + wy * vy) / lenSq, 0, 1);
  const cx = a.x + vx * t;
  const cy = a.y + vy * t;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy;
}

function simplifyOpenRdp(points, epsilon) {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  const sqEpsilon = epsilon * epsilon;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [start, end] = stack.pop();
    if (end - start <= 1) continue;
    let bestIndex = -1;
    let bestDistance = -1;
    for (let i = start + 1; i < end; i++) {
      const d = pointToSegmentDistanceSquared(points[i], points[start], points[end]);
      if (d > bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    if (bestDistance > sqEpsilon && bestIndex >= 0) {
      keep[bestIndex] = 1;
      stack.push([start, bestIndex], [bestIndex, end]);
    }
  }

  const simplified = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) simplified.push({ x: points[i].x, y: points[i].y });
  }
  return simplified;
}

function simplifyClosedLoop(points, epsilon) {
  if (!Array.isArray(points) || points.length < 4) return (points || []).map((p) => ({ x: p.x, y: p.y }));
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;

  let start = 0;
  let bestDist = -1;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - cx;
    const dy = points[i].y - cy;
    const d = dx * dx + dy * dy;
    if (d > bestDist) {
      bestDist = d;
      start = i;
    }
  }

  const open = [];
  for (let i = 0; i <= points.length; i++) {
    const p = points[(start + i) % points.length];
    open.push({ x: p.x, y: p.y });
  }
  const simplified = simplifyOpenRdp(open, epsilon);
  if (simplified.length <= 4) return points.map((p) => ({ x: p.x, y: p.y }));
  simplified.pop();
  return simplified;
}

function pruneTinyMovesClosed(points, minDistance) {
  if (!Array.isArray(points) || points.length < 4) return (points || []).map((p) => ({ x: p.x, y: p.y }));
  const out = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    const prevDist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const nextDist = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (prevDist < minDistance && nextDist < minDistance) continue;
    out.push({ x: curr.x, y: curr.y });
  }
  return out.length >= 3 ? out : points.map((p) => ({ x: p.x, y: p.y }));
}

function laplacianSmoothClosed(points, passes, strength) {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  let current = points.map((p) => ({ x: p.x, y: p.y }));
  const n = current.length;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Array(n);
    for (let i = 0; i < n; i++) {
      const prev = current[(i - 1 + n) % n];
      const curr = current[i];
      const after = current[(i + 1) % n];
      const tx = (prev.x + after.x) * 0.5;
      const ty = (prev.y + after.y) * 0.5;
      next[i] = {
        x: curr.x + (tx - curr.x) * strength,
        y: curr.y + (ty - curr.y) * strength,
      };
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

function normalizeVec(x, y) {
  const len = Math.hypot(x, y);
  if (len < 1e-8) return { x: 1, y: 0 };
  return { x: x / len, y: y / len };
}

function intersectLines(aPoint, aDir, bPoint, bDir) {
  const det = aDir.x * bDir.y - aDir.y * bDir.x;
  if (Math.abs(det) < 1e-8) return null;
  const dx = bPoint.x - aPoint.x;
  const dy = bPoint.y - aPoint.y;
  const t = (dx * bDir.y - dy * bDir.x) / det;
  return {
    x: aPoint.x + aDir.x * t,
    y: aPoint.y + aDir.y * t,
  };
}

function signedLoopArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum * 0.5;
}

function offsetClosedLoop(points, offset, miterLimit = 2.6) {
  if (!Array.isArray(points) || points.length < 3) return [];
  const n = points.length;
  const orientation = signedLoopArea(points) < 0 ? 1 : -1;
  const signedOffset = offset * orientation;
  const out = new Array(n);

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    const inDir = normalizeVec(curr.x - prev.x, curr.y - prev.y);
    const outDir = normalizeVec(next.x - curr.x, next.y - curr.y);
    const inNormal = { x: -inDir.y, y: inDir.x };
    const outNormal = { x: -outDir.y, y: outDir.x };

    const inPoint = {
      x: curr.x + inNormal.x * signedOffset,
      y: curr.y + inNormal.y * signedOffset,
    };
    const outPoint = {
      x: curr.x + outNormal.x * signedOffset,
      y: curr.y + outNormal.y * signedOffset,
    };

    const candidate = intersectLines(inPoint, inDir, outPoint, outDir);
    if (candidate) {
      const miterLen = Math.hypot(candidate.x - curr.x, candidate.y - curr.y);
      if (miterLen <= Math.abs(signedOffset) * miterLimit + 1e-6) {
        out[i] = candidate;
        continue;
      }
    }

    const avg = normalizeVec(inNormal.x + outNormal.x, inNormal.y + outNormal.y);
    out[i] = {
      x: curr.x + avg.x * signedOffset,
      y: curr.y + avg.y * signedOffset,
    };
  }
  return out;
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
  const anchor = rawLoop[0];
  const amount = clamp(CENTERLINE_SMOOTHING_COEFFICIENT, 0, 1);
  const simplifyEpsilon = 3 + amount * 11;
  const tinyMoveCutoff = 1.25 + amount * 4.75;
  const laplacianPasses = Math.round(2 + amount * 5);
  const laplacianStrength = 0.35 + amount * 0.4;
  const chaikinIterations = Math.round(2 + amount * 3);

  const simplifiedLoop = simplifyClosedLoop(rawLoop, simplifyEpsilon);
  const prunedLoop = pruneTinyMovesClosed(simplifiedLoop, tinyMoveCutoff);
  const laplacianLoop = laplacianSmoothClosed(prunedLoop, laplacianPasses, laplacianStrength);
  const smoothedLoop = chaikinSmoothClosed(laplacianLoop, chaikinIterations);
  const loopPoints = resampleClosedLoop(smoothedLoop, 220);
  if (loopPoints.length > 0 && anchor) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < loopPoints.length; i++) {
      const dx = loopPoints[i].x - anchor.x;
      const dy = loopPoints[i].y - anchor.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx > 0) {
      const rotated = loopPoints.slice(bestIdx).concat(loopPoints.slice(0, bestIdx));
      loopPoints.length = 0;
      loopPoints.push(...rotated);
    }
  }
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
  const outerLoop = offsetClosedLoop(loopPoints, halfWidth);
  const innerLoop = offsetClosedLoop(loopPoints, -halfWidth);
  const outerA = Math.max(...outerLoop.map((p) => Math.abs(p.x - cx)));
  const outerB = Math.max(...outerLoop.map((p) => Math.abs(p.y - cy)));
  const innerA = Math.max(...innerLoop.map((p) => Math.abs(p.x - cx)));
  const innerB = Math.max(...innerLoop.map((p) => Math.abs(p.y - cy)));

  const sampleCount = 180;
  const angles = [];
  const outerScales = [];
  const innerScales = [];
  const fallbackOuter = Math.max(outerA, outerB);
  const fallbackInner = Math.max(24, Math.max(innerA, innerB));

  for (let i = 0; i < sampleCount; i++) {
    const angle = (i / sampleCount) * Math.PI * 2;
    angles.push(angle);
    let outerTarget = null;
    let innerTarget = null;
    for (let j = 0; j < outerLoop.length; j++) {
      const a = outerLoop[j];
      const b = outerLoop[(j + 1) % outerLoop.length];
      const t = raySegmentDistance(cx, cy, angle, a, b);
      if (t === null) continue;
      if (outerTarget === null || t > outerTarget) outerTarget = t;
    }
    for (let j = 0; j < innerLoop.length; j++) {
      const a = innerLoop[j];
      const b = innerLoop[(j + 1) % innerLoop.length];
      const t = raySegmentDistance(cx, cy, angle, a, b);
      if (t === null) continue;
      if (innerTarget === null || t < innerTarget) innerTarget = t;
    }

    outerTarget = outerTarget === null ? fallbackOuter : outerTarget;
    innerTarget = innerTarget === null ? fallbackInner : innerTarget;
    const clampedInnerTarget = Math.max(24, Math.min(innerTarget, outerTarget - 12));
    const outerBase = ellipseRadiusAtAngle(angle, outerA, outerB);
    const innerBase = ellipseRadiusAtAngle(angle, innerA, innerB);
    outerScales.push(outerTarget / Math.max(outerBase, 1e-6));
    innerScales.push(clampedInnerTarget / Math.max(innerBase, 1e-6));
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
    startAngle: 0,
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

export function removeTrackPresetById(id, { removePersisted = true } = {}) {
  const idx = TRACK_PRESETS.findIndex((preset) => preset.id === id);
  if (idx < 0) return false;
  TRACK_PRESETS.splice(idx, 1);
  rebuildTrackOptions();

  if (removePersisted) {
    const savedById = readTrackEditsStorage();
    if (Object.prototype.hasOwnProperty.call(savedById, id)) {
      delete savedById[id];
      writeTrackEditsStorage(savedById);
    }
  }
  return true;
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

function buildPresetFromApiTrack(raw) {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw.track_payload_json && typeof raw.track_payload_json === "object" ? raw.track_payload_json : {};
  return {
    ...payload,
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : payload.name,
    source: typeof raw.source === "string" ? raw.source : "user",
    ownerUserId: typeof raw.owner_user_id === "string" ? raw.owner_user_id : null,
    isPublished: Boolean(raw.is_published),
    shareToken: typeof raw.share_token === "string" ? raw.share_token : null,
    canDelete: false,
    fromDb: true,
  };
}

export async function loadVisibleTracksFromApi({ currentUserId = null } = {}) {
  let tracks = [];
  try {
    tracks = await fetchTracks();
  } catch {
    return { loaded: 0 };
  }

  // When DB tracks are available, make them the source of truth for runtime selection.
  if (tracks.length > 0) {
    TRACK_PRESETS.length = 0;
    rebuildTrackOptions();
  }

  let loaded = 0;
  for (const rawTrack of tracks) {
    const preset = buildPresetFromApiTrack(rawTrack);
    if (!preset) continue;
    if (importTrackPresetData(preset, { persist: false })) loaded += 1;
  }
  updateTrackDeleteCapabilities(currentUserId);
  return { loaded };
}

export async function loadTrackPresetFromApi(trackId, { currentUserId = null } = {}) {
  const cleanId = normalizePresetId(trackId);
  if (!cleanId) return null;
  const existing = getTrackPresetById(cleanId);
  if (existing) return clonePresetData(existing);

  const rawTrack = await fetchTrackById(cleanId);
  const preset = buildPresetFromApiTrack(rawTrack);
  if (!preset) return null;
  const imported = importTrackPresetData(preset, { persist: false });
  if (imported) updateTrackDeleteCapabilities(currentUserId);
  return imported;
}

export async function saveTrackPresetToDb(index, { currentUserId = null } = {}) {
  const presetData = exportTrackPresetData(index);
  const name =
    typeof presetData.name === "string" && presetData.name.trim() ? presetData.name.trim() : `Track ${Date.now()}`;
  const createdTrack = await saveTrackToDb(name, presetData);
  const mergedPreset = {
    ...presetData,
    id: createdTrack.id,
    name: createdTrack.name,
    source: createdTrack.source || "user",
    ownerUserId: createdTrack.owner_user_id || null,
    isPublished: Boolean(createdTrack.is_published),
    shareToken: createdTrack.share_token || null,
    canDelete: true,
    fromDb: true,
  };
  const imported = importTrackPresetData(mergedPreset, { persist: false });
  if (imported) updateTrackDeleteCapabilities(currentUserId);
  return imported;
}

export async function loadSharedTrackFromApi(shareToken, { currentUserId = null } = {}) {
  const rawTrack = await fetchSharedTrack(shareToken);
  const preset = buildPresetFromApiTrack({
    ...rawTrack,
    is_published: false,
    owner_user_id: null,
    share_token: shareToken,
  });
  if (!preset) return null;
  preset.canDelete = false;
  const imported = importTrackPresetData(preset, { persist: false });
  if (imported) updateTrackDeleteCapabilities(currentUserId);
  return imported;
}

export async function deleteOwnTrackFromApi(trackId) {
  const cleanId = normalizePresetId(trackId);
  if (!cleanId) return;
  await deleteTrackById(cleanId);
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
    DEBUG_MODE: loadDebugMode(false),
    ARCADE_COLLISION_PUSH: true,
  },
  constants: {
    surfaceBlendTime: 0.1,
    driftSteerThreshold: 0.08,
    lowSpeedSteerAt: 120,
    pivotAtLowSpeedRatio: 0.5,
    pivotFromRearRatio: 0.9,
    pivotBlendSpeed: 320,
  },
};

import {
  deleteTrackById,
  fetchSharedTrack,
  fetchTrackById,
  fetchTracks,
  saveTrackToDb,
  updateTrackInDb,
} from "./api.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

export { canvas, ctx };

export const WIDTH = canvas.width;
export const HEIGHT = canvas.height;

const PLAYER_NAME_STORAGE_KEY = "carun.playerName";
const DEBUG_MODE_STORAGE_KEY = "carun.debugMode";
const MENU_MUSIC_STORAGE_KEY = "carun.menuMusicEnabled";
const AI_OPPONENTS_STORAGE_KEY = "carun.aiOpponentsEnabled";
const AI_OPPONENT_COUNT_STORAGE_KEY = "carun.aiOpponentCount";
const PLAYER_COLOR_STORAGE_KEY = "carun.playerColor";
const SIDEWAYS_DRIFT_STORAGE_KEY = "carun.sidewaysDriftEnabled";
const OBJECT_DEFAULTS = {
  tree: { height: 1.5, r: 24, angle: 0 },
  barrel: { height: 1, r: 12, angle: 0 },
  spring: { height: 0.4, r: 16, angle: 0 },
  wall: { height: 1, width: 18, length: 90, angle: 0 },
  pond: { angle: 0 },
  oil: { angle: 0 },
};

export function sanitizePlayerName(raw) {
  if (typeof raw !== "string") return "PLAYER";
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .trim()
    .slice(0, 12);
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

export const CAR_COLOR_PALETTE = [
  { id: "sky", label: "SKY", hex: "#4db3ff" },
  { id: "mint", label: "MINT", hex: "#66d987" },
  { id: "gold", label: "GOLD", hex: "#ffd25e" },
  { id: "orange", label: "ORANGE", hex: "#ff8f5c" },
  { id: "violet", label: "VIOLET", hex: "#bf8cff" },
  { id: "crimson", label: "CRIMSON", hex: "#d22525" },
  { id: "teal", label: "TEAL", hex: "#34d1c6" },
  { id: "pink", label: "PINK", hex: "#ff6fae" },
];
export const DEFAULT_PLAYER_COLOR = "crimson";

export function getCarColorOption(colorId) {
  return (
    CAR_COLOR_PALETTE.find((option) => option.id === colorId) ||
    CAR_COLOR_PALETTE.find((option) => option.id === DEFAULT_PLAYER_COLOR) ||
    CAR_COLOR_PALETTE[0]
  );
}

export function sanitizeCarColor(colorId, fallback = DEFAULT_PLAYER_COLOR) {
  const raw = typeof colorId === "string" ? colorId.trim().toLowerCase() : "";
  const match = CAR_COLOR_PALETTE.find((option) => option.id === raw);
  if (match) return match.id;
  return getCarColorOption(fallback).id;
}

export function getCarColorLabel(colorId) {
  return getCarColorOption(colorId).label;
}

export function getCarColorHex(colorId) {
  return getCarColorOption(colorId).hex;
}

export function loadPlayerColor(defaultValue = DEFAULT_PLAYER_COLOR) {
  try {
    const raw = localStorage.getItem(PLAYER_COLOR_STORAGE_KEY);
    if (raw !== null) return sanitizeCarColor(raw, defaultValue);
  } catch {
    // Ignore storage failures in restricted environments.
  }
  return sanitizeCarColor(defaultValue);
}

export function savePlayerColor(colorId) {
  try {
    localStorage.setItem(PLAYER_COLOR_STORAGE_KEY, sanitizeCarColor(colorId, DEFAULT_PLAYER_COLOR));
  } catch {
    // Ignore storage failures in restricted environments.
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

export function loadMenuMusicEnabled(defaultValue = true) {
  try {
    const raw = localStorage.getItem(MENU_MUSIC_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // Ignore storage failures in restricted environments.
  }
  return defaultValue;
}

export function saveMenuMusicEnabled(enabled) {
  try {
    localStorage.setItem(MENU_MUSIC_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export function loadAiOpponentsEnabled(defaultValue = false) {
  try {
    const raw = localStorage.getItem(AI_OPPONENTS_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // Ignore storage failures in restricted environments.
  }
  return defaultValue;
}

export function saveAiOpponentsEnabled(enabled) {
  try {
    localStorage.setItem(AI_OPPONENTS_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export const MIN_AI_OPPONENT_COUNT = 1;
export const MAX_AI_OPPONENT_COUNT = 5;
export const DEFAULT_AI_OPPONENT_COUNT = 3;

export function sanitizeAiOpponentCount(raw) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return DEFAULT_AI_OPPONENT_COUNT;
  return Math.max(MIN_AI_OPPONENT_COUNT, Math.min(MAX_AI_OPPONENT_COUNT, Math.round(numeric)));
}

export function loadAiOpponentCount(defaultValue = DEFAULT_AI_OPPONENT_COUNT) {
  try {
    const raw = localStorage.getItem(AI_OPPONENT_COUNT_STORAGE_KEY);
    if (raw !== null) return sanitizeAiOpponentCount(raw);
  } catch {
    // Ignore storage failures in restricted environments.
  }
  return sanitizeAiOpponentCount(defaultValue);
}

export function saveAiOpponentCount(count) {
  try {
    localStorage.setItem(AI_OPPONENT_COUNT_STORAGE_KEY, String(sanitizeAiOpponentCount(count)));
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export function loadSidewaysDriftEnabled(defaultValue = true) {
  try {
    const raw = localStorage.getItem(SIDEWAYS_DRIFT_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // Ignore storage failures in restricted environments.
  }
  return defaultValue;
}

export function saveSidewaysDriftEnabled(enabled) {
  try {
    localStorage.setItem(SIDEWAYS_DRIFT_STORAGE_KEY, enabled ? "true" : "false");
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

export const AI_OPPONENT_COUNT = MAX_AI_OPPONENT_COUNT;
export const AI_PRECISE_NAME_POOL = [
  "Nitro Nick",
  "Drift King",
  "Burnout Ben",
  "Max Oversteer",
  "Lenny Launch",
  "Polly Piston",
];
export const AI_BUMP_NAME_POOL = [
  "Skidmark Steve",
  "Burnout Ben",
  "Bumpy Bumper",
  "Cpt. Sideways",
  "Squeaky Brakes",
  "Greasy Gears",
  "Ollie Oilspill",
  "Crashy Carl",
];
export const AI_LONG_NAME_POOL = ["Chuck Chicane", "Pete Stop", "Turbo Tina", "Loopy Lap"];
export const AI_OPPONENT_NAME_POOL = [
  ...new Set([...AI_PRECISE_NAME_POOL, ...AI_BUMP_NAME_POOL, ...AI_LONG_NAME_POOL]),
];
export const AI_DRIVING_STYLE_POOL = ["precise", "long", "bump"];
export const TOURNAMENT_POINTS = [10, 8, 6, 4, 3, 2];

export function getGameModeItems() {
  return ["SINGLE RACE", "TOURNAMENT", "BACK"];
}

export function getSettingsItems(authenticated) {
  return authenticated
    ? [
        "PLAYER NAME",
        "PLAYER COLOR",
        "MENU MUSIC",
        "AI OPPONENTS",
        "SIDEWAYS DRIFT",
        "DEBUG MODE",
        "LOGOUT",
        "BACK",
      ]
    : [
        "PLAYER NAME",
        "PLAYER COLOR",
        "MENU MUSIC",
        "AI OPPONENTS",
        "SIDEWAYS DRIFT",
        "DEBUG MODE",
        "BACK",
      ];
}
const TRACK_EDITS_STORAGE_KEY = "carun.trackEdits.v1";
export const CENTERLINE_SMOOTHING_MODES = ["raw", "light", "smooth"];
export const DEFAULT_CENTERLINE_SMOOTHING_MODE = "light";
const TRACK_PRESETS = [
  {
    id: "bootstrap",
    name: "BOOTSTRAP",
    track: {
      cx: WIDTH * 0.5,
      cy: HEIGHT * 0.53 - 60,
      borderSize: 22,
      centerlineLoop: [
        { x: WIDTH * 0.19, y: HEIGHT * 0.27 },
        { x: WIDTH * 0.34, y: HEIGHT * 0.17 },
        { x: WIDTH * 0.62, y: HEIGHT * 0.17 },
        { x: WIDTH * 0.81, y: HEIGHT * 0.31 },
        { x: WIDTH * 0.8, y: HEIGHT * 0.64 },
        { x: WIDTH * 0.63, y: HEIGHT * 0.79 },
        { x: WIDTH * 0.34, y: HEIGHT * 0.79 },
        { x: WIDTH * 0.18, y: HEIGHT * 0.61 },
      ],
      centerlineHalfWidth: 60,
      centerlineWidthProfile: new Array(8).fill(60),
      worldScale: 1,
      centerlineSmoothingMode: DEFAULT_CENTERLINE_SMOOTHING_MODE,
      startAngle: 0,
    },
    checkpoints: [
      { angle: 0 },
      { angle: Math.PI * 0.5 },
      { angle: Math.PI },
      { angle: Math.PI * 1.5 },
    ],
    worldObjects: [
      { type: "tree", x: 150, y: 90, r: 26, angle: 0, height: 3 },
      { type: "tree", x: 1080, y: 76, r: 24, angle: 0, height: 3 },
      { type: "tree", x: 172, y: 536, r: 23, angle: 0, height: 3 },
      { type: "tree", x: 1110, y: 520, r: 22, angle: 0, height: 3 },
      { type: "pond", x: 650, y: 290, rx: 95, ry: 52, seed: 0.8, angle: 0 },
      { type: "pond", x: 215, y: 280, rx: 60, ry: 34, seed: -0.55, angle: 0 },
      { type: "barrel", x: 447, y: 93, r: 13, angle: 0, height: 1 },
      { type: "barrel", x: 847, y: 507, r: 13, angle: 0, height: 1 },
    ],
    centerlineStrokes: [],
    editStack: [],
  },
];

function cloneCenterlinePoint(point, fallbackHalfWidth = 60) {
  return {
    x: Number(point?.x) || 0,
    y: Number(point?.y) || 0,
    halfWidth: Number.isFinite(point?.halfWidth) ? Number(point.halfWidth) : fallbackHalfWidth,
  };
}

function cloneWorldObject(obj) {
  const type = typeof obj?.type === "string" ? obj.type : "tree";
  const defaults = OBJECT_DEFAULTS[type] || { angle: 0 };
  const base = {
    ...obj,
    type,
    angle: Number.isFinite(obj?.angle) ? Number(obj.angle) : defaults.angle || 0,
  };

  if (type === "tree" || type === "barrel" || type === "spring") {
    base.r = Number.isFinite(obj?.r) ? Number(obj.r) : defaults.r;
    base.height = Number.isFinite(obj?.height) ? Number(obj.height) : defaults.height;
    return base;
  }

  if (type === "wall") {
    base.width = Number.isFinite(obj?.width) ? Number(obj.width) : defaults.width;
    base.length = Number.isFinite(obj?.length) ? Number(obj.length) : defaults.length;
    base.height = Number.isFinite(obj?.height) ? Number(obj.height) : defaults.height;
    return base;
  }

  if (type === "pond" || type === "oil") {
    base.rx = Number.isFinite(obj?.rx) ? Number(obj.rx) : 78;
    base.ry = Number.isFinite(obj?.ry) ? Number(obj.ry) : 44;
    base.seed = Number.isFinite(obj?.seed) ? Number(obj.seed) : 0;
    return base;
  }

  return base;
}

function cloneTrackData(trackData) {
  return {
    ...trackData,
    centerlineLoop: Array.isArray(trackData.centerlineLoop)
      ? trackData.centerlineLoop.map((p) => ({ x: p.x, y: p.y }))
      : null,
    centerlineWidthProfile: Array.isArray(trackData.centerlineWidthProfile)
      ? trackData.centerlineWidthProfile.map((value) => Number(value) || 0)
      : null,
    worldScale: Number.isFinite(trackData.worldScale) ? Number(trackData.worldScale) : 1,
    centerlineSmoothingMode: normalizeCenterlineSmoothingMode(trackData.centerlineSmoothingMode),
  };
}

function normalizeCheckpointProgress(progress) {
  const value = Number(progress);
  if (!Number.isFinite(value)) return 0;
  return ((value % 1) + 1) % 1;
}

function checkpointProgressFromAngle(angle) {
  const turns = Number(angle) / (Math.PI * 2);
  return normalizeCheckpointProgress(turns);
}

function checkpointDeltaFromStart(progress, startProgress) {
  return normalizeCheckpointProgress(progress - startProgress);
}

function normalizeCheckpointEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (Number.isFinite(raw.progress)) {
    return { progress: normalizeCheckpointProgress(raw.progress) };
  }
  if (Number.isFinite(raw.angle)) {
    return { progress: checkpointProgressFromAngle(raw.angle) };
  }
  return null;
}

function dedupeCheckpointEntries(entries, tolerance = 0.0035) {
  const out = [];
  for (const entry of entries) {
    const duplicate = out.some(
      (existing) =>
        Math.abs(checkpointDeltaFromStart(entry.progress, existing.progress)) < tolerance ||
        Math.abs(checkpointDeltaFromStart(existing.progress, entry.progress)) < tolerance,
    );
    if (!duplicate) out.push(entry);
  }
  return out;
}

function normalizeCheckpointList(rawCheckpoints, trackData = {}) {
  if (!Array.isArray(rawCheckpoints) || !rawCheckpoints.length) return [];
  const startProgress = checkpointProgressFromAngle(trackData.startAngle || 0);
  const hasCanonicalProgress = rawCheckpoints.some((cp) => Number.isFinite(cp?.progress));
  let entries = rawCheckpoints.map(normalizeCheckpointEntry).filter(Boolean);
  if (!entries.length) return [];

  if (!hasCanonicalProgress) {
    let closestIndex = 0;
    let closestDelta = Infinity;
    for (let i = 0; i < entries.length; i++) {
      const delta = Math.min(
        checkpointDeltaFromStart(entries[i].progress, startProgress),
        checkpointDeltaFromStart(startProgress, entries[i].progress),
      );
      if (delta < closestDelta) {
        closestDelta = delta;
        closestIndex = i;
      }
    }
    entries = entries.filter((_, index) => index !== closestIndex);
  }

  entries = dedupeCheckpointEntries(entries);
  entries.sort(
    (a, b) =>
      checkpointDeltaFromStart(a.progress, startProgress) -
      checkpointDeltaFromStart(b.progress, startProgress),
  );
  return entries.map((entry) => ({ progress: entry.progress }));
}

function buildRuntimeCheckpointList(trackData = {}, rawCheckpoints = []) {
  const startProgress = checkpointProgressFromAngle(trackData.startAngle || 0);
  const intermediates = normalizeCheckpointList(rawCheckpoints, trackData).map((checkpoint) => ({
    progress: checkpoint.progress,
    isStart: false,
  }));
  return [{ progress: startProgress, isStart: true }, ...intermediates];
}

export function normalizeCenterlineSmoothingMode(raw) {
  return CENTERLINE_SMOOTHING_MODES.includes(raw) ? raw : DEFAULT_CENTERLINE_SMOOTHING_MODE;
}

function clonePresetData(preset) {
  const trackData = cloneTrackData(preset.track);
  return {
    id: preset.id,
    name: preset.name,
    source: preset.source || "local",
    ownerUserId: typeof preset.ownerUserId === "string" ? preset.ownerUserId : null,
    ownerDisplayName: typeof preset.ownerDisplayName === "string" ? preset.ownerDisplayName : null,
    bestLapMs: Number.isFinite(preset.bestLapMs) ? preset.bestLapMs : null,
    bestLapDisplayName:
      typeof preset.bestLapDisplayName === "string" ? preset.bestLapDisplayName : null,
    bestRaceMs: Number.isFinite(preset.bestRaceMs) ? preset.bestRaceMs : null,
    bestRaceDisplayName:
      typeof preset.bestRaceDisplayName === "string" ? preset.bestRaceDisplayName : null,
    isPublished: Boolean(preset.isPublished),
    shareToken: typeof preset.shareToken === "string" ? preset.shareToken : null,
    canDelete: Boolean(preset.canDelete),
    fromDb: Boolean(preset.fromDb),
    track: trackData,
    checkpoints: normalizeCheckpointList(preset.checkpoints || [], trackData),
    worldObjects: (preset.worldObjects || []).map(cloneWorldObject),
    centerlineStrokes: (preset.centerlineStrokes || []).map((stroke) =>
      stroke.map((p) => cloneCenterlinePoint(p, Number(preset.track?.centerlineHalfWidth) || 60)),
    ),
    editStack: (preset.editStack || []).map((entry) => ({ ...entry })),
  };
}

function normalizePresetId(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .slice(0, 48);
}

function normalizeTrackPresetData(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = normalizePresetId(raw.id || raw.name || `track-${Date.now()}`);
  if (!id) return null;

  const safeTrack = cloneTrackData(raw.track || {});
  if (!Number.isFinite(safeTrack.cx) || !Number.isFinite(safeTrack.cy)) {
    return null;
  }

  safeTrack.borderSize = Number.isFinite(safeTrack.borderSize) ? safeTrack.borderSize : 22;
  safeTrack.centerlineHalfWidth = Number.isFinite(safeTrack.centerlineHalfWidth)
    ? Number(safeTrack.centerlineHalfWidth)
    : 60;
  safeTrack.centerlineWidthProfile = Array.isArray(safeTrack.centerlineWidthProfile)
    ? safeTrack.centerlineWidthProfile.map((value) =>
        Number.isFinite(value) ? Number(value) : safeTrack.centerlineHalfWidth,
      )
    : null;
  safeTrack.worldScale = Number.isFinite(safeTrack.worldScale) ? Number(safeTrack.worldScale) : 1;
  safeTrack.centerlineSmoothingMode = normalizeCenterlineSmoothingMode(
    safeTrack.centerlineSmoothingMode,
  );

  return {
    id,
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 36)
        : id.toUpperCase(),
    source: typeof raw.source === "string" && raw.source.trim() ? raw.source.trim() : "local",
    ownerUserId:
      typeof raw.ownerUserId === "string"
        ? raw.ownerUserId
        : typeof raw.owner_user_id === "string"
          ? raw.owner_user_id
          : null,
    ownerDisplayName:
      typeof raw.ownerDisplayName === "string"
        ? raw.ownerDisplayName
        : typeof raw.owner_display_name === "string"
          ? raw.owner_display_name
          : null,
    bestLapMs: Number.isFinite(raw.bestLapMs)
      ? Number(raw.bestLapMs)
      : Number.isFinite(raw.best_lap_ms)
        ? Number(raw.best_lap_ms)
        : null,
    bestLapDisplayName:
      typeof raw.bestLapDisplayName === "string"
        ? raw.bestLapDisplayName
        : typeof raw.best_lap_display_name === "string"
          ? raw.best_lap_display_name
          : null,
    bestRaceMs: Number.isFinite(raw.bestRaceMs)
      ? Number(raw.bestRaceMs)
      : Number.isFinite(raw.best_race_ms)
        ? Number(raw.best_race_ms)
        : null,
    bestRaceDisplayName:
      typeof raw.bestRaceDisplayName === "string"
        ? raw.bestRaceDisplayName
        : typeof raw.best_race_display_name === "string"
          ? raw.best_race_display_name
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
    checkpoints: normalizeCheckpointList(raw.checkpoints, safeTrack),
    worldObjects: Array.isArray(raw.worldObjects) ? raw.worldObjects.map(cloneWorldObject) : [],
    centerlineStrokes: Array.isArray(raw.centerlineStrokes)
      ? raw.centerlineStrokes.map((stroke) =>
          Array.isArray(stroke)
            ? stroke.map((p) => cloneCenterlinePoint(p, safeTrack.centerlineHalfWidth))
            : [],
        )
      : [],
    editStack: Array.isArray(raw.editStack) ? raw.editStack.map((e) => ({ ...e })) : [],
  };
}

function normalizeAllTrackPresetCheckpoints() {
  for (const preset of TRACK_PRESETS) {
    preset.checkpoints = normalizeCheckpointList(preset.checkpoints, preset.track);
  }
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
    if (Array.isArray(saved.checkpoints))
      preset.checkpoints = normalizeCheckpointList(saved.checkpoints, preset.track);
    if (Array.isArray(saved.worldObjects))
      preset.worldObjects = saved.worldObjects.map(cloneWorldObject);
    if (Array.isArray(saved.centerlineStrokes)) {
      preset.centerlineStrokes = saved.centerlineStrokes.map((stroke) =>
        Array.isArray(stroke)
          ? stroke.map((p) =>
              cloneCenterlinePoint(p, Number(saved.track?.centerlineHalfWidth) || 60),
            )
          : [],
      );
    }
    if (Array.isArray(saved.editStack)) {
      preset.editStack = saved.editStack.map((entry) => ({ ...entry }));
    }
  }
}

normalizeAllTrackPresetCheckpoints();
applyPersistedTrackEdits();
normalizeAllTrackPresetCheckpoints();

const activePreset = TRACK_PRESETS[0];

export const trackOptions = [];

function rebuildTrackOptions() {
  trackOptions.length = 0;
  trackOptions.push(
    ...TRACK_PRESETS.map(
      ({
        id,
        name,
        canDelete,
        isPublished,
        ownerUserId,
        ownerDisplayName,
        bestLapMs,
        bestLapDisplayName,
        bestRaceMs,
        bestRaceDisplayName,
        fromDb,
        shareToken,
      }) => ({
        id,
        name,
        canDelete: Boolean(canDelete),
        isPublished: Boolean(isPublished),
        ownerUserId: typeof ownerUserId === "string" ? ownerUserId : null,
        ownerDisplayName: typeof ownerDisplayName === "string" ? ownerDisplayName : null,
        bestLapMs: Number.isFinite(bestLapMs) ? bestLapMs : null,
        bestLapDisplayName: typeof bestLapDisplayName === "string" ? bestLapDisplayName : null,
        bestRaceMs: Number.isFinite(bestRaceMs) ? bestRaceMs : null,
        bestRaceDisplayName: typeof bestRaceDisplayName === "string" ? bestRaceDisplayName : null,
        fromDb: Boolean(fromDb),
        shareToken: typeof shareToken === "string" ? shareToken : null,
      }),
    ),
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
  centerlineLoop: Array.isArray(activePreset.track.centerlineLoop)
    ? activePreset.track.centerlineLoop.map((p) => ({ x: p.x, y: p.y }))
    : null,
  centerlineWidthProfile: Array.isArray(activePreset.track.centerlineWidthProfile)
    ? activePreset.track.centerlineWidthProfile.map((value) => Number(value) || 0)
    : null,
};

export const checkpoints = buildRuntimeCheckpointList(activePreset.track, activePreset.checkpoints);

export const CHECKPOINT_WIDTH_MULTIPLIER = 2;

export const worldObjects = activePreset.worldObjects.map((obj) => ({
  ...cloneWorldObject(obj),
}));

export function getTrackPreset(index) {
  return TRACK_PRESETS[index] || TRACK_PRESETS[0];
}

export function getTrackPresetById(id) {
  return TRACK_PRESETS.find((preset) => preset.id === id) || null;
}

export function canDeleteTrackPreset(preset, currentUserId, currentUserIsAdmin = false) {
  if (!preset || !preset.fromDb) return false;
  if (!currentUserIsAdmin) {
    if (!currentUserId || preset.ownerUserId !== currentUserId) return false;
  }
  return !preset.isPublished;
}

function updateTrackDeleteCapabilities(currentUserId, currentUserIsAdmin = false) {
  for (const preset of TRACK_PRESETS) {
    preset.canDelete = canDeleteTrackPreset(preset, currentUserId, currentUserIsAdmin);
  }
  rebuildTrackOptions();
}

export function setTrackPresetMetadata(
  trackId,
  updates,
  { currentUserId = null, currentUserIsAdmin = false } = {},
) {
  const preset = getTrackPresetById(trackId);
  if (!preset) return null;
  if (typeof updates.name === "string" && updates.name.trim())
    preset.name = updates.name.trim().slice(0, 36);
  if (typeof updates.ownerUserId === "string" || updates.ownerUserId === null)
    preset.ownerUserId = updates.ownerUserId;
  if (typeof updates.ownerDisplayName === "string" || updates.ownerDisplayName === null) {
    preset.ownerDisplayName = updates.ownerDisplayName;
  }
  if (Number.isFinite(updates.bestLapMs) || updates.bestLapMs === null) {
    preset.bestLapMs = Number.isFinite(updates.bestLapMs) ? Number(updates.bestLapMs) : null;
  }
  if (typeof updates.bestLapDisplayName === "string" || updates.bestLapDisplayName === null) {
    preset.bestLapDisplayName = updates.bestLapDisplayName;
  }
  if (Number.isFinite(updates.bestRaceMs) || updates.bestRaceMs === null) {
    preset.bestRaceMs = Number.isFinite(updates.bestRaceMs) ? Number(updates.bestRaceMs) : null;
  }
  if (typeof updates.bestRaceDisplayName === "string" || updates.bestRaceDisplayName === null) {
    preset.bestRaceDisplayName = updates.bestRaceDisplayName;
  }
  if (typeof updates.isPublished === "boolean") preset.isPublished = updates.isPublished;
  if (typeof updates.shareToken === "string" || updates.shareToken === null)
    preset.shareToken = updates.shareToken;
  if (typeof updates.fromDb === "boolean") preset.fromDb = updates.fromDb;
  preset.canDelete = canDeleteTrackPreset(preset, currentUserId, currentUserIsAdmin);
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
    centerlineLoop,
    centerlineWidthProfile: Array.isArray(preset.track.centerlineWidthProfile)
      ? preset.track.centerlineWidthProfile.map((value) => Number(value) || 0)
      : null,
  });

  checkpoints.length = 0;
  checkpoints.push(...buildRuntimeCheckpointList(preset.track, preset.checkpoints));

  worldObjects.length = 0;
  worldObjects.push(...preset.worldObjects.map(cloneWorldObject));
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
    const fromHalfWidth = Number.isFinite(from.halfWidth) ? from.halfWidth : 60;
    const toHalfWidth = Number.isFinite(to.halfWidth) ? to.halfWidth : fromHalfWidth;
    points.push({ x: from.x + dx * t, y: from.y + dy * t });
    points[points.length - 1].halfWidth = fromHalfWidth + (toHalfWidth - fromHalfWidth) * t;
  }
}

const CENTERLINE_SMOOTHING_CONFIG = {
  raw: {
    simplifyEpsilon: 0.85,
    tinyMoveCutoff: 0.45,
    laplacianPasses: 1,
    laplacianStrength: 0.06,
    chaikinIterations: 0,
  },
  light: {
    simplifyEpsilon: 3.4,
    tinyMoveCutoff: 1.65,
    laplacianPasses: 2,
    laplacianStrength: 0.28,
    chaikinIterations: 2,
  },
  smooth: {
    simplifyEpsilon: 6.8,
    tinyMoveCutoff: 2.9,
    laplacianPasses: 5,
    laplacianStrength: 0.38,
    chaikinIterations: 4,
  },
};

export function centerlineSmoothingLabel(mode) {
  const normalized = normalizeCenterlineSmoothingMode(mode);
  return normalized === "raw" ? "RAW" : normalized === "smooth" ? "SMOOTH" : "LIGHT";
}

function getCenterlineSmoothingConfig(trackDef) {
  const mode = normalizeCenterlineSmoothingMode(trackDef?.centerlineSmoothingMode);
  return CENTERLINE_SMOOTHING_CONFIG[mode];
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
  if (!Array.isArray(points) || points.length < 4)
    return (points || []).map((p) => ({ x: p.x, y: p.y }));
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
  if (!Array.isArray(points) || points.length < 4)
    return (points || []).map((p) => ({ x: p.x, y: p.y }));
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

function offsetClosedLoopVariable(points, offsets, miterLimit = 2.6) {
  if (!Array.isArray(points) || points.length < 3) return [];
  const n = points.length;
  const orientation = signedLoopArea(points) < 0 ? 1 : -1;
  const out = new Array(n);

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    const inDir = normalizeVec(curr.x - prev.x, curr.y - prev.y);
    const outDir = normalizeVec(next.x - curr.x, next.y - curr.y);
    const inNormal = { x: -inDir.y, y: inDir.x };
    const outNormal = { x: -outDir.y, y: outDir.x };
    const signedOffset = (offsets[i] || 0) * orientation;

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
    const fallbackNormal =
      Math.hypot(avg.x, avg.y) > 1e-4
        ? avg
        : normalizeVec(-(inDir.y + outDir.y), inDir.x + outDir.x);
    out[i] = {
      x: curr.x + fallbackNormal.x * signedOffset,
      y: curr.y + fallbackNormal.y * signedOffset,
    };
  }
  return out;
}

function connectedSegmentsFromStrokes(strokes) {
  return (strokes || []).filter((stroke) => Array.isArray(stroke) && stroke.length > 0);
}

export function getConnectedCenterlinePoints(strokes) {
  const segments = connectedSegmentsFromStrokes(strokes);
  if (!segments.length) return [];

  const points = segments[0].map((p) => ({
    x: p.x,
    y: p.y,
    halfWidth: Number.isFinite(p.halfWidth) ? p.halfWidth : 60,
  }));
  for (let i = 1; i < segments.length; i++) {
    const prevEnd = points[points.length - 1];
    const nextStart = segments[i][0];
    appendBridge(points, prevEnd, nextStart);
    for (let j = 1; j < segments[i].length; j++) {
      const p = segments[i][j];
      points.push({
        x: p.x,
        y: p.y,
        halfWidth: Number.isFinite(p.halfWidth) ? p.halfWidth : 60,
      });
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
  const smoothingConfig = getCenterlineSmoothingConfig(preset.track);
  const { simplifyEpsilon, tinyMoveCutoff, laplacianPasses, laplacianStrength, chaikinIterations } =
    smoothingConfig;

  const simplifiedLoop = simplifyClosedLoop(rawLoop, simplifyEpsilon);
  const prunedLoop = pruneTinyMovesClosed(simplifiedLoop, tinyMoveCutoff);
  const laplacianLoop = laplacianSmoothClosed(prunedLoop, laplacianPasses, laplacianStrength);
  const smoothedLoop = chaikinSmoothClosed(laplacianLoop, chaikinIterations);
  const loopPoints = resampleClosedLoop(smoothedLoop, 220);
  const rawHalfWidths = resampleCenterlineHalfWidths(rawLoop, loopPoints.length);
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
  const halfWidth = clamp(
    Math.min(Math.max(spanBasedWidth, perimeterBasedWidth), safeMaxWidth),
    24,
    72,
  );
  preset.track = {
    ...preset.track,
    cx: Number(cx.toFixed(1)),
    cy: Number(cy.toFixed(1)),
    centerlineHalfWidth: Number(halfWidth.toFixed(1)),
    centerlineWidthProfile: rawHalfWidths.map((value) => Number(value.toFixed(1))),
    centerlineSmoothingMode: normalizeCenterlineSmoothingMode(preset.track.centerlineSmoothingMode),
    startAngle: 0,
    centerlineLoop: loopPoints.map((p) => ({
      x: Number(p.x.toFixed(1)),
      y: Number(p.y.toFixed(1)),
    })),
  };

  return true;
}

function resampleCenterlineHalfWidths(points, sampleCount) {
  if (!Array.isArray(points) || !points.length) return [];
  if (points.length === 1) {
    return new Array(sampleCount).fill(
      Number.isFinite(points[0].halfWidth) ? points[0].halfWidth : 60,
    );
  }

  const cumulative = new Float64Array(points.length + 1);
  for (let i = 1; i <= points.length; i++) {
    const a = points[i - 1];
    const b = points[i % points.length];
    cumulative[i] = cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = cumulative[points.length];
  if (total <= 1e-6) {
    const fallback = Number.isFinite(points[0].halfWidth) ? points[0].halfWidth : 60;
    return new Array(sampleCount).fill(fallback);
  }

  const samples = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const distance = (i / sampleCount) * total;
    let seg = 0;
    while (seg < points.length - 1 && cumulative[seg + 1] < distance) seg++;
    const segStart = cumulative[seg];
    const segEnd = cumulative[seg + 1];
    const t = segEnd > segStart ? (distance - segStart) / (segEnd - segStart) : 0;
    const a = points[seg];
    const b = points[(seg + 1) % points.length];
    const widthA = Number.isFinite(a.halfWidth) ? a.halfWidth : 60;
    const widthB = Number.isFinite(b.halfWidth) ? b.halfWidth : widthA;
    samples[i] = widthA + (widthB - widthA) * t;
  }
  return samples;
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
  const payload =
    raw.track_payload_json && typeof raw.track_payload_json === "object"
      ? raw.track_payload_json
      : {};
  return {
    ...payload,
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : payload.name,
    source: typeof raw.source === "string" ? raw.source : "user",
    ownerUserId: typeof raw.owner_user_id === "string" ? raw.owner_user_id : null,
    ownerDisplayName: typeof raw.owner_display_name === "string" ? raw.owner_display_name : null,
    bestLapMs: Number.isFinite(raw.best_lap_ms) ? Number(raw.best_lap_ms) : null,
    bestLapDisplayName:
      typeof raw.best_lap_display_name === "string" ? raw.best_lap_display_name : null,
    bestRaceMs: Number.isFinite(raw.best_race_ms) ? Number(raw.best_race_ms) : null,
    bestRaceDisplayName:
      typeof raw.best_race_display_name === "string" ? raw.best_race_display_name : null,
    isPublished: Boolean(raw.is_published),
    shareToken: typeof raw.share_token === "string" ? raw.share_token : null,
    canDelete: false,
    fromDb: true,
  };
}

export async function loadVisibleTracksFromApi({
  currentUserId = null,
  currentUserIsAdmin = false,
} = {}) {
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
  updateTrackDeleteCapabilities(currentUserId, currentUserIsAdmin);
  return { loaded };
}

export async function loadTrackPresetFromApi(
  trackId,
  { currentUserId = null, currentUserIsAdmin = false } = {},
) {
  const cleanId = normalizePresetId(trackId);
  if (!cleanId) return null;
  const existing = getTrackPresetById(cleanId);
  if (existing) return clonePresetData(existing);

  const rawTrack = await fetchTrackById(cleanId);
  const preset = buildPresetFromApiTrack(rawTrack);
  if (!preset) return null;
  const imported = importTrackPresetData(preset, { persist: false });
  if (imported) updateTrackDeleteCapabilities(currentUserId, currentUserIsAdmin);
  return imported;
}

export async function saveTrackPresetToDb(
  index,
  { currentUserId = null, currentUserIsAdmin = false, name: requestedName = "" } = {},
) {
  const presetData = exportTrackPresetData(index);
  const name =
    typeof requestedName === "string" && requestedName.trim()
      ? requestedName.trim().slice(0, 36)
      : typeof presetData.name === "string" && presetData.name.trim()
        ? presetData.name.trim()
        : `Track ${Date.now()}`;
  const savedTrack =
    presetData.fromDb && typeof presetData.id === "string" && presetData.id.trim()
      ? await updateTrackInDb(presetData.id, { name, trackPayload: presetData })
      : await saveTrackToDb(name, presetData);
  const mergedPreset = {
    ...presetData,
    id: savedTrack.id,
    name: savedTrack.name,
    source: savedTrack.source || "user",
    ownerUserId: savedTrack.owner_user_id || null,
    ownerDisplayName: savedTrack.owner_display_name || null,
    bestLapMs: Number.isFinite(savedTrack.best_lap_ms) ? Number(savedTrack.best_lap_ms) : null,
    bestLapDisplayName: savedTrack.best_lap_display_name || null,
    bestRaceMs: Number.isFinite(savedTrack.best_race_ms) ? Number(savedTrack.best_race_ms) : null,
    bestRaceDisplayName: savedTrack.best_race_display_name || null,
    isPublished: Boolean(savedTrack.is_published),
    shareToken: savedTrack.share_token || null,
    canDelete: true,
    fromDb: true,
  };
  const imported = importTrackPresetData(mergedPreset, { persist: false });
  if (imported) updateTrackDeleteCapabilities(currentUserId, currentUserIsAdmin);
  return imported;
}

export async function loadSharedTrackFromApi(
  shareToken,
  { currentUserId = null, currentUserIsAdmin = false } = {},
) {
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
  if (imported) updateTrackDeleteCapabilities(currentUserId, currentUserIsAdmin);
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
    coastDecel: 260,
    longDrag: 0.85,
    lateralGrip: 6.4,
    steerRate: 3.6,
    steerAtLowSpeedMul: 0.35,
    yawDamping: 8.0,
    driftiness: 1,
    reverseMaxSpeedMul: 0.32,
    inputSmoothing: 0.2,
    dtClamp: 0.033,
  },
  air: {
    gravity: 50,
    longDragMul: 0.18,
    throttleAccelMul: 0.08,
    brakeDecelMul: 0.04,
    maxJumpHeight: 4,
    bounceRestitution: 0.22,
    minBounceVz: 1.4,
    visualScalePerMeter: 0.06,
    liftPxPerMeter: 7.5,
  },
  objects: {
    treeHeight: 3,
    barrelHeight: 1,
    springHeight: 0.4,
    wallHeight: 2.5,
    wallThicknessDefault: 18,
    springRadiusDefault: 16,
  },
  assists: {
    autoDriftGripCut: 0.3,
    driftAssistRecoveryBoost: 0.75,
    driftAssistRecoveryTime: 0.2,
    speedSensitiveSteer: 0.55,
    throttleLiftGripCut: 0.2,
    throttleLiftSlipBoost: 0.18,
    throttleLiftMinSpeed: 90,
    handbrakeGrip: 0.28,
    handbrakeYawBoost: 0.95,
    handbrakeLongDecel: 1400,
    handbrakeSlipBoost: 0.42,
    handbrakeReverseKillDecel: 1900,
  },
  drift: {
    minSpeed: 92,
    fullEffectSpeed: 235,
    steerThreshold: 0.34,
    heavySteerThreshold: 0.7,
    throttleLiftThreshold: 0.08,
    frontGripFloor: 0.8,
    rearGripFloor: 0.44,
    rearGripLiftBonusCut: 0.16,
    rearGripHeavySteerCut: 0.16,
    rearGripHandbrakeCut: 0.28,
    frontGripHandbrakeCut: 0.08,
    steerSlipBoost: 0.28,
    liftSlipBoost: 0.42,
    rearYawAssist: 1.35,
    yawAssistFromSlip: 0.85,
    yawRateDriftBoost: 0.32,
    driftEntryRate: 7.5,
    driftExitRate: 2.8,
    driftSustainTime: 0.18,
    countersteerRecoveryBonus: 2.1,
    inertiaCarry: 1,
    lateralRetention: 0.88,
    visualSkidThreshold: 0.22,
    rearSkidLateralThreshold: 56,
  },
  handbrake: {
    entryBoost: 0.4,
    yawBoost: 1.45,
    rearGripMul: 0.48,
    frontGripMul: 0.9,
    longDecel: 650,
    reverseKillDecel: 1900,
    slipBoost: 0.62,
  },
  ai: {
    navProgressSamples: 96,
    navLaneSamples: [-1.35, -1.1, -0.84, -0.56, -0.28, 0, 0.28, 0.56, 0.84, 1.1, 1.35],
    navIntersectionLinkRadius: 92,
    navIntersectionHeadingThreshold: 0.18,
    navIntersectionMinSliceGap: 4,
    navIntersectionMaxLinks: 4,
    navIntersectionPenalty: 10,
    lookAheadBase: 10,
    lookAheadSpeedMul: 0.034,
    steeringGain: 1.15,
    lateralErrorGain: 0.018,
    targetSpeedLookAhead: 12,
    routeHorizon: 42,
    checkpointPlanLookAhead: 2,
    checkpointGoalDepth: 36,
    checkpointGoalExitDepth: 54,
    checkpointGoalLateralMargin: 14,
    checkpointGoalHeadingAlignment: 0.3,
    checkpointGoalNodeLimit: 10,
    checkpointContinuationNodes: 8,
    routeRejoinMin: 6,
    routeRejoinWindow: 20,
    targetPreviewDistanceBase: 96,
    targetPreviewSpeedMul: 0.48,
    targetPreviewMaxDistance: 400,
    maxPreviewPenaltySurfaceDistance: 30,
    targetSightlineSamples: 8,
    tangentBlendMax: 0.22,
    tangentBlendDistance: 120,
    laneChangePenalty: 1.2,
    edgeGrassPenalty: 160,
    edgeCurbPenalty: 2,
    edgeWaterPenalty: 280,
    edgeSegmentSurfacePenaltyWeight: 2.0,
    obstaclePenalty: 1200,
    obstacleAvoidanceRadius: 34,
    obstacleHardClearance: 10,
    playerNodePenalty: 20,
    playerAvoidanceRadius: 24,
    rivalAvoidanceRadius: 22,
    contactPush: 42,
    targetSpeedBias: 1,
    targetSpeedMin: 195,
    targetSpeedMax: 350,
    cornerSpeedMin: 175,
    fullThrottleCurvature: 0.12,
    curvatureSpeedScale: 1500,
    curvatureSpeedBias: 124,
    brakingEfficiency: 0.65,
    brakeRampRange: 35,
    throttleFloor: 1,
    lateBrakeMargin: 22,
    inputSmoothing: 0.04,
    handbrakeHeadingThreshold: 0.85,
    handbrakeSpeedThreshold: 190,
    jumpLaunchNodeRadius: 10,
    jumpApproachDistance: 42,
    jumpLaunchLateralMargin: 12,
    jumpLandingRadius: 42,
    jumpLandingHeadingThreshold: 0.2,
    jumpLandingSurfacePenaltyMul: 0.55,
    jumpMinProgressStep: 4,
    jumpMinPenaltySurfaceDistance: 18,
    jumpMinBenefitCost: 18,
    jumpBenefitWeight: 0.45,
    jumpRiskPenalty: 16,
    jumpMaxLandingOptions: 2,
    jumpArcSampleDt: 1 / 60,
    jumpMaxAirTime: 1.8,
    apexApproachWeight: 0.28,
    apexCommitWeight: 0.44,
    apexTransitionWeight: 0.16,
    replanInterval: 0.12,
    pathNodeReachDistance: 28,
    stuckSpeedThreshold: 18,
    stuckProgressThreshold: 0.003,
    stuckTime: 1.25,
    offRoadStuckTime: 0.55,
    grassRecoveryPathDistance: 64,
    grassRecoverySpeedThreshold: 36,
    repeatedCollisionTime: 0.75,
    reverseRecoverTime: 0.55,
    forwardRecoverTime: 0.75,
    maxRecoveryTime: 2.2,
    softResetSearchRadius: 80,
    softResetSearchRadiusFallback: 140,
    softResetCooldown: 3,
    softResetForwardSpeed: 30,
  },
  surfaces: {
    asphalt: {
      lateralGripMul: 0.95,
      longDragMul: 1.0,
      engineMul: 1.0,
      coastDecelMul: 1.0,
    },
    curb: {
      lateralGripMul: 1.18,
      longDragMul: 1.02,
      engineMul: 1.0,
      coastDecelMul: 1.05,
    },
    grass: {
      lateralGripMul: 0.88,
      longDragMul: 2.35,
      engineMul: 0.36,
      coastDecelMul: 2.6,
    },
    water: {
      lateralGripMul: 0.14,
      longDragMul: 3.3,
      engineMul: 0.22,
      coastDecelMul: 2.8,
    },
    oil: {
      lateralGripMul: 0.95,
      longDragMul: 1.0,
      engineMul: 1.0,
      coastDecelMul: 1.0,
    },
  },
  flags: {
    AUTO_DRIFT_ON_STEER: true,
    DRIFT_ASSIST_RECOVERY: false,
    HANDBRAKE_MODE: true,
    SIDEWAYS_DRIFT_ENABLED: loadSidewaysDriftEnabled(true),
    SPEED_SENSITIVE_STEERING: true,
    SURFACE_BLENDING: true,
    AI_OPPONENTS_ENABLED: loadAiOpponentsEnabled(false),
    AI_OPPONENT_COUNT: loadAiOpponentCount(DEFAULT_AI_OPPONENT_COUNT),
    DEBUG_MODE: loadDebugMode(false),
    ARCADE_COLLISION_PUSH: true,
  },
  constants: {
    surfaceBlendTime: 0.1,
    oilCarryDuration: 3,
    oilSteerThreshold: 0.03,
    oilGripFloor: 0.02,
    oilInertiaCarry: 0.985,
    driftSteerThreshold: 0.08,
    lowSpeedSteerAt: 120,
    pivotAtLowSpeedRatio: 0.5,
    pivotFromRearRatio: 0.9,
    pivotBlendSpeed: 320,
  },
};

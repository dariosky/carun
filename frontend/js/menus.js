import {
  applyTrackPreset,
  canDeleteTrackPreset,
  canvas,
  CENTERLINE_SMOOTHING_MODES,
  DEFAULT_CENTERLINE_SMOOTHING_MODE,
  deleteOwnTrackFromApi,
  CAR_COLOR_PALETTE,
  getCarColorLabel,
  getMenuItems,
  getGameModeItems,
  getLoginProviderItems,
  getTrackPreset,
  getSettingsItems,
  importTrackPresetData,
  MAX_AI_OPPONENT_COUNT,
  MIN_AI_OPPONENT_COUNT,
  removeTrackPresetById,
  regenerateTrackFromCenterlineStrokes,
  saveAiOpponentCount,
  saveAiOpponentsEnabled,
  saveTrackPreset,
  saveTrackPresetToDb,
  saveMenuMusicEnabled,
  savePlayerColor,
  saveSidewaysDriftEnabled,
  setTrackPresetMetadata,
  physicsConfig,
  sanitizePlayerName,
  sanitizeAiOpponentCount,
  sanitizeCarColor,
  saveDebugMode,
  savePlayerName,
  trackOptions,
  track,
  normalizeCenterlineSmoothingMode,
  TOURNAMENT_POINTS,
} from "./parameters.js";
import {
  assignRandomAiRoster,
  getActiveAiCars,
  keys,
  setCurbSegments,
  skidMarks,
  state,
} from "./state.js";
import { clearRaceInputs, getRaceStandings, resetRace } from "./physics.js";
import { showSnackbar } from "./snackbar.js";
import {
  blobRadius,
  getEditorWorldScale,
  initCurbSegments,
  normalizeWorldObject,
  pointInsideWallFootprint,
  surfaceAt,
  trackProgressAtPoint,
} from "./track.js";
import {
  clearTrackRecords,
  logoutAuth,
  renameTrack,
  setTrackPublished,
  updateAuthDisplayName,
} from "./api.js";
import {
  isMenuMusicEnabled,
  setMenuMusicEnabled,
  syncMenuMusicForMode,
  unlockMenuMusic,
} from "./audio.js";
import { emitFinishConfetti } from "./particles.js";
import { clamp } from "./utils.js";
import {
  allTournamentHumansFinished,
  canAdvanceHostedTournamentStandings,
  canStartHostedRoomRace,
  copyTournamentRoomUrl,
  createHostedTournamentRoom,
  leaveTournamentRoom,
  onTournamentStandingsAdvanced,
  startHostedRoomRace,
  syncTournamentRoomSnapshot,
  tournamentRoomActive,
  endTournamentRoom,
  toggleTournamentRoomPause,
} from "./tournament-room.js";
import { ASSET_PLACEABLES, getAssetDefaultRadius, getAssetPlaceable } from "./asset-sprites.js";

const EDITOR_TOP_BAR_HEIGHT = 56;
const EDITOR_OBJECT_PLACE_TOOLS = [
  { id: "terrain", label: "Terrain", icon: "▲", shortcut: "G" },
  { id: "water", label: "Water", icon: "≈", shortcut: "W" },
  { id: "oil", label: "Oil", icon: "●", shortcut: "O" },
  { id: "barrel", label: "Barrel", icon: "◉", shortcut: "B" },
  { id: "tree", label: "Tree", icon: "♣", shortcut: "T" },
  { id: "spring", label: "Spring", icon: "✹", shortcut: "" },
  { id: "ramp", label: "Ramp", icon: "◭", shortcut: "R" },
  { id: "bridgeDeck", label: "Bridge", icon: "⌷", shortcut: "H" },
  { id: "wall", label: "Wall", icon: "▭", shortcut: "L" },
  { id: "assets", label: "Assets", icon: "A", shortcut: "" },
];
const EDITOR_TOOLBAR_WIDTH = 320;
const EDITOR_TOOLBAR_TITLE_HEIGHT = 32;
const EDITOR_TOOLBAR_ROW_HEIGHT = 32;
const EDITOR_TOOLBAR_SECTION_HEIGHT = 38;
const EDITOR_TOOLBAR_SECTION_LABEL_HEIGHT = 22;
const EDITOR_DEFAULT_HALF_WIDTH = 60;
const EDITOR_ZOOM_STEP = 0.1;
const EDITOR_MIN_WORLD_SCALE = 0.1;
const EDITOR_MAX_WORLD_SCALE = 1.75;
const EDITOR_MIN_ANIMAL_RADIUS = 8;
const EDITOR_MAX_ANIMAL_RADIUS = 40;
const EDITOR_TOOLBAR_POSITION_STORAGE_KEY = "carun.editorToolbarPosition";
const EDITOR_CHECKPOINT_PROGRESS_TOLERANCE = 0.012;
const EDITOR_OBJECT_HIT_RADIUS_PX = 14;
const EDITOR_STROKE_SELECT_DISTANCE_PX = 12;
const EDITOR_ROAD_ANCHOR_RADIUS_PX = 9;
const EDITOR_ROAD_ANCHOR_MIN_SPACING = 36;
const EDITOR_ROAD_ANCHOR_TARGET_COUNT = 10;
const EDITOR_ROAD_ANCHOR_FALLOFF_MUL = 1.25;
const EDITOR_ROAD_REBUILD_THROTTLE_MS = 24;
const EDITOR_TERRAIN_HEIGHT_CLAMP = 6;

function clampWorldScale(value) {
  return Math.max(EDITOR_MIN_WORLD_SCALE, Math.min(EDITOR_MAX_WORLD_SCALE, value));
}

function clampTerrainBrushSize(value) {
  return Math.max(24, Math.min(220, Number(value) || 72));
}

function clampTerrainBrushStrength(value) {
  return Math.max(0.2, Math.min(3, Number(value) || 1));
}

function clampTerrainBrushHardness(value) {
  return Math.max(0.1, Math.min(0.95, Number(value) || 0.62));
}

function ensureTerrainGrid(trackData) {
  if (!trackData) return null;
  const existingCols = Math.max(0, Math.round(Number(trackData.terrainCols) || 0));
  const existingRows = Math.max(0, Math.round(Number(trackData.terrainRows) || 0));
  const heights = Array.isArray(trackData.terrainHeights) ? trackData.terrainHeights : [];
  if (existingCols && existingRows && heights.length >= existingCols * existingRows) {
    return {
      cols: existingCols,
      rows: existingRows,
      cellSize: Math.max(24, Number(trackData.terrainCellSize) || 56),
      originX: Number(trackData.terrainOriginX) || 0,
      originY: Number(trackData.terrainOriginY) || 0,
      heights,
    };
  }
  const cellSize = Math.max(24, Number(trackData.terrainCellSize) || 56);
  const cols = Math.max(2, Math.ceil(canvas.width / cellSize) + 2);
  const rows = Math.max(2, Math.ceil(canvas.height / cellSize) + 2);
  trackData.terrainCellSize = cellSize;
  trackData.terrainCols = cols;
  trackData.terrainRows = rows;
  trackData.terrainOriginX = -cellSize;
  trackData.terrainOriginY = -cellSize;
  trackData.terrainHeights = new Array(cols * rows).fill(0);
  trackData.terrainBrushSize = clampTerrainBrushSize(trackData.terrainBrushSize);
  trackData.terrainBrushStrength = clampTerrainBrushStrength(trackData.terrainBrushStrength);
  trackData.terrainBrushHardness = clampTerrainBrushHardness(trackData.terrainBrushHardness);
  return {
    cols,
    rows,
    cellSize,
    originX: trackData.terrainOriginX,
    originY: trackData.terrainOriginY,
    heights: trackData.terrainHeights,
  };
}

function paintTerrainAtCursor(preset, direction = 1) {
  const trackData = preset?.track;
  const grid = ensureTerrainGrid(trackData);
  if (!grid) return false;
  const brushRadius = clampTerrainBrushSize(trackData.terrainBrushSize);
  const brushStrength = clampTerrainBrushStrength(trackData.terrainBrushStrength);
  const hardness = clampTerrainBrushHardness(trackData.terrainBrushHardness);
  const cx = state.editor.cursorX;
  const cy = state.editor.cursorY;
  const radiusSq = brushRadius * brushRadius;
  let changed = false;

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = grid.originX + col * grid.cellSize;
      const y = grid.originY + row * grid.cellSize;
      const dx = x - cx;
      const dy = y - cy;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) continue;
      const dist = Math.sqrt(distSq);
      const falloff = clamp(1 - dist / Math.max(brushRadius, 1), 0, 1);
      const shaped = Math.pow(falloff, Math.max(0.15, 1 - hardness + 0.12));
      const index = row * grid.cols + col;
      const previous = Number(grid.heights[index]) || 0;
      const next = clamp(
        previous + shaped * direction * brushStrength * 0.06,
        -EDITOR_TERRAIN_HEIGHT_CLAMP,
        EDITOR_TERRAIN_HEIGHT_CLAMP,
      );
      if (Math.abs(next - previous) > 1e-6) {
        grid.heights[index] = next;
        changed = true;
      }
    }
  }

  if (changed) applyTrackPreset(state.editor.trackIndex);
  return changed;
}

function clearEditorDragSession() {
  state.editor.dragSession.active = false;
  state.editor.dragSession.kind = null;
  state.editor.dragSession.objectIndex = -1;
  state.editor.dragSession.strokeIndex = -1;
  state.editor.dragSession.anchorIndex = -1;
  state.editor.dragSession.pointerOffsetX = 0;
  state.editor.dragSession.pointerOffsetY = 0;
  state.editor.dragSession.lastRebuildAt = 0;
  state.editor.dragSession.strokeSnapshot = null;
}

function setEditorPanMode(enabled) {
  state.editor.panMode = Boolean(enabled);
  state.editor.viewDragging = false;
  clearEditorDragSession();
}

function loadEditorToolbarPosition() {
  try {
    const raw = localStorage.getItem(EDITOR_TOOLBAR_POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: Number(parsed.x), y: Number(parsed.y) };
  } catch {
    return null;
  }
}

function saveEditorToolbarPosition() {
  try {
    localStorage.setItem(
      EDITOR_TOOLBAR_POSITION_STORAGE_KEY,
      JSON.stringify({
        x: Math.round(state.editor.toolbar.x),
        y: Math.round(state.editor.toolbar.y),
      }),
    );
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

function clampEditorToolbarPosition() {
  const toolbar = state.editor.toolbar;
  const layout = getEditorToolbarLayout();
  toolbar.x = Math.max(10, Math.min(toolbar.x, canvas.width - layout.panel.width - 10));
  toolbar.y = Math.max(
    10,
    Math.min(toolbar.y, canvas.height - EDITOR_TOP_BAR_HEIGHT - layout.panel.height - 10),
  );
}

function pointInRect(x, y, rect) {
  return (
    rect && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
  );
}

function editorPixelToWorldDistance(trackDef, pixels) {
  return pixels / Math.max(0.1, getEditorWorldScale(trackDef));
}

function distanceToSegment(pointX, pointY, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-8) return Math.hypot(pointX - ax, pointY - ay);
  const t = Math.max(0, Math.min(1, ((pointX - ax) * dx + (pointY - ay) * dy) / lenSq));
  const px = ax + dx * t;
  const py = ay + dy * t;
  return Math.hypot(pointX - px, pointY - py);
}

function pointInsideBlobObject(x, y, obj, tolerance = 0) {
  const rotation = obj.angle || 0;
  const dx = x - obj.x;
  const dy = y - obj.y;
  const localX = dx * Math.cos(rotation) + dy * Math.sin(rotation);
  const localY = -dx * Math.sin(rotation) + dy * Math.cos(rotation);
  const angle = Math.atan2(localY, localX);
  const dist = Math.hypot(localX, localY);
  return dist <= blobRadius(obj.rx, obj.ry, angle, obj.seed || 0) + tolerance;
}

function pointInsideExpandedWall(x, y, wall, tolerance) {
  if (pointInsideWallFootprint(x, y, wall)) return true;
  const normalized = normalizeWorldObject(wall);
  if (
    !normalized ||
    (normalized.type !== "wall" && normalized.type !== "ramp" && normalized.type !== "bridgeDeck")
  ) {
    return false;
  }
  const dx = x - normalized.x;
  const dy = y - normalized.y;
  const cos = Math.cos(normalized.angle);
  const sin = Math.sin(normalized.angle);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  return (
    Math.abs(localX) <= normalized.length * 0.5 + tolerance &&
    Math.abs(localY) <= normalized.width * 0.5 + tolerance
  );
}

function pickEditorObjectAt(x, y, preset) {
  const tolerance = editorPixelToWorldDistance(preset.track, EDITOR_OBJECT_HIT_RADIUS_PX);
  for (let index = (preset.worldObjects?.length || 0) - 1; index >= 0; index--) {
    const object = normalizeWorldObject(preset.worldObjects[index]);
    if (!object) continue;
    let hit = false;
    if (
      object.type === "tree" ||
      object.type === "barrel" ||
      object.type === "spring" ||
      object.type === "animal"
    ) {
      hit = Math.hypot(x - object.x, y - object.y) <= object.r + tolerance;
    } else if (object.type === "pond" || object.type === "oil") {
      hit = pointInsideBlobObject(x, y, object, tolerance);
    } else if (object.type === "wall" || object.type === "ramp" || object.type === "bridgeDeck") {
      hit = pointInsideExpandedWall(x, y, object, tolerance);
    }
    if (hit) return { kind: "object", objectIndex: index };
  }
  return null;
}

function buildStrokeCumulativeDistances(stroke) {
  const cumulative = new Array(stroke.length).fill(0);
  for (let i = 1; i < stroke.length; i++) {
    cumulative[i] =
      cumulative[i - 1] + Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
  }
  return cumulative;
}

function getRoadStrokeAnchorPointIndices(stroke) {
  if (!Array.isArray(stroke) || !stroke.length) return [];
  if (stroke.length === 1) return [0];
  const cumulative = buildStrokeCumulativeDistances(stroke);
  const totalLength = cumulative[cumulative.length - 1];
  const minSpacing = Math.max(
    EDITOR_ROAD_ANCHOR_MIN_SPACING,
    totalLength / EDITOR_ROAD_ANCHOR_TARGET_COUNT,
  );
  const indices = [0];
  let lastAnchorDistance = 0;
  for (let i = 1; i < stroke.length - 1; i++) {
    if (cumulative[i] - lastAnchorDistance >= minSpacing) {
      indices.push(i);
      lastAnchorDistance = cumulative[i];
    }
  }
  if (indices[indices.length - 1] !== stroke.length - 1) {
    indices.push(stroke.length - 1);
  }
  return indices;
}

export function getSelectedEditorRoadAnchors() {
  if (state.mode !== "editor") return [];
  const preset = getTrackPreset(state.editor.trackIndex);
  const target = roadSelectionTarget(preset);
  if (!target) return [];
  const stroke = preset.centerlineStrokes?.[target.strokeIndex];
  if (!stroke?.length) return [];
  return getRoadStrokeAnchorPointIndices(stroke).map((pointIndex, anchorIndex) => ({
    anchorIndex,
    strokeIndex: target.strokeIndex,
    pointIndex,
    x: stroke[pointIndex].x,
    y: stroke[pointIndex].y,
    isEndpoint: pointIndex === 0 || pointIndex === stroke.length - 1,
  }));
}

function pickSelectedRoadAnchorAt(x, y, preset) {
  if (state.editor.activeTool !== "road" || state.editor.roadMode !== "segment") return null;
  const tolerance = editorPixelToWorldDistance(preset.track, EDITOR_ROAD_ANCHOR_RADIUS_PX + 4);
  let best = null;
  for (const anchor of getSelectedEditorRoadAnchors()) {
    const distance = Math.hypot(x - anchor.x, y - anchor.y);
    if (distance > tolerance) continue;
    if (!best || distance < best.distance) best = { ...anchor, distance };
  }
  return best;
}

function pickStrokeAt(x, y, preset) {
  if (state.editor.activeTool !== "road" || state.editor.roadMode !== "segment") return null;
  const tolerance = editorPixelToWorldDistance(preset.track, EDITOR_STROKE_SELECT_DISTANCE_PX);
  let best = null;
  for (const [strokeIndex, stroke] of (preset.centerlineStrokes || []).entries()) {
    if (!Array.isArray(stroke) || stroke.length < 2) continue;
    for (let i = 1; i < stroke.length; i++) {
      const distance = distanceToSegment(
        x,
        y,
        stroke[i - 1].x,
        stroke[i - 1].y,
        stroke[i].x,
        stroke[i].y,
      );
      if (distance > tolerance) continue;
      if (!best || distance < best.distance) {
        best = { kind: "stroke", strokeIndex, distance };
      }
    }
  }
  return best;
}

function getDefaultStrokeHalfWidth(preset) {
  const latestStroke = preset?.centerlineStrokes?.[preset.centerlineStrokes.length - 1];
  const latestPoint = latestStroke?.[latestStroke.length - 1];
  if (Number.isFinite(latestPoint?.halfWidth)) return latestPoint.halfWidth;
  return Number.isFinite(preset?.track?.centerlineHalfWidth)
    ? preset.track.centerlineHalfWidth
    : EDITOR_DEFAULT_HALF_WIDTH;
}

function syncLatestEditorTarget(preset) {
  const stack = preset?.editStack || [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    if (entry.kind === "object" && preset.worldObjects[entry.objectIndex]) {
      state.editor.latestEditTarget = {
        kind: "object",
        objectIndex: entry.objectIndex,
      };
      return;
    }
    if (entry.kind === "stroke" && preset.centerlineStrokes[entry.strokeIndex]) {
      state.editor.latestEditTarget = {
        kind: "stroke",
        strokeIndex: entry.strokeIndex,
      };
      return;
    }
    if (entry.kind === "checkpoint" && preset.checkpoints?.[entry.checkpointIndex]) {
      state.editor.latestEditTarget = {
        kind: "checkpoint",
        checkpointIndex: entry.checkpointIndex,
      };
      return;
    }
  }
  state.editor.latestEditTarget = null;
}

function setEditorTool(nextTool) {
  state.editor.activeTool = nextTool;
  if (nextTool !== "asset") state.editor.assetPaletteOpen = false;
}

function toggleEditorTool(nextTool) {
  setEditorTool(state.editor.activeTool === nextTool ? "road" : nextTool);
}

function setEditorRoadMode(nextMode) {
  state.editor.roadMode = nextMode === "checkpoint" ? "checkpoint" : "segment";
}

function triggerEditorSelectionFlash(kind, index) {
  state.editor.selectionFlash.kind = kind;
  state.editor.selectionFlash.index = Number.isInteger(index) ? index : -1;
  state.editor.selectionFlash.time = 0.48;
}

function normalizeCheckpointProgress(progress) {
  return ((Number(progress) % 1) + 1) % 1;
}

function startProgressForTrack(trackDef) {
  return normalizeCheckpointProgress((Number(trackDef?.startAngle) || 0) / (Math.PI * 2));
}

function checkpointOrderDelta(progress, startProgress) {
  return normalizeCheckpointProgress(progress - startProgress);
}

function findCheckpointInsertIndex(checkpointsList, progress, trackDef) {
  const startProgress = startProgressForTrack(trackDef);
  const targetDelta = checkpointOrderDelta(progress, startProgress);
  const insertIndex = checkpointsList.findIndex(
    (checkpoint) => checkpointOrderDelta(checkpoint.progress, startProgress) > targetDelta,
  );
  return insertIndex >= 0 ? insertIndex : checkpointsList.length;
}

function checkpointNearStart(progress, trackDef) {
  const startProgress = startProgressForTrack(trackDef);
  return (
    checkpointOrderDelta(progress, startProgress) < EDITOR_CHECKPOINT_PROGRESS_TOLERANCE ||
    checkpointOrderDelta(startProgress, progress) < EDITOR_CHECKPOINT_PROGRESS_TOLERANCE
  );
}

function findCheckpointIndexNearProgress(checkpointsList, progress) {
  return checkpointsList.findIndex(
    (checkpoint) =>
      checkpointOrderDelta(checkpoint.progress, progress) < EDITOR_CHECKPOINT_PROGRESS_TOLERANCE ||
      checkpointOrderDelta(progress, checkpoint.progress) < EDITOR_CHECKPOINT_PROGRESS_TOLERANCE,
  );
}

export function getEditorTopBarLayout() {
  const buttonWidth = 120;
  const buttonHeight = 34;
  const buttonY = 11;
  const gap = 12;
  const build = {
    x: canvas.width - 18 - buttonWidth,
    y: buttonY,
    width: buttonWidth,
    height: buttonHeight,
    id: "build",
    label: "Build",
    shortcut: "Space",
  };
  const race = {
    x: build.x - gap - buttonWidth,
    y: buttonY,
    width: buttonWidth,
    height: buttonHeight,
    id: "race",
    label: "Race",
    shortcut: "R",
  };
  const back = {
    x: race.x - gap - buttonWidth,
    y: buttonY,
    width: buttonWidth,
    height: buttonHeight,
    id: "back",
    label: "Esc",
    shortcut: "Esc",
  };
  const curbs = {
    x: back.x - gap - buttonWidth,
    y: buttonY,
    width: buttonWidth,
    height: buttonHeight,
    id: "toggleCurbs",
    label: "Curbs",
    shortcut: "C",
  };
  const save = {
    x: curbs.x - gap - buttonWidth,
    y: buttonY,
    width: buttonWidth,
    height: buttonHeight,
    id: "save",
    label: "Save",
    shortcut: "S",
  };
  return { save, curbs, back, race, build };
}

function trackHasRecords(preset) {
  return Number.isFinite(preset?.bestLapMs) || Number.isFinite(preset?.bestRaceMs);
}

function canClearTrackRecordsPreset(preset) {
  if (!preset || !trackHasRecords(preset)) return false;
  if (!preset.fromDb) return true;
  if (state.auth.isAdmin) return true;
  return Boolean(state.auth.userId && preset.ownerUserId === state.auth.userId);
}

async function clearTrackRecordsAtIndex(trackIndex) {
  const preset = getTrackPreset(trackIndex);
  if (!preset) return null;
  const metadata = preset.fromDb
    ? await clearTrackRecords(preset.id)
    : {
        best_lap_ms: null,
        best_lap_display_name: null,
        best_race_ms: null,
        best_race_display_name: null,
      };
  const updatedPreset = setTrackPresetMetadata(
    preset.id,
    {
      bestLapMs: Number.isFinite(metadata.best_lap_ms) ? Number(metadata.best_lap_ms) : null,
      bestLapDisplayName:
        typeof metadata.best_lap_display_name === "string" ? metadata.best_lap_display_name : null,
      bestRaceMs: Number.isFinite(metadata.best_race_ms) ? Number(metadata.best_race_ms) : null,
      bestRaceDisplayName:
        typeof metadata.best_race_display_name === "string"
          ? metadata.best_race_display_name
          : null,
    },
    {
      currentUserId: state.auth.userId,
      currentUserIsAdmin: state.auth.isAdmin,
    },
  );
  if (!updatedPreset) return null;
  saveTrackPreset(trackIndex);
  return updatedPreset;
}

export function getEditorToolbarLayout() {
  const toolbar = state.editor.toolbar;
  const panel = {
    x: toolbar.x,
    y: toolbar.y,
    width: toolbar.width || EDITOR_TOOLBAR_WIDTH,
    height: 0,
  };
  const titleBar = {
    x: panel.x,
    y: panel.y,
    width: panel.width,
    height: EDITOR_TOOLBAR_TITLE_HEIGHT,
  };
  const objectHeader = {
    x: panel.x + 14,
    y: titleBar.y + titleBar.height + 8,
    width: panel.width - 28,
    height: EDITOR_TOOLBAR_SECTION_LABEL_HEIGHT,
  };
  const objectToolRowY = objectHeader.y + objectHeader.height + 4;
  const objectToolButtonGap = 10;
  const objectToolButtonWidth = (panel.width - 24 - objectToolButtonGap * 2) / 3;
  const objectToolRows = Math.max(1, Math.ceil(EDITOR_OBJECT_PLACE_TOOLS.length / 3));
  const objectToolButtons = EDITOR_OBJECT_PLACE_TOOLS.map((tool, index) => {
    const row = Math.floor(index / 3);
    const col = index % 3;
    return {
      ...tool,
      x: panel.x + 12 + col * (objectToolButtonWidth + objectToolButtonGap),
      y: objectToolRowY + row * EDITOR_TOOLBAR_ROW_HEIGHT,
      width: objectToolButtonWidth,
      height: EDITOR_TOOLBAR_ROW_HEIGHT - 2,
    };
  });
  const objectToolsBottom = objectToolRowY + EDITOR_TOOLBAR_ROW_HEIGHT * objectToolRows;
  const assetPaletteItemHeight = 26;
  const assetPalette =
    state.editor.assetPaletteOpen && ASSET_PLACEABLES.length
      ? {
          panel: {
            x: panel.x + 12,
            y: objectToolsBottom + 4,
            width: panel.width - 24,
            height: 22 + ASSET_PLACEABLES.length * (assetPaletteItemHeight + 6) + 6,
          },
          items: ASSET_PLACEABLES.map((asset, index) => ({
            ...asset,
            id: `asset:${asset.kind}`,
            x: panel.x + 20,
            y: objectToolsBottom + 24 + index * (assetPaletteItemHeight + 6),
            width: panel.width - 40,
            height: assetPaletteItemHeight,
          })),
        }
      : null;
  const objectSelectTop =
    (assetPalette?.panel.y || objectToolsBottom) + (assetPalette?.panel.height || 0) + 8;
  const objectActionTop = objectSelectTop + EDITOR_TOOLBAR_SECTION_HEIGHT;
  const actionY = objectActionTop + 2;
  const iconButtonWidth = 34;
  const iconGap = 8;
  const stepperWidth = 94;
  const roadHeaderTop = objectActionTop + EDITOR_TOOLBAR_SECTION_HEIGHT + 14;
  const roadSelectTop = roadHeaderTop + EDITOR_TOOLBAR_SECTION_LABEL_HEIGHT + 4;
  const checkpointSelectTop = roadSelectTop + EDITOR_TOOLBAR_SECTION_HEIGHT;
  const roadActionTop = checkpointSelectTop + EDITOR_TOOLBAR_SECTION_HEIGHT;
  const roadActionY = roadActionTop + 2;
  const roadStepperWidth = 138;
  const roadSmoothTop = roadActionTop + EDITOR_TOOLBAR_SECTION_HEIGHT;
  const terrainTop = roadSmoothTop + EDITOR_TOOLBAR_SECTION_HEIGHT;
  const terrainRow2Top = terrainTop + EDITOR_TOOLBAR_SECTION_HEIGHT;
  const terrainRow3Top = terrainRow2Top + EDITOR_TOOLBAR_SECTION_HEIGHT;
  const zoomTop = terrainRow3Top + EDITOR_TOOLBAR_SECTION_HEIGHT + 14;
  panel.height = zoomTop + EDITOR_TOOLBAR_SECTION_HEIGHT + 20 - panel.y;
  const selectorDeleteX = panel.x + panel.width - 12 - iconButtonWidth;
  const selectorNextX = selectorDeleteX - 8 - 30;
  const selectorValueX = panel.x + 52;
  const selectorValueWidth = selectorNextX - 8 - selectorValueX;
  return {
    panel,
    titleBar,
    objectHeader,
    objectToolButtons,
    assetPalette,
    objectPrev: {
      x: panel.x + 14,
      y: objectSelectTop + 2,
      width: 30,
      height: 24,
    },
    objectNext: {
      x: panel.x + panel.width - 42,
      y: objectSelectTop + 2,
      width: 30,
      height: 24,
    },
    objectValue: {
      x: panel.x + 52,
      y: objectSelectTop,
      width: panel.width - 104,
      height: 28,
    },
    objectDeleteButton: {
      x: panel.x + 12,
      y: actionY,
      width: iconButtonWidth,
      height: 24,
      id: "objectDelete",
    },
    objectSizeDown: {
      x: panel.x + 12 + iconButtonWidth + iconGap,
      y: actionY,
      width: 28,
      height: 24,
      id: "objectSizeDown",
    },
    objectSizeValue: {
      x: panel.x + 12 + iconButtonWidth + iconGap + 32,
      y: objectActionTop,
      width: stepperWidth - 64,
      height: 28,
    },
    objectSizeUp: {
      x: panel.x + 12 + iconButtonWidth + iconGap + stepperWidth - 28,
      y: actionY,
      width: 28,
      height: 24,
      id: "objectSizeUp",
    },
    rotateLeftButton: {
      x: panel.x + 12 + iconButtonWidth + iconGap + stepperWidth + iconGap,
      y: actionY,
      width: iconButtonWidth,
      height: 24,
      id: "rotateLeft",
    },
    rotateRightButton: {
      x:
        panel.x +
        12 +
        iconButtonWidth +
        iconGap +
        stepperWidth +
        iconGap +
        iconButtonWidth +
        iconGap,
      y: actionY,
      width: iconButtonWidth,
      height: 24,
      id: "rotateRight",
    },
    roadHeader: {
      x: panel.x + 14,
      y: roadHeaderTop,
      width: panel.width - 28,
      height: EDITOR_TOOLBAR_SECTION_LABEL_HEIGHT,
    },
    roadPrev: {
      x: panel.x + 14,
      y: roadSelectTop + 2,
      width: 30,
      height: 24,
    },
    roadNext: {
      x: selectorNextX,
      y: roadSelectTop + 2,
      width: 30,
      height: 24,
    },
    roadValue: {
      x: selectorValueX,
      y: roadSelectTop,
      width: selectorValueWidth,
      height: 28,
      id: "roadModeSegment",
    },
    checkpointPrev: {
      x: panel.x + 14,
      y: checkpointSelectTop + 2,
      width: 30,
      height: 24,
    },
    checkpointNext: {
      x: selectorNextX,
      y: checkpointSelectTop + 2,
      width: 30,
      height: 24,
    },
    checkpointValue: {
      x: selectorValueX,
      y: checkpointSelectTop,
      width: selectorValueWidth,
      height: 28,
      id: "roadModeCheckpoint",
    },
    roadDeleteButton: {
      x: selectorDeleteX,
      y: roadSelectTop + 2,
      width: iconButtonWidth,
      height: 24,
      id: "roadDelete",
    },
    roadSizeDown: {
      x: panel.x + 12 + iconButtonWidth + iconGap,
      y: roadActionY,
      width: 28,
      height: 24,
      id: "roadSizeDown",
    },
    roadSizeValue: {
      x: panel.x + 12 + iconButtonWidth + iconGap + 32,
      y: roadActionTop,
      width: roadStepperWidth - 64,
      height: 28,
    },
    roadSizeUp: {
      x: panel.x + 12 + iconButtonWidth + iconGap + roadStepperWidth - 28,
      y: roadActionY,
      width: 28,
      height: 24,
      id: "roadSizeUp",
    },
    checkpointDeleteButton: {
      x: selectorDeleteX,
      y: checkpointSelectTop + 2,
      width: iconButtonWidth,
      height: 24,
      id: "checkpointDelete",
    },
    roadSmoothLabel: {
      x: panel.x + 14,
      y: roadSmoothTop,
      width: 76,
      height: 28,
    },
    roadSmoothPrev: {
      x: panel.x + 112,
      y: roadSmoothTop + 2,
      width: 30,
      height: 24,
    },
    roadSmoothNext: {
      x: panel.x + panel.width - 40,
      y: roadSmoothTop + 2,
      width: 30,
      height: 24,
    },
    roadSmoothValue: {
      x: panel.x + 148,
      y: roadSmoothTop,
      width: 58,
      height: 28,
    },
    terrainSizeLabel: {
      x: panel.x + 14,
      y: terrainTop,
      width: 76,
      height: 28,
    },
    terrainSizeDown: {
      x: panel.x + 112,
      y: terrainTop + 2,
      width: 30,
      height: 24,
      id: "terrainBrushSizeDown",
    },
    terrainSizeValue: {
      x: panel.x + 148,
      y: terrainTop,
      width: 58,
      height: 28,
    },
    terrainSizeUp: {
      x: panel.x + panel.width - 40,
      y: terrainTop + 2,
      width: 30,
      height: 24,
      id: "terrainBrushSizeUp",
    },
    terrainStrengthLabel: {
      x: panel.x + 14,
      y: terrainRow2Top,
      width: 76,
      height: 28,
    },
    terrainStrengthDown: {
      x: panel.x + 112,
      y: terrainRow2Top + 2,
      width: 30,
      height: 24,
      id: "terrainBrushStrengthDown",
    },
    terrainStrengthValue: {
      x: panel.x + 148,
      y: terrainRow2Top,
      width: 58,
      height: 28,
    },
    terrainStrengthUp: {
      x: panel.x + panel.width - 40,
      y: terrainRow2Top + 2,
      width: 30,
      height: 24,
      id: "terrainBrushStrengthUp",
    },
    terrainHardnessLabel: {
      x: panel.x + 14,
      y: terrainRow3Top,
      width: 76,
      height: 28,
    },
    terrainHardnessDown: {
      x: panel.x + 112,
      y: terrainRow3Top + 2,
      width: 30,
      height: 24,
      id: "terrainBrushHardnessDown",
    },
    terrainHardnessValue: {
      x: panel.x + 148,
      y: terrainRow3Top,
      width: 58,
      height: 28,
    },
    terrainHardnessUp: {
      x: panel.x + panel.width - 40,
      y: terrainRow3Top + 2,
      width: 30,
      height: 24,
      id: "terrainBrushHardnessUp",
    },
    panToggle: {
      x: panel.x + 14,
      y: zoomTop + 2,
      width: 40,
      height: 24,
      id: "togglePan",
    },
    zoomLabel: { x: panel.x + 62, y: zoomTop, width: 52, height: 28 },
    zoomOut: { x: panel.x + 120, y: zoomTop + 2, width: 38, height: 24 },
    zoomIn: { x: panel.x + 166, y: zoomTop + 2, width: 38, height: 24 },
    zoomValue: { x: panel.x + 210, y: zoomTop, width: 48, height: 28 },
  };
}

function editorToolbarActionAt(x, y) {
  const layout = getEditorToolbarLayout();
  if (!pointInRect(x, y, layout.panel)) return null;
  if (pointInRect(x, y, layout.titleBar)) return { type: "drag" };
  for (const row of layout.objectToolButtons) {
    if (pointInRect(x, y, row)) return { type: "action", id: row.id };
  }
  if (layout.assetPalette?.items) {
    for (const item of layout.assetPalette.items) {
      if (pointInRect(x, y, item)) return { type: "action", id: item.id };
    }
    if (pointInRect(x, y, layout.assetPalette.panel)) return { type: "panel" };
  }
  if (pointInRect(x, y, layout.objectDeleteButton))
    return { type: "action", id: layout.objectDeleteButton.id };
  if (pointInRect(x, y, layout.objectSizeDown))
    return { type: "action", id: layout.objectSizeDown.id };
  if (pointInRect(x, y, layout.objectSizeUp)) return { type: "action", id: layout.objectSizeUp.id };
  if (pointInRect(x, y, layout.rotateLeftButton))
    return { type: "action", id: layout.rotateLeftButton.id };
  if (pointInRect(x, y, layout.rotateRightButton))
    return { type: "action", id: layout.rotateRightButton.id };
  if (pointInRect(x, y, layout.objectPrev)) return { type: "action", id: "objectPrev" };
  if (pointInRect(x, y, layout.objectNext)) return { type: "action", id: "objectNext" };
  if (pointInRect(x, y, layout.roadPrev)) return { type: "action", id: "roadPrev" };
  if (pointInRect(x, y, layout.roadNext)) return { type: "action", id: "roadNext" };
  if (pointInRect(x, y, layout.roadValue)) return { type: "action", id: layout.roadValue.id };
  if (pointInRect(x, y, layout.checkpointPrev)) return { type: "action", id: "checkpointPrev" };
  if (pointInRect(x, y, layout.checkpointNext)) return { type: "action", id: "checkpointNext" };
  if (pointInRect(x, y, layout.checkpointValue))
    return { type: "action", id: layout.checkpointValue.id };
  if (pointInRect(x, y, layout.roadDeleteButton))
    return { type: "action", id: layout.roadDeleteButton.id };
  if (pointInRect(x, y, layout.checkpointDeleteButton))
    return { type: "action", id: layout.checkpointDeleteButton.id };
  if (pointInRect(x, y, layout.roadSizeDown)) return { type: "action", id: layout.roadSizeDown.id };
  if (pointInRect(x, y, layout.roadSizeUp)) return { type: "action", id: layout.roadSizeUp.id };
  if (pointInRect(x, y, layout.roadSmoothPrev)) return { type: "action", id: "roadSmoothPrev" };
  if (pointInRect(x, y, layout.roadSmoothNext)) return { type: "action", id: "roadSmoothNext" };
  if (pointInRect(x, y, layout.terrainSizeDown))
    return { type: "action", id: layout.terrainSizeDown.id };
  if (pointInRect(x, y, layout.terrainSizeUp))
    return { type: "action", id: layout.terrainSizeUp.id };
  if (pointInRect(x, y, layout.terrainStrengthDown))
    return { type: "action", id: layout.terrainStrengthDown.id };
  if (pointInRect(x, y, layout.terrainStrengthUp))
    return { type: "action", id: layout.terrainStrengthUp.id };
  if (pointInRect(x, y, layout.terrainHardnessDown))
    return { type: "action", id: layout.terrainHardnessDown.id };
  if (pointInRect(x, y, layout.terrainHardnessUp))
    return { type: "action", id: layout.terrainHardnessUp.id };
  if (pointInRect(x, y, layout.zoomOut)) return { type: "action", id: "zoomOut" };
  if (pointInRect(x, y, layout.zoomIn)) return { type: "action", id: "zoomIn" };
  if (pointInRect(x, y, layout.panToggle)) return { type: "action", id: layout.panToggle.id };
  return { type: "panel" };
}

function editorTopBarActionAt(x, y) {
  const layout = getEditorTopBarLayout();
  if (pointInRect(x, y, layout.save)) return layout.save.id;
  if (pointInRect(x, y, layout.curbs)) return layout.curbs.id;
  if (pointInRect(x, y, layout.back)) return layout.back.id;
  if (pointInRect(x, y, layout.race)) return layout.race.id;
  if (pointInRect(x, y, layout.build)) return layout.build.id;
  return null;
}

function editorToolbarActionLabel(actionId) {
  if (typeof actionId === "string" && actionId.startsWith("asset:")) {
    return getAssetPlaceable(actionId.slice(6)).label;
  }
  switch (actionId) {
    case "objectDelete":
      return "Delete";
    case "terrain":
      return "Terrain";
    case "water":
      return "Water";
    case "oil":
      return "Oil";
    case "barrel":
      return "Barrel";
    case "tree":
      return "Tree";
    case "spring":
      return "Spring";
    case "ramp":
      return "Ramp";
    case "bridgeDeck":
      return "Bridge";
    case "wall":
      return "Wall";
    case "assets":
      return "Assets";
    case "objectPrev":
      return "Previous Object";
    case "objectNext":
      return "Next Object";
    case "objectSizeDown":
      return "Size -";
    case "objectSizeUp":
      return "Size +";
    case "rotateLeft":
      return "Rotate Left";
    case "rotateRight":
      return "Rotate Right";
    case "save":
      return "Save";
    case "toggleCurbs":
      return "Curbs";
    case "back":
      return "Back";
    case "roadPrev":
      return "Previous Segment";
    case "roadNext":
      return "Next Segment";
    case "roadModeSegment":
      return "Road Mode";
    case "roadModeCheckpoint":
      return "Checkpoint Mode";
    case "checkpointPrev":
      return "Previous Checkpoint";
    case "checkpointNext":
      return "Next Checkpoint";
    case "roadDelete":
      return "Delete Segment";
    case "checkpointDelete":
      return "Delete Checkpoint";
    case "roadSizeDown":
      return "Width -";
    case "roadSizeUp":
      return "Width +";
    case "roadSmoothPrev":
      return "Smoothing -";
    case "roadSmoothNext":
      return "Smoothing +";
    case "terrainBrushSizeDown":
      return "Terrain Size -";
    case "terrainBrushSizeUp":
      return "Terrain Size +";
    case "terrainBrushStrengthDown":
      return "Terrain Power -";
    case "terrainBrushStrengthUp":
      return "Terrain Power +";
    case "terrainBrushHardnessDown":
      return "Terrain Hard -";
    case "terrainBrushHardnessUp":
      return "Terrain Hard +";
    case "zoomOut":
      return "Zoom Out";
    case "zoomIn":
      return "Zoom In";
    case "togglePan":
      return "Pan View";
    default:
      return "";
  }
}

function currentMenuItems() {
  return getMenuItems(state.auth.authenticated);
}

function currentSettingsItems() {
  return getSettingsItems(state.auth.authenticated);
}

function currentLoginProviderItems() {
  return getLoginProviderItems();
}

export function getMainMenuRenderModel(measureTextWidth) {
  const menuItems = currentMenuItems();
  const selectedMenuIndex = Math.max(0, Math.min(state.menuIndex, menuItems.length - 1));
  let maxMenuLabelWidth = 0;
  for (const item of menuItems) {
    maxMenuLabelWidth = Math.max(maxMenuLabelWidth, measureTextWidth(item));
  }
  const highlightWidth = Math.max(460, maxMenuLabelWidth + 96);
  return { menuItems, selectedMenuIndex, highlightWidth };
}

export function getLoginProviderRenderModel(measureTextWidth) {
  const loginItems = currentLoginProviderItems();
  const selectedLoginIndex = Math.max(0, Math.min(state.loginProviderIndex, loginItems.length - 1));
  let maxLabelWidth = 0;
  for (const item of loginItems) {
    maxLabelWidth = Math.max(maxLabelWidth, measureTextWidth(item));
  }
  const highlightWidth = Math.max(540, maxLabelWidth + 120);
  return { loginItems, selectedLoginIndex, highlightWidth };
}

export function getSettingsRenderLayout(measureTextWidth) {
  const settingsItems = currentSettingsItems();
  const selectedSettingsIndex = Math.max(
    0,
    Math.min(state.settingsIndex, settingsItems.length - 1),
  );
  const rowGap = 56;
  const startY = 314;

  const rowLabels = settingsItems.map((item) => {
    if (item === "PLAYER NAME") {
      const suffix = state.editingName ? "_" : "";
      return `${item}: ${state.playerName}${suffix}`;
    }
    if (item === "PLAYER COLOR") {
      return `${item}: ${getCarColorLabel(state.playerColor)}`;
    }
    if (item === "MENU MUSIC") {
      return `${item}: ${isMenuMusicEnabled() ? "ON" : "OFF"}`;
    }
    if (item === "AI OPPONENTS") {
      const count = sanitizeAiOpponentCount(physicsConfig.flags.AI_OPPONENT_COUNT);
      const aiOffSuffix = physicsConfig.flags.AI_OPPONENTS_ENABLED === false ? " (AI OFF)" : "";
      return `${item}: ${count}${aiOffSuffix}`;
    }
    if (item === "SIDEWAYS DRIFT") {
      return `${item}: ${physicsConfig.flags.SIDEWAYS_DRIFT_ENABLED ? "ON" : "OFF"}`;
    }
    if (item === "DEBUG MODE") {
      return `${item}: ${physicsConfig.flags.DEBUG_MODE ? "ON" : "OFF"}`;
    }
    return item;
  });

  let maxWidth = 0;
  for (const label of rowLabels) {
    maxWidth = Math.max(maxWidth, measureTextWidth(label));
  }
  const highlightWidth = Math.max(720, maxWidth + 92);

  return {
    settingsItems,
    selectedSettingsIndex,
    rowLabels,
    rowGap,
    startY,
    highlightWidth,
  };
}

export function getSettingsHeaderRenderModel() {
  return {
    text: "SETTINGS",
    xRatio: 0.5,
    y: 180,
    textAlign: "center",
  };
}

export function getGameModeRenderModel(measureTextWidth) {
  const items = getGameModeItems();
  const selectedIndex = Math.max(0, Math.min(state.gameModeIndex, items.length - 1));
  let maxWidth = 0;
  for (const item of items) {
    maxWidth = Math.max(maxWidth, measureTextWidth(item));
  }
  const highlightWidth = Math.max(460, maxWidth + 96);
  return { items, selectedIndex, highlightWidth };
}

export function getBreadcrumbs() {
  if (state.mode === "menu") return ["CARUN"];
  if (state.mode === "loginProviders") return ["CARUN", "LOGIN"];
  if (state.mode === "settings") return ["CARUN", "SETTINGS"];
  if (state.mode === "gameModeSelect") return ["CARUN", "RACE"];
  if (state.mode === "trackSelect") {
    return state.gameMode === "tournament"
      ? ["CARUN", "RACE", "TOURNAMENT"]
      : ["CARUN", "RACE", "SINGLE RACE"];
  }
  if (state.mode === "tournamentLobby") {
    return ["CARUN", "RACE", "TOURNAMENT", "LOBBY"];
  }
  if (state.mode === "tournamentStandings") {
    return ["CARUN", "RACE", "TOURNAMENT", "STANDINGS"];
  }
  if (state.mode === "tournamentFinal") {
    return ["CARUN", "RACE", "TOURNAMENT", "FINAL"];
  }
  return ["CARUN"];
}

const TRACK_GRID_ROWS = 3;
const TRACK_GRID_CARD_SIZE = 140;
const TRACK_GRID_CARD_GAP = 16;
const TRACK_GRID_LABEL_HEIGHT = 24;

function trackGridColumnCount() {
  return Math.max(1, Math.ceil(trackOptions.length / TRACK_GRID_ROWS));
}

function trackGridVisibleColumns() {
  const availableWidth = canvas.width - 80;
  const colWidth = TRACK_GRID_CARD_SIZE + TRACK_GRID_CARD_GAP;
  return Math.max(1, Math.floor(availableWidth / colWidth));
}

export function syncTrackSelectWindow() {
  const totalTracks = trackOptions.length;
  if (totalTracks === 0) return;
  if (state.trackSelectIndex < 0) state.trackSelectIndex = 0;
  if (state.trackSelectIndex >= totalTracks) {
    // On the back/start button row — keep current offset
    return;
  }
  const col = Math.floor(state.trackSelectIndex / TRACK_GRID_ROWS);
  const visCols = trackGridVisibleColumns();
  const maxColOffset = Math.max(0, trackGridColumnCount() - visCols);
  let offset = state.trackSelectViewOffset;
  if (col < offset) offset = col;
  if (col >= offset + visCols) offset = col - visCols + 1;
  state.trackSelectViewOffset = Math.max(0, Math.min(offset, maxColOffset));
}

function selectedTrackPreset() {
  if (state.trackSelectIndex < 0 || state.trackSelectIndex >= trackOptions.length) return null;
  return getTrackPreset(state.trackSelectIndex);
}

function selectedTrackCanDelete() {
  return canDeleteTrackPreset(selectedTrackPreset(), state.auth.userId, state.auth.isAdmin);
}

function selectedTrackCanPublish() {
  const preset = selectedTrackPreset();
  return Boolean(state.auth.isAdmin && preset && preset.fromDb);
}

function selectedTrackCanRename() {
  const preset = selectedTrackPreset();
  if (!preset || !preset.fromDb) return false;
  if (state.auth.isAdmin) return true;
  return Boolean(state.auth.userId && preset.ownerUserId === state.auth.userId);
}

function selectedTrackCanClearRecords() {
  return canClearTrackRecordsPreset(selectedTrackPreset());
}

export function getTrackSelectRenderModel() {
  const totalCount = trackOptions.length;
  const rows = TRACK_GRID_ROWS;
  const totalColumns = trackGridColumnCount();
  const visibleColumns = trackGridVisibleColumns();
  const maxColOffset = Math.max(0, totalColumns - visibleColumns);
  const viewColumnOffset = Math.max(0, Math.min(state.trackSelectViewOffset, maxColOffset));
  const selectedTrack = selectedTrackPreset();

  // Build grid cells for visible columns
  const gridCells = [];
  for (let c = viewColumnOffset; c < viewColumnOffset + visibleColumns; c++) {
    for (let r = 0; r < rows; r++) {
      const trackIndex = c * rows + r;
      if (trackIndex >= totalCount) continue;
      gridCells.push({
        trackIndex,
        column: c - viewColumnOffset,
        row: r,
        option: trackOptions[trackIndex],
      });
    }
  }

  return {
    gridCells,
    rows,
    totalColumns,
    visibleColumns,
    viewColumnOffset,
    totalCount,
    cardSize: TRACK_GRID_CARD_SIZE,
    cardGap: TRACK_GRID_CARD_GAP,
    labelHeight: TRACK_GRID_LABEL_HEIGHT,
    showLeftHint: viewColumnOffset > 0,
    showRightHint: viewColumnOffset + visibleColumns < totalColumns,
    selectedTrackCanDelete: selectedTrackCanDelete(),
    selectedTrackCanPublish: selectedTrackCanPublish(),
    selectedTrackCanRename: selectedTrackCanRename(),
    selectedTrackCanClearRecords: selectedTrackCanClearRecords(),
    selectedTrackIsPublished: Boolean(selectedTrack?.isPublished),
    isTournament: state.gameMode === "tournament",
    tournamentSelected: state.tournament.selectedTrackIndices,
  };
}

function settingsMenuIndex() {
  const idx = currentMenuItems().indexOf("SETTINGS");
  return idx >= 0 ? idx : 0;
}

function loginMenuIndex() {
  const idx = currentMenuItems().indexOf("LOGIN");
  return idx >= 0 ? idx : 0;
}

function raceMenuIndex() {
  const items = currentMenuItems();
  const idx = items.indexOf("RACE");
  if (idx >= 0) return idx;
  const anonymousIdx = items.indexOf("RACE ANONYMOUSLY");
  return anonymousIdx >= 0 ? anonymousIdx : 0;
}

function replaceAppUrl({ pathname, trackId = null } = {}) {
  const url = new URL(window.location.href);
  url.pathname = pathname || url.pathname;
  url.searchParams.delete("track");
  window.history.replaceState({}, "", `${url.pathname}${url.search ? url.search : ""}${url.hash}`);
}

function setTrackSelectUrl() {
  replaceAppUrl({ pathname: "/tracks" });
}

function setTrackEditorUrl(trackId) {
  const cleanTrackId = typeof trackId === "string" ? trackId.trim() : "";
  if (!cleanTrackId) return;
  replaceAppUrl({
    pathname: `/tracks/edit/${encodeURIComponent(cleanTrackId)}`,
  });
}

function setMainMenuUrl() {
  replaceAppUrl({ pathname: "/" });
}

function setSettingsUrl() {
  replaceAppUrl({ pathname: "/settings" });
}

function setTrackInUrl(trackId) {
  const cleanTrackId = typeof trackId === "string" ? trackId.trim() : "";
  if (!cleanTrackId) return;
  replaceAppUrl({ pathname: `/tracks/${encodeURIComponent(cleanTrackId)}` });
}

function clearTrackInUrl(trackId) {
  const currentPath = typeof window !== "undefined" ? window.location.pathname : "";
  const expectedPath = `/tracks/${encodeURIComponent(trackId)}`;
  if (currentPath !== expectedPath) return;
  replaceAppUrl({ pathname: "/tracks" });
}

function tournamentLobbyActionAt(screenX, screenY) {
  const buttonY = canvas.height - 94;
  const buttonH = 48;
  const shareX = 56;
  const shareW = 190;
  const inShare =
    screenX >= shareX &&
    screenX <= shareX + shareW &&
    screenY >= buttonY &&
    screenY <= buttonY + buttonH;
  if (inShare) return "share";
  if (state.tournamentRoom.isHost) {
    const startX = shareX + shareW + 18;
    const startW = 340;
    const inStart =
      screenX >= startX &&
      screenX <= startX + startW &&
      screenY >= buttonY &&
      screenY <= buttonY + buttonH;
    if (inStart) return "start";
  }
  return null;
}

function openConfirmModal({
  title,
  message,
  confirmLabel = "Yes",
  cancelLabel = "No",
  danger = false,
  onConfirm,
}) {
  state.modal.open = true;
  state.modal.mode = "confirm";
  state.modal.title = title || "Confirm";
  state.modal.message = message || "";
  state.modal.confirmLabel = confirmLabel;
  state.modal.cancelLabel = cancelLabel;
  state.modal.danger = danger;
  state.modal.selectedAction = "cancel";
  state.modal.inputValue = "";
  state.modal.inputPlaceholder = "";
  state.modal.inputMaxLength = 36;
  state.modal.onSubmit = null;
  state.modal.onConfirm = typeof onConfirm === "function" ? onConfirm : null;
  state.modal.onCancel = null;
}

function openInputModal({
  title,
  message,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  initialValue = "",
  placeholder = "",
  maxLength = 36,
  onSubmit,
}) {
  state.modal.open = true;
  state.modal.mode = "input";
  state.modal.title = title || "Input";
  state.modal.message = message || "";
  state.modal.confirmLabel = confirmLabel;
  state.modal.cancelLabel = cancelLabel;
  state.modal.danger = false;
  state.modal.selectedAction = "confirm";
  state.modal.inputValue = typeof initialValue === "string" ? initialValue.slice(0, maxLength) : "";
  state.modal.inputPlaceholder = typeof placeholder === "string" ? placeholder : "";
  state.modal.inputMaxLength = Math.max(1, Math.floor(maxLength) || 36);
  state.modal.onSubmit = typeof onSubmit === "function" ? onSubmit : null;
  state.modal.onConfirm = null;
  state.modal.onCancel = null;
}

function closeModal({ runCancel = false } = {}) {
  const onCancel = state.modal.onCancel;
  state.modal.open = false;
  state.modal.mode = "confirm";
  state.modal.title = "";
  state.modal.message = "";
  state.modal.confirmLabel = "Yes";
  state.modal.cancelLabel = "No";
  state.modal.danger = false;
  state.modal.selectedAction = "cancel";
  state.modal.inputValue = "";
  state.modal.inputPlaceholder = "";
  state.modal.inputMaxLength = 36;
  state.modal.onSubmit = null;
  state.modal.onConfirm = null;
  state.modal.onCancel = null;
  if (runCancel && typeof onCancel === "function") onCancel();
}

function returnToTrackSelect() {
  if (trackOptions.length > 0) {
    state.selectedTrackIndex = Math.max(
      0,
      Math.min(state.selectedTrackIndex, trackOptions.length - 1),
    );
  } else {
    state.selectedTrackIndex = 0;
  }
  state.mode = "trackSelect";
  setTrackSelectUrl();
  syncMenuMusicForMode(state.mode);
  state.trackSelectIndex = state.selectedTrackIndex;
  syncTrackSelectWindow();
  state.paused = false;
  state.pauseMenuIndex = 0;
}

export function pauseActiveRace() {
  if (state.mode !== "racing") return false;

  if (tournamentRoomActive()) {
    if (!state.tournamentRoom.paused) {
      toggleTournamentRoomPause();
    }
    clearRaceInputs();
    return true;
  }

  if (!state.paused) {
    state.paused = true;
    state.pauseMenuIndex = 0;
  }
  clearRaceInputs();
  return true;
}

function setRaceReturnTarget(mode, editorTrackIndex = null) {
  state.raceReturn.mode = mode;
  state.raceReturn.editorTrackIndex =
    mode === "editor" && Number.isInteger(editorTrackIndex) ? editorTrackIndex : null;
}

function returnFromRace() {
  const { mode, editorTrackIndex } = state.raceReturn;
  state.paused = false;
  state.pauseMenuIndex = 0;
  if (mode === "editor" && Number.isInteger(editorTrackIndex)) {
    enterEditor(editorTrackIndex);
    return;
  }
  returnToTrackSelect();
}

function updateEditorCursorFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const screenX = (event.clientX - rect.left) * scaleX;
  const canvasY = (event.clientY - rect.top) * scaleY;
  const screenY = canvasY - EDITOR_TOP_BAR_HEIGHT;
  updateEditorCursorFromScreen(screenX, screenY, canvasY);
}

export function updateEditorCursorFromScreen(screenX, screenY, canvasY = null) {
  const worldScale = clampWorldScale(Number(track.worldScale) || 1);
  state.editor.cursorScreenX = screenX;
  if (canvasY !== null) state.editor.cursorCanvasY = canvasY;
  state.editor.cursorScreenY = screenY;
  state.editor.cursorX = track.cx + (screenX - state.editor.viewOffsetX - track.cx) / worldScale;
  state.editor.cursorY = track.cy + (screenY - state.editor.viewOffsetY - track.cy) / worldScale;
}

function rebuildEditorTrackGeometry() {
  const generated = regenerateTrackFromCenterlineStrokes(state.editor.trackIndex);
  if (!generated) return false;
  applyTrackPreset(state.editor.trackIndex);
  setCurbSegments(initCurbSegments());
  return true;
}

function startEditorRace() {
  state.selectedTrackIndex = state.editor.trackIndex;
  applyTrackPreset(state.editor.trackIndex);
  setCurbSegments(initCurbSegments());
  setRaceReturnTarget("editor", state.editor.trackIndex);
  state.mode = "racing";
  syncMenuMusicForMode(state.mode);
  prepareSingleRaceAiRoster();
  resetRace();
  const selected = trackOptions[state.selectedTrackIndex];
  if (selected) setTrackInUrl(selected.id);
}

function placeEditorObject(type) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (!preset.editStack) preset.editStack = [];
  const x = state.editor.cursorX;
  const y = state.editor.cursorY;

  if (type === "tree") {
    const tree = { type: "tree", x, y, r: 24, angle: 0, height: 3 };
    preset.worldObjects.push(tree);
    preset.editStack.push({
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    });
    state.editor.latestEditTarget = {
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    };
    triggerEditorSelectionFlash("object", preset.worldObjects.length - 1);
    applyTrackPreset(state.editor.trackIndex);
    return;
  }
  if (type === "pond") {
    const pond = {
      type: "pond",
      x,
      y,
      rx: 78,
      ry: 44,
      seed: Math.random() * 2 - 1,
      angle: 0,
    };
    preset.worldObjects.push(pond);
    preset.editStack.push({
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    });
    state.editor.latestEditTarget = {
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    };
    triggerEditorSelectionFlash("object", preset.worldObjects.length - 1);
    applyTrackPreset(state.editor.trackIndex);
    return;
  }
  if (type === "oil") {
    const oil = {
      type: "oil",
      x,
      y,
      rx: 74,
      ry: 38,
      seed: Math.random() * 2 - 1,
      angle: 0,
    };
    preset.worldObjects.push(oil);
    preset.editStack.push({
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    });
    state.editor.latestEditTarget = {
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    };
    triggerEditorSelectionFlash("object", preset.worldObjects.length - 1);
    applyTrackPreset(state.editor.trackIndex);
    return;
  }
  if (type === "barrel") {
    const barrel = { type: "barrel", x, y, r: 12, angle: 0, height: 1 };
    preset.worldObjects.push(barrel);
    preset.editStack.push({
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    });
    state.editor.latestEditTarget = {
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    };
    triggerEditorSelectionFlash("object", preset.worldObjects.length - 1);
    applyTrackPreset(state.editor.trackIndex);
    return;
  }
  if (type === "spring") {
    const spring = { type: "spring", x, y, r: 16, angle: 0, height: 0.4 };
    preset.worldObjects.push(spring);
    preset.editStack.push({
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    });
    state.editor.latestEditTarget = {
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    };
    triggerEditorSelectionFlash("object", preset.worldObjects.length - 1);
    applyTrackPreset(state.editor.trackIndex);
    return;
  }
  if (type === "ramp") {
    const ramp = {
      type: "ramp",
      x,
      y,
      width: 56,
      length: 160,
      angle: 0,
      baseHeight: 0,
      height: 2.4,
      thickness: 10,
    };
    preset.worldObjects.push(ramp);
    preset.editStack.push({
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    });
    state.editor.latestEditTarget = {
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    };
    triggerEditorSelectionFlash("object", preset.worldObjects.length - 1);
    applyTrackPreset(state.editor.trackIndex);
    return;
  }
  if (type === "bridgeDeck") {
    const bridgeDeck = {
      type: "bridgeDeck",
      x,
      y,
      width: 68,
      length: 180,
      angle: 0,
      height: 2.4,
      thickness: 16,
    };
    preset.worldObjects.push(bridgeDeck);
    preset.editStack.push({
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    });
    state.editor.latestEditTarget = {
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    };
    triggerEditorSelectionFlash("object", preset.worldObjects.length - 1);
    applyTrackPreset(state.editor.trackIndex);
    return;
  }
  if (type === "wall") {
    const wall = {
      type: "wall",
      x,
      y,
      width: 18,
      length: 90,
      angle: 0,
      height: 2.5,
    };
    preset.worldObjects.push(wall);
    preset.editStack.push({
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    });
    state.editor.latestEditTarget = {
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    };
    triggerEditorSelectionFlash("object", preset.worldObjects.length - 1);
    applyTrackPreset(state.editor.trackIndex);
    return;
  }
  if (type === "asset") {
    const assetKind = state.editor.selectedAssetKind || "rooster";
    const animal = {
      type: "animal",
      kind: assetKind,
      x,
      y,
      r: getAssetDefaultRadius(assetKind),
      angle: 0,
    };
    preset.worldObjects.push(animal);
    preset.editStack.push({
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    });
    state.editor.latestEditTarget = {
      kind: "object",
      objectIndex: preset.worldObjects.length - 1,
    };
    triggerEditorSelectionFlash("object", preset.worldObjects.length - 1);
    applyTrackPreset(state.editor.trackIndex);
  }
}

function placeEditorCheckpoint() {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  const x = state.editor.cursorX;
  const y = state.editor.cursorY;
  const surface = surfaceAt(x, y);
  if (surface !== "asphalt" && surface !== "curb") return;
  const progress = normalizeCheckpointProgress(trackProgressAtPoint(x, y, track));
  if (checkpointNearStart(progress, preset.track)) {
    showSnackbar("Checkpoint too close to start line", {
      seconds: 1.4,
      kind: "error",
    });
    return;
  }
  if (!preset.checkpoints) preset.checkpoints = [];
  if (!preset.editStack) preset.editStack = [];

  const existingIndex = findCheckpointIndexNearProgress(preset.checkpoints, progress);
  if (existingIndex >= 0) {
    state.editor.latestEditTarget = {
      kind: "checkpoint",
      checkpointIndex: existingIndex,
    };
    triggerEditorSelectionFlash("checkpoint", existingIndex);
    applyTrackPreset(state.editor.trackIndex);
    return;
  }

  const insertIndex = findCheckpointInsertIndex(preset.checkpoints, progress, preset.track);
  preset.checkpoints.splice(insertIndex, 0, { progress });
  shiftEditorStackForInsert(preset, "checkpoint", insertIndex);
  preset.editStack.push({
    kind: "checkpoint",
    checkpointIndex: insertIndex,
  });
  state.editor.latestEditTarget = {
    kind: "checkpoint",
    checkpointIndex: insertIndex,
  };
  triggerEditorSelectionFlash("checkpoint", insertIndex);
  applyTrackPreset(state.editor.trackIndex);
}

function cycleSelectionIndex(count, currentIndex, direction) {
  if (!count) return null;
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= count)
    return count - 1;
  return (currentIndex + direction + count) % count;
}

function selectEditorObject(direction) {
  const preset = getTrackPreset(state.editor.trackIndex);
  const count = preset.worldObjects?.length || 0;
  if (!count) {
    if (state.editor.latestEditTarget?.kind === "object") state.editor.latestEditTarget = null;
    return;
  }
  const currentIndex =
    state.editor.latestEditTarget?.kind === "object"
      ? state.editor.latestEditTarget.objectIndex
      : null;
  const nextIndex = cycleSelectionIndex(count, currentIndex, direction);
  state.editor.latestEditTarget = {
    kind: "object",
    objectIndex: nextIndex,
  };
  triggerEditorSelectionFlash("object", nextIndex);
}

function selectEditorRoad(direction) {
  const preset = getTrackPreset(state.editor.trackIndex);
  const count = preset.centerlineStrokes?.length || 0;
  if (!count) {
    if (state.editor.latestEditTarget?.kind === "stroke") state.editor.latestEditTarget = null;
    return;
  }
  const currentIndex =
    state.editor.latestEditTarget?.kind === "stroke"
      ? state.editor.latestEditTarget.strokeIndex
      : null;
  const nextIndex = cycleSelectionIndex(count, currentIndex, direction);
  state.editor.latestEditTarget = {
    kind: "stroke",
    strokeIndex: nextIndex,
  };
  triggerEditorSelectionFlash("stroke", nextIndex);
}

function objectSelectionTarget(preset) {
  const target = state.editor.latestEditTarget;
  if (target?.kind === "object" && preset.worldObjects?.[target.objectIndex]) {
    return target;
  }
  if (preset.worldObjects?.length) {
    return { kind: "object", objectIndex: preset.worldObjects.length - 1 };
  }
  return null;
}

function roadSelectionTarget(preset) {
  const target = state.editor.latestEditTarget;
  if (target?.kind === "stroke" && preset.centerlineStrokes?.[target.strokeIndex]) {
    return target;
  }
  if (preset.centerlineStrokes?.length) {
    return { kind: "stroke", strokeIndex: preset.centerlineStrokes.length - 1 };
  }
  return null;
}

function checkpointSelectionTarget(preset) {
  const target = state.editor.latestEditTarget;
  if (target?.kind === "checkpoint" && preset.checkpoints?.[target.checkpointIndex]) {
    return target;
  }
  if (preset.checkpoints?.length) {
    return {
      kind: "checkpoint",
      checkpointIndex: preset.checkpoints.length - 1,
    };
  }
  return null;
}

function reindexEditorStack(preset, kind, removedIndex) {
  if (!Array.isArray(preset.editStack)) return;
  const key =
    kind === "object" ? "objectIndex" : kind === "stroke" ? "strokeIndex" : "checkpointIndex";
  preset.editStack = preset.editStack.flatMap((entry) => {
    if (entry.kind !== kind) return [entry];
    if (entry[key] === removedIndex) return [];
    if (entry[key] > removedIndex) return [{ ...entry, [key]: entry[key] - 1 }];
    return [entry];
  });
}

function shiftEditorStackForInsert(preset, kind, insertedIndex) {
  if (!Array.isArray(preset.editStack)) return;
  const key =
    kind === "object" ? "objectIndex" : kind === "stroke" ? "strokeIndex" : "checkpointIndex";
  preset.editStack = preset.editStack.map((entry) => {
    if (entry.kind !== kind) return entry;
    if (entry[key] >= insertedIndex) return { ...entry, [key]: entry[key] + 1 };
    return entry;
  });
}

function deleteSelectedEditorTarget(kind) {
  if (state.mode !== "editor") return;
  clearEditorDragSession();
  const preset = getTrackPreset(state.editor.trackIndex);
  const target =
    kind === "object"
      ? objectSelectionTarget(preset)
      : kind === "checkpoint"
        ? checkpointSelectionTarget(preset)
        : roadSelectionTarget(preset);
  if (!target) return;
  if (target.kind === "object") {
    if (!preset.worldObjects?.[target.objectIndex]) return;
    preset.worldObjects.splice(target.objectIndex, 1);
    reindexEditorStack(preset, "object", target.objectIndex);
    if (preset.worldObjects.length) {
      state.editor.latestEditTarget = {
        kind: "object",
        objectIndex: Math.min(target.objectIndex, preset.worldObjects.length - 1),
      };
    } else {
      syncLatestEditorTarget(preset);
    }
    applyTrackPreset(state.editor.trackIndex);
    return;
  }
  if (target.kind === "checkpoint") {
    if (!preset.checkpoints?.[target.checkpointIndex]) return;
    if (preset.checkpoints.length <= 1) {
      showSnackbar("At least 1 checkpoint is required", {
        seconds: 1.4,
        kind: "error",
      });
      return;
    }
    preset.checkpoints.splice(target.checkpointIndex, 1);
    reindexEditorStack(preset, "checkpoint", target.checkpointIndex);
    if (preset.checkpoints.length) {
      state.editor.latestEditTarget = {
        kind: "checkpoint",
        checkpointIndex: Math.min(target.checkpointIndex, preset.checkpoints.length - 1),
      };
    } else {
      syncLatestEditorTarget(preset);
    }
    applyTrackPreset(state.editor.trackIndex);
    return;
  }
  if (!preset.centerlineStrokes?.[target.strokeIndex]) return;
  preset.centerlineStrokes.splice(target.strokeIndex, 1);
  reindexEditorStack(preset, "stroke", target.strokeIndex);
  if (preset.centerlineStrokes.length) {
    state.editor.latestEditTarget = {
      kind: "stroke",
      strokeIndex: Math.min(target.strokeIndex, preset.centerlineStrokes.length - 1),
    };
  } else {
    syncLatestEditorTarget(preset);
  }
  rebuildEditorTrackGeometry();
}

export function deleteActiveEditorSelection() {
  if (state.mode !== "editor") return false;
  if (state.editor.latestEditTarget?.kind === "stroke") deleteSelectedEditorTarget("stroke");
  else if (state.editor.latestEditTarget?.kind === "checkpoint")
    deleteSelectedEditorTarget("checkpoint");
  else deleteSelectedEditorTarget("object");
  return true;
}

function adjustSelectedObjectSize(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  const target = objectSelectionTarget(preset);
  if (!target) return;
  const object = preset.worldObjects[target.objectIndex];
  if (!object) return;
  if (object.type === "pond" || object.type === "oil") {
    object.rx = Math.max(28, Math.min(180, object.rx + direction * 8));
    object.ry = Math.max(16, Math.min(110, object.ry + direction * 5));
  }
  if (object.type === "tree") {
    object.r = Math.max(12, Math.min(44, object.r + direction * 2));
  }
  if (object.type === "barrel") {
    object.r = Math.max(8, Math.min(22, object.r + direction * 1.5));
  }
  if (object.type === "spring") {
    object.r = Math.max(10, Math.min(28, object.r + direction * 2));
  }
  if (object.type === "animal") {
    object.r = Math.max(
      EDITOR_MIN_ANIMAL_RADIUS,
      Math.min(EDITOR_MAX_ANIMAL_RADIUS, object.r + direction * 1.5),
    );
  }
  if (object.type === "wall") {
    object.length = Math.max(32, Math.min(160, object.length + direction * 8));
  }
  if (object.type === "ramp") {
    object.length = Math.max(64, Math.min(240, object.length + direction * 10));
    object.width = Math.max(34, Math.min(120, object.width + direction * 4));
  }
  if (object.type === "bridgeDeck") {
    object.length = Math.max(72, Math.min(260, object.length + direction * 10));
    object.width = Math.max(42, Math.min(130, object.width + direction * 4));
  }
  state.editor.latestEditTarget = target;
  applyTrackPreset(state.editor.trackIndex);
}

function adjustSelectedRoadWidth(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  const target = roadSelectionTarget(preset);
  if (!target) return;
  const stroke = preset.centerlineStrokes[target.strokeIndex];
  if (!stroke?.length) return;
  for (const point of stroke) {
    const nextWidth =
      (Number.isFinite(point.halfWidth) ? point.halfWidth : getDefaultStrokeHalfWidth(preset)) +
      direction * 4;
    point.halfWidth = Math.max(24, Math.min(120, nextWidth));
  }
  state.editor.latestEditTarget = target;
  rebuildEditorTrackGeometry();
}

function selectEditorCheckpoint(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  const count = preset.checkpoints?.length || 0;
  if (!count) {
    if (state.editor.latestEditTarget?.kind === "checkpoint") state.editor.latestEditTarget = null;
    return;
  }
  const currentIndex =
    state.editor.latestEditTarget?.kind === "checkpoint"
      ? state.editor.latestEditTarget.checkpointIndex
      : null;
  const nextIndex = cycleSelectionIndex(count, currentIndex, direction);
  state.editor.latestEditTarget = {
    kind: "checkpoint",
    checkpointIndex: nextIndex,
  };
  triggerEditorSelectionFlash("checkpoint", nextIndex);
}

function rotateSelectedEditorObject(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  const target = objectSelectionTarget(preset);
  if (!target) return;
  const object = preset.worldObjects[target.objectIndex];
  if (!object) return;
  object.angle = ((object.angle || 0) + direction * (Math.PI / 12)) % (Math.PI * 2);
  state.editor.latestEditTarget = target;
  applyTrackPreset(state.editor.trackIndex);
}

function adjustEditorZoom(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (!preset?.track) return;
  const current = clampWorldScale(Number(preset.track.worldScale) || 1);
  const next = clampWorldScale(Number((current + direction * EDITOR_ZOOM_STEP).toFixed(2)));
  if (next === current) return;
  preset.track.worldScale = next;
  applyTrackPreset(state.editor.trackIndex);
}

function adjustTerrainBrushSize(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (!preset?.track) return;
  preset.track.terrainBrushSize = clampTerrainBrushSize(
    (Number(preset.track.terrainBrushSize) || 72) + direction * 12,
  );
  applyTrackPreset(state.editor.trackIndex);
}

function adjustTerrainBrushStrength(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (!preset?.track) return;
  preset.track.terrainBrushStrength = clampTerrainBrushStrength(
    (Number(preset.track.terrainBrushStrength) || 1) + direction * 0.2,
  );
  applyTrackPreset(state.editor.trackIndex);
}

function adjustTerrainBrushHardness(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (!preset?.track) return;
  preset.track.terrainBrushHardness = clampTerrainBrushHardness(
    (Number(preset.track.terrainBrushHardness) || 0.62) + direction * 0.08,
  );
  applyTrackPreset(state.editor.trackIndex);
}

function startEditorViewPan() {
  state.editor.viewDragging = true;
  state.editor.viewDragLastScreenX = state.editor.cursorScreenX;
  state.editor.viewDragLastScreenY = state.editor.cursorScreenY;
}

function startEditorObjectDrag(target, preset) {
  const object = preset.worldObjects?.[target.objectIndex];
  if (!object) return false;
  clearEditorDragSession();
  state.editor.latestEditTarget = {
    kind: "object",
    objectIndex: target.objectIndex,
  };
  triggerEditorSelectionFlash("object", target.objectIndex);
  state.editor.dragSession.active = true;
  state.editor.dragSession.kind = "object";
  state.editor.dragSession.objectIndex = target.objectIndex;
  state.editor.dragSession.pointerOffsetX = Number(object.x) - state.editor.cursorX;
  state.editor.dragSession.pointerOffsetY = Number(object.y) - state.editor.cursorY;
  state.editor.dragSession.strokeSnapshot = null;
  return true;
}

function startEditorRoadAnchorDrag(target, preset) {
  const stroke = preset.centerlineStrokes?.[target.strokeIndex];
  if (!stroke?.[target.pointIndex]) return false;
  clearEditorDragSession();
  state.editor.latestEditTarget = {
    kind: "stroke",
    strokeIndex: target.strokeIndex,
  };
  triggerEditorSelectionFlash("stroke", target.strokeIndex);
  state.editor.dragSession.active = true;
  state.editor.dragSession.kind = "roadAnchor";
  state.editor.dragSession.strokeIndex = target.strokeIndex;
  state.editor.dragSession.anchorIndex = target.pointIndex;
  state.editor.dragSession.lastRebuildAt = 0;
  state.editor.dragSession.strokeSnapshot = stroke.map((point) => ({ ...point }));
  return true;
}

function anchorFalloffRadius(strokeSnapshot, anchorPointIndex) {
  const anchorIndices = getRoadStrokeAnchorPointIndices(strokeSnapshot);
  const cumulative = buildStrokeCumulativeDistances(strokeSnapshot);
  const anchorSlot = anchorIndices.indexOf(anchorPointIndex);
  const anchorDistance = cumulative[anchorPointIndex] || 0;
  const prevDistance = anchorSlot > 0 ? cumulative[anchorIndices[anchorSlot - 1]] : anchorDistance;
  const nextDistance =
    anchorSlot >= 0 && anchorSlot < anchorIndices.length - 1
      ? cumulative[anchorIndices[anchorSlot + 1]]
      : anchorDistance;
  const localSpan = Math.max(anchorDistance - prevDistance, nextDistance - anchorDistance);
  return Math.max(EDITOR_ROAD_ANCHOR_MIN_SPACING * 1.5, localSpan * EDITOR_ROAD_ANCHOR_FALLOFF_MUL);
}

function applyRoadAnchorDrag(preset, { forceRebuild = false } = {}) {
  const session = state.editor.dragSession;
  const stroke = preset.centerlineStrokes?.[session.strokeIndex];
  const snapshot = session.strokeSnapshot;
  if (!stroke?.length || !snapshot?.length || !snapshot[session.anchorIndex]) return false;

  const cumulative = buildStrokeCumulativeDistances(snapshot);
  const radius = anchorFalloffRadius(snapshot, session.anchorIndex);
  const anchorStart = snapshot[session.anchorIndex];
  const dx = state.editor.cursorX - anchorStart.x;
  const dy = state.editor.cursorY - anchorStart.y;
  const draggedEndpoint = session.anchorIndex === 0 || session.anchorIndex === snapshot.length - 1;
  const anchorDistance = cumulative[session.anchorIndex] || 0;

  for (let i = 0; i < stroke.length; i++) {
    const point = stroke[i];
    const original = snapshot[i];
    const distanceAlong = Math.abs((cumulative[i] || 0) - anchorDistance);
    let influence = Math.max(0, 1 - distanceAlong / Math.max(radius, 1));
    influence = influence * influence * (3 - 2 * influence);
    const endpoint = i === 0 || i === stroke.length - 1;
    if (endpoint && !draggedEndpoint && i !== session.anchorIndex) influence *= 0.35;
    point.x = original.x + dx * influence;
    point.y = original.y + dy * influence;
  }

  const now = Date.now();
  if (forceRebuild || now - session.lastRebuildAt >= EDITOR_ROAD_REBUILD_THROTTLE_MS) {
    rebuildEditorTrackGeometry();
    session.lastRebuildAt = now;
  }
  return true;
}

export function beginEditorCanvasInteraction(mouseButton = 0) {
  if (state.mode !== "editor") return false;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (!preset) return false;

  if (state.editor.panMode) {
    startEditorViewPan();
    return true;
  }

  if (state.editor.activeTool === "terrain") {
    state.editor.drawing = true;
    state.editor.activeStroke = [];
    state.editor.terrainPaintDirection = mouseButton === 2 ? -1 : 1;
    paintTerrainAtCursor(preset, state.editor.terrainPaintDirection);
    return true;
  }

  const objectTarget = pickEditorObjectAt(state.editor.cursorX, state.editor.cursorY, preset);
  if (objectTarget) return startEditorObjectDrag(objectTarget, preset);

  const roadAnchorTarget = pickSelectedRoadAnchorAt(
    state.editor.cursorX,
    state.editor.cursorY,
    preset,
  );
  if (roadAnchorTarget) return startEditorRoadAnchorDrag(roadAnchorTarget, preset);

  const strokeTarget = pickStrokeAt(state.editor.cursorX, state.editor.cursorY, preset);
  if (strokeTarget) {
    state.editor.latestEditTarget = {
      kind: "stroke",
      strokeIndex: strokeTarget.strokeIndex,
    };
    triggerEditorSelectionFlash("stroke", strokeTarget.strokeIndex);
    return true;
  }

  if (state.editor.activeTool !== "road") {
    placeEditorObject(state.editor.activeTool);
    return true;
  }
  if (state.editor.roadMode === "checkpoint") {
    placeEditorCheckpoint();
    return true;
  }

  const halfWidth = getDefaultStrokeHalfWidth(preset);
  state.editor.drawing = true;
  state.editor.activeStroke = [{ x: state.editor.cursorX, y: state.editor.cursorY, halfWidth }];
  return true;
}

export function updateEditorCanvasInteraction() {
  if (state.mode !== "editor") return false;
  const preset = getTrackPreset(state.editor.trackIndex);
  const session = state.editor.dragSession;
  if (session.active && session.kind === "object") {
    const object = preset?.worldObjects?.[session.objectIndex];
    if (!object) {
      clearEditorDragSession();
      return false;
    }
    object.x = state.editor.cursorX + session.pointerOffsetX;
    object.y = state.editor.cursorY + session.pointerOffsetY;
    applyTrackPreset(state.editor.trackIndex);
    return true;
  }
  if (session.active && session.kind === "roadAnchor") {
    return applyRoadAnchorDrag(preset);
  }

  if (!state.editor.drawing) return false;
  if (state.editor.activeTool === "terrain") {
    return paintTerrainAtCursor(preset, state.editor.terrainPaintDirection || 1);
  }
  const points = state.editor.activeStroke;
  const last = points[points.length - 1];
  const x = state.editor.cursorX;
  const y = state.editor.cursorY;
  if (!last || Math.hypot(x - last.x, y - last.y) > 4) {
    points.push({
      x,
      y,
      halfWidth: last?.halfWidth || EDITOR_DEFAULT_HALF_WIDTH,
    });
  }
  return true;
}

export function endEditorCanvasInteraction() {
  if (state.mode !== "editor") return false;
  const preset = getTrackPreset(state.editor.trackIndex);
  const session = state.editor.dragSession;
  if (session.active) {
    if (session.kind === "roadAnchor") applyRoadAnchorDrag(preset, { forceRebuild: true });
    clearEditorDragSession();
    return true;
  }

  if (!state.editor.drawing) return false;
  state.editor.drawing = false;
  state.editor.terrainPaintDirection = 0;
  if (state.editor.activeTool === "terrain") {
    state.editor.activeStroke = [];
    return true;
  }
  const stroke = state.editor.activeStroke;
  state.editor.activeStroke = [];
  if (stroke.length < 2) return true;
  if (!preset.centerlineStrokes) preset.centerlineStrokes = [];
  const nextStroke = stroke.map((point) => ({
    x: point.x,
    y: point.y,
    halfWidth: Number.isFinite(point.halfWidth) ? point.halfWidth : EDITOR_DEFAULT_HALF_WIDTH,
  }));
  const selectedStrokeIndex =
    state.editor.latestEditTarget?.kind === "stroke"
      ? state.editor.latestEditTarget.strokeIndex
      : null;
  const insertIndex =
    Number.isInteger(selectedStrokeIndex) &&
    selectedStrokeIndex >= 0 &&
    selectedStrokeIndex < preset.centerlineStrokes.length
      ? selectedStrokeIndex + 1
      : preset.centerlineStrokes.length;
  preset.centerlineStrokes.splice(insertIndex, 0, nextStroke);
  if (!preset.editStack) preset.editStack = [];
  shiftEditorStackForInsert(preset, "stroke", insertIndex);
  preset.editStack.push({
    kind: "stroke",
    strokeIndex: insertIndex,
  });
  state.editor.latestEditTarget = {
    kind: "stroke",
    strokeIndex: insertIndex,
  };
  triggerEditorSelectionFlash("stroke", insertIndex);
  return true;
}

export function panEditorViewBy(dx, dy) {
  if (state.mode !== "editor") return;
  state.editor.viewOffsetX += dx;
  state.editor.viewOffsetY += dy;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (preset?.track) {
    preset.track.editorViewOffsetX = state.editor.viewOffsetX;
    preset.track.editorViewOffsetY = state.editor.viewOffsetY;
  }
  track.editorViewOffsetX = state.editor.viewOffsetX;
  track.editorViewOffsetY = state.editor.viewOffsetY;
}

function adjustEditorSmoothing(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (!preset?.track) return;
  const current = normalizeCenterlineSmoothingMode(preset.track.centerlineSmoothingMode);
  const index = CENTERLINE_SMOOTHING_MODES.indexOf(current);
  const nextIndex = Math.max(0, Math.min(CENTERLINE_SMOOTHING_MODES.length - 1, index + direction));
  if (nextIndex === index) return;
  preset.track.centerlineSmoothingMode = CENTERLINE_SMOOTHING_MODES[nextIndex];
  if (!rebuildEditorTrackGeometry()) {
    applyTrackPreset(state.editor.trackIndex);
  }
}

function performEditorToolbarAction(actionId) {
  if (typeof actionId === "string" && actionId.startsWith("asset:")) {
    state.editor.selectedAssetKind = actionId.slice(6) || "rooster";
    state.editor.assetPaletteOpen = false;
    setEditorTool("asset");
  }
  if (actionId === "objectDelete") deleteSelectedEditorTarget("object");
  if (actionId === "terrain") toggleEditorTool("terrain");
  if (actionId === "water") toggleEditorTool("pond");
  if (actionId === "oil") toggleEditorTool("oil");
  if (actionId === "barrel") toggleEditorTool("barrel");
  if (actionId === "tree") toggleEditorTool("tree");
  if (actionId === "spring") toggleEditorTool("spring");
  if (actionId === "ramp") toggleEditorTool("ramp");
  if (actionId === "bridgeDeck") toggleEditorTool("bridgeDeck");
  if (actionId === "wall") toggleEditorTool("wall");
  if (actionId === "assets") {
    state.editor.assetPaletteOpen = !state.editor.assetPaletteOpen;
    if (state.editor.assetPaletteOpen) setEditorTool("asset");
  }
  if (actionId === "objectPrev") selectEditorObject(-1);
  if (actionId === "objectNext") selectEditorObject(1);
  if (actionId === "objectSizeDown") adjustSelectedObjectSize(-1);
  if (actionId === "objectSizeUp") adjustSelectedObjectSize(1);
  if (actionId === "rotateLeft") rotateSelectedEditorObject(-1);
  if (actionId === "rotateRight") rotateSelectedEditorObject(1);
  if (actionId === "save") promptSaveEditorTrack();
  if (actionId === "toggleCurbs") state.editor.showCurbs = !state.editor.showCurbs;
  if (actionId === "back") returnToTrackSelect();
  if (actionId === "roadModeSegment") setEditorRoadMode("segment");
  if (actionId === "roadModeCheckpoint") setEditorRoadMode("checkpoint");
  if (actionId === "roadPrev") selectEditorRoad(-1);
  if (actionId === "roadNext") selectEditorRoad(1);
  if (actionId === "roadDelete") deleteSelectedEditorTarget("stroke");
  if (actionId === "checkpointPrev") selectEditorCheckpoint(-1);
  if (actionId === "checkpointNext") selectEditorCheckpoint(1);
  if (actionId === "checkpointDelete") deleteSelectedEditorTarget("checkpoint");
  if (actionId === "roadSizeDown") adjustSelectedRoadWidth(-1);
  if (actionId === "roadSizeUp") adjustSelectedRoadWidth(1);
  if (actionId === "roadSmoothPrev") adjustEditorSmoothing(-1);
  if (actionId === "roadSmoothNext") adjustEditorSmoothing(1);
  if (actionId === "terrainBrushSizeDown") adjustTerrainBrushSize(-1);
  if (actionId === "terrainBrushSizeUp") adjustTerrainBrushSize(1);
  if (actionId === "terrainBrushStrengthDown") adjustTerrainBrushStrength(-1);
  if (actionId === "terrainBrushStrengthUp") adjustTerrainBrushStrength(1);
  if (actionId === "terrainBrushHardnessDown") adjustTerrainBrushHardness(-1);
  if (actionId === "terrainBrushHardnessUp") adjustTerrainBrushHardness(1);
  if (actionId === "zoomOut") adjustEditorZoom(-1);
  if (actionId === "zoomIn") adjustEditorZoom(1);
  if (actionId === "togglePan") setEditorPanMode(!state.editor.panMode);
}

function performEditorTopBarAction(actionId) {
  if (actionId === "save") promptSaveEditorTrack();
  if (actionId === "toggleCurbs") state.editor.showCurbs = !state.editor.showCurbs;
  if (actionId === "back") returnToTrackSelect();
  if (actionId === "race") startEditorRace();
  if (actionId === "build") rebuildEditorTrackGeometry();
}

function trackSelectCardCount() {
  return trackOptions.length; // Track cards only.
}

function trackSelectBackIndex() {
  return trackSelectCardCount();
}

function trackSelectStartTournamentIndex() {
  return trackSelectCardCount() + 1;
}

async function saveEditorTrack(requestedName) {
  const trackIndex = state.editor.trackIndex;
  const previousPreset = getTrackPreset(trackIndex);
  const previousId = previousPreset.id;
  const shouldReplacePrevious = !previousPreset.fromDb && previousPreset.source !== "system";
  saveTrackPreset(trackIndex);
  try {
    const imported = await saveTrackPresetToDb(trackIndex, {
      currentUserId: state.auth.userId,
      currentUserIsAdmin: state.auth.isAdmin,
      name: requestedName,
    });
    if (!imported) {
      showSnackbar("Save failed", { seconds: 2, kind: "error" });
      return;
    }
    if (shouldReplacePrevious && previousId !== imported.id) {
      removeTrackPresetById(previousId, { removePersisted: true });
    }
    const importedIndex = trackOptions.findIndex((opt) => opt.id === imported.id);
    if (importedIndex >= 0) {
      state.editor.trackIndex = importedIndex;
      state.selectedTrackIndex = importedIndex;
      state.trackSelectIndex = importedIndex;
      syncTrackSelectWindow();
      setTrackEditorUrl(imported.id);
    }
    showSnackbar("Saved to DB", { kind: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    if (message.toLowerCase().includes("authentication required"))
      showSnackbar("Login required", { seconds: 2, kind: "error" });
    else showSnackbar(message, { seconds: 2, kind: "error" });
  }
}

function openTrackNameModal({ initialValue = "", confirmLabel = "Save", onSubmit }) {
  openInputModal({
    title: "Track name",
    message: "Enter the track name.",
    confirmLabel,
    cancelLabel: "Cancel",
    initialValue,
    maxLength: 36,
    onSubmit,
  });
}

function promptSaveEditorTrack() {
  const preset = getTrackPreset(state.editor.trackIndex);
  if (preset?.fromDb) {
    void saveEditorTrack();
    return;
  }
  openTrackNameModal({
    initialValue: preset?.name || "",
    confirmLabel: "Save",
    onSubmit: async (rawName) => {
      await saveEditorTrack(rawName);
    },
  });
}

export function promptClearTrackRecords(trackIndex) {
  const preset = getTrackPreset(trackIndex);
  if (!preset) return false;
  if (!trackHasRecords(preset)) {
    showSnackbar("No records to clear", { seconds: 1.6, kind: "error" });
    return false;
  }
  if (!canClearTrackRecordsPreset(preset)) {
    showSnackbar("Only the track owner or an admin can clear records", {
      seconds: 2,
      kind: "error",
    });
    return false;
  }
  openConfirmModal({
    title: "Clear Records",
    message: `Clear best lap and race times for ${preset.name || "this track"}?`,
    confirmLabel: "Clear",
    cancelLabel: "Cancel",
    danger: true,
    onConfirm: async () => {
      let updatedPreset = null;
      try {
        updatedPreset = await clearTrackRecordsAtIndex(trackIndex);
      } catch (error) {
        showSnackbar(error instanceof Error ? error.message : "Could not clear records", {
          seconds: 2,
          kind: "error",
        });
        return;
      }
      if (!updatedPreset) return;
      showSnackbar("Track records cleared", {
        seconds: 1.6,
        kind: "success",
      });
    },
  });
  return true;
}

export function promptClearEditorTrackRecords() {
  return promptClearTrackRecords(state.editor.trackIndex);
}

export function promptClearSelectedTrackRecords() {
  return promptClearTrackRecords(state.trackSelectIndex);
}

function toggleDebugMode() {
  physicsConfig.flags.DEBUG_MODE = !physicsConfig.flags.DEBUG_MODE;
  saveDebugMode(physicsConfig.flags.DEBUG_MODE);
}

function toggleMenuMusic() {
  const nextValue = !isMenuMusicEnabled();
  saveMenuMusicEnabled(nextValue);
  setMenuMusicEnabled(nextValue);
}

function setPlayerColor(nextColor) {
  state.playerColor = sanitizeCarColor(nextColor, state.playerColor);
  savePlayerColor(state.playerColor);
}

function stepPlayerColor(delta) {
  const paletteIds = CAR_COLOR_PALETTE.map((option) => option.id);
  const currentIndex = Math.max(0, paletteIds.indexOf(state.playerColor));
  const nextIndex = (currentIndex + delta + paletteIds.length) % paletteIds.length;
  setPlayerColor(paletteIds[nextIndex]);
}

function toggleAiOpponents() {
  physicsConfig.flags.AI_OPPONENTS_ENABLED = !physicsConfig.flags.AI_OPPONENTS_ENABLED;
  saveAiOpponentsEnabled(physicsConfig.flags.AI_OPPONENTS_ENABLED);
}

function toggleSidewaysDrift() {
  physicsConfig.flags.SIDEWAYS_DRIFT_ENABLED = !physicsConfig.flags.SIDEWAYS_DRIFT_ENABLED;
  saveSidewaysDriftEnabled(physicsConfig.flags.SIDEWAYS_DRIFT_ENABLED);
}

function setAiOpponentCount(nextCount) {
  physicsConfig.flags.AI_OPPONENT_COUNT = sanitizeAiOpponentCount(nextCount);
  saveAiOpponentCount(physicsConfig.flags.AI_OPPONENT_COUNT);
}

function stepAiOpponentCount(delta) {
  setAiOpponentCount(sanitizeAiOpponentCount(physicsConfig.flags.AI_OPPONENT_COUNT) + delta);
}

function cycleAiOpponentCount() {
  const current = sanitizeAiOpponentCount(physicsConfig.flags.AI_OPPONENT_COUNT);
  setAiOpponentCount(current >= MAX_AI_OPPONENT_COUNT ? MIN_AI_OPPONENT_COUNT : current + 1);
}

function createEmptyTrackAndEdit() {
  const id = `track-${Date.now()}`;
  const newTrack = {
    id,
    name: "NEW TRACK",
    track: {
      cx: canvas.width * 0.5,
      cy: canvas.height * 0.53,
      borderSize: 22,
      centerlineLoop: null,
      centerlineHalfWidth: 60,
      centerlineWidthProfile: null,
      worldScale: 1,
      centerlineSmoothingMode: DEFAULT_CENTERLINE_SMOOTHING_MODE,
    },
    checkpoints: [
      { angle: 0 },
      { angle: Math.PI * 0.5 },
      { angle: Math.PI },
      { angle: Math.PI * 1.5 },
    ],
    worldObjects: [],
    centerlineStrokes: [],
    editStack: [],
  };

  const imported = importTrackPresetData(newTrack, { persist: true });
  if (!imported) {
    showSnackbar("Could not create track", { seconds: 2, kind: "error" });
    return;
  }
  const idx = trackOptions.findIndex((opt) => opt.id === imported.id);
  if (idx < 0) {
    showSnackbar("Could not create track", { seconds: 2, kind: "error" });
    return;
  }
  state.selectedTrackIndex = idx;
  state.trackSelectIndex = idx;
  syncTrackSelectWindow();
  showSnackbar("New track created", { seconds: 1.6, kind: "success" });
  enterEditor(idx);
}

export function enterEditor(trackIndex) {
  state.selectedTrackIndex = trackIndex;
  applyTrackPreset(trackIndex);
  setCurbSegments(initCurbSegments());
  skidMarks.length = 0;
  state.tournamentRoom.pendingSkidMarks.length = 0;
  state.mode = "editor";
  syncMenuMusicForMode(state.mode);
  state.editor.trackIndex = trackIndex;
  state.editor.activeTool = "road";
  state.editor.assetPaletteOpen = false;
  state.editor.roadMode = "segment";
  state.editor.drawing = false;
  state.editor.activeStroke = [];
  state.editor.panMode = false;
  state.editor.viewOffsetX = Number(track.editorViewOffsetX) || 0;
  state.editor.viewOffsetY = Number(track.editorViewOffsetY) || 0;
  state.editor.viewDragging = false;
  clearEditorDragSession();
  state.editor.toolbar.dragging = false;
  const savedToolbarPosition = loadEditorToolbarPosition();
  if (savedToolbarPosition) {
    state.editor.toolbar.x = savedToolbarPosition.x;
    state.editor.toolbar.y = savedToolbarPosition.y;
  }
  clampEditorToolbarPosition();
  const preset = getTrackPreset(trackIndex);
  syncLatestEditorTarget(preset);
  if (preset) setTrackEditorUrl(preset.id);
}

function enterTrackSelect() {
  if (trackOptions.length > 0) {
    state.selectedTrackIndex = Math.max(
      0,
      Math.min(state.selectedTrackIndex, trackOptions.length - 1),
    );
  } else {
    state.selectedTrackIndex = 0;
  }
  state.mode = "trackSelect";
  setTrackSelectUrl();
  syncMenuMusicForMode(state.mode);
  state.trackSelectIndex = state.selectedTrackIndex;
  state.trackSelectViewOffset = 0;
  syncTrackSelectWindow();
}

function startTournament() {
  const indices = Array.from(state.tournament.selectedTrackIndices);
  if (indices.length === 0) return;
  physicsConfig.flags.AI_OPPONENTS_ENABLED = true;
  Promise.resolve(createHostedTournamentRoom()).catch((error) => {
    const message = error instanceof Error ? error.message : "Tournament room create failed";
    showSnackbar(message, { seconds: 2.2, kind: "error" });
  });
}

function startTournamentRace(raceIndex) {
  const trackIndex = state.tournament.trackOrder[raceIndex];
  state.selectedTrackIndex = trackIndex;
  applyTrackPreset(trackIndex);
  setCurbSegments(initCurbSegments());
  setRaceReturnTarget("trackSelect");
  state.mode = "racing";
  syncMenuMusicForMode(state.mode);
  resetRace();
  const selected = trackOptions[trackIndex];
  if (selected) setTrackInUrl(selected.id);
}

function finishTournamentRace() {
  if (tournamentRoomActive() && !state.tournamentRoom.isHost) return;
  const standings = getRaceStandings();
  const playerName = state.playerName || "PLAYER";
  const nameMap = { player: playerName };
  getActiveAiCars().forEach((vehicle) => {
    nameMap[vehicle.id] = vehicle.label;
  });
  const result = {};
  standings.forEach((entry, idx) => {
    const name = nameMap[entry.id] || entry.id;
    const pts = TOURNAMENT_POINTS[idx] || 0;
    result[name] = { order: idx + 1, points: pts };
    state.tournament.scores[name] = (state.tournament.scores[name] || 0) + pts;
  });
  state.tournament.raceResults.push(result);
  state.tournament.currentRaceIndex += 1;
  state.mode = "tournamentStandings";
  syncMenuMusicForMode(state.mode);
  state.paused = false;
  state.pauseMenuIndex = 0;
  if (tournamentRoomActive()) {
    syncTournamentRoomSnapshot("standings");
  }
}

function advanceFromTournamentStandings() {
  if (tournamentRoomActive() && !canAdvanceHostedTournamentStandings()) return;
  if (state.tournament.currentRaceIndex < state.tournament.trackOrder.length) {
    if (tournamentRoomActive()) {
      onTournamentStandingsAdvanced();
    } else {
      startTournamentRace(state.tournament.currentRaceIndex);
    }
  } else {
    state.mode = "tournamentFinal";
    syncMenuMusicForMode(state.mode);
    emitScreenConfettiFromMenus();
    if (tournamentRoomActive()) {
      syncTournamentRoomSnapshot("final");
    }
  }
}

function emitScreenConfettiFromMenus() {
  import("./particles.js").then(({ emitScreenConfetti }) => {
    emitScreenConfetti({ x: canvas.width * 0.5, y: 80 });
  });
}

export function getTournamentStandingsData() {
  const scores = { ...state.tournament.scores };
  const sorted = Object.entries(scores)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);
  const raceIndex = state.tournament.currentRaceIndex;
  const totalRaces = state.tournament.trackOrder.length;
  const lastResult = state.tournament.raceResults[state.tournament.raceResults.length - 1] || {};
  return { sorted, raceIndex, totalRaces, lastResult };
}

export function prepareSingleRaceAiRoster() {
  if (state.gameMode === "tournament") return state.aiRoster;
  if (physicsConfig.flags.AI_OPPONENTS_ENABLED === false) return state.aiRoster;
  return assignRandomAiRoster();
}

function activateSelection() {
  state.menuIndex = Math.max(0, Math.min(state.menuIndex, currentMenuItems().length - 1));
  state.loginProviderIndex = Math.max(
    0,
    Math.min(state.loginProviderIndex, currentLoginProviderItems().length - 1),
  );
  state.settingsIndex = Math.max(
    0,
    Math.min(state.settingsIndex, currentSettingsItems().length - 1),
  );

  if (state.mode === "menu") {
    const selectedItem = currentMenuItems()[state.menuIndex];
    if (selectedItem === "LOGIN") {
      state.mode = "loginProviders";
      syncMenuMusicForMode(state.mode);
      state.loginProviderIndex = 0;
      return;
    }
    if (selectedItem === "RACE" || selectedItem === "RACE ANONYMOUSLY") {
      state.mode = "gameModeSelect";
      syncMenuMusicForMode(state.mode);
      state.gameModeIndex = 0;
      return;
    }
    if (selectedItem === "SETTINGS") {
      state.mode = "settings";
      setSettingsUrl();
      syncMenuMusicForMode(state.mode);
      state.settingsIndex = 0;
      state.editingName = false;
      return;
    }
    return;
  }

  if (state.mode === "gameModeSelect") {
    const items = getGameModeItems();
    const selectedItem = items[state.gameModeIndex];
    if (selectedItem === "SINGLE RACE") {
      state.gameMode = "single";
      state.tournament.selectedTrackIndices.clear();
      enterTrackSelect();
      return;
    }
    if (selectedItem === "TOURNAMENT") {
      state.gameMode = "tournament";
      state.tournament.selectedTrackIndices.clear();
      enterTrackSelect();
      return;
    }
    if (selectedItem === "BACK") {
      state.mode = "menu";
      syncMenuMusicForMode(state.mode);
      state.menuIndex = raceMenuIndex();
      return;
    }
    return;
  }

  if (state.mode === "loginProviders") {
    const selectedItem = currentLoginProviderItems()[state.loginProviderIndex];
    if (selectedItem === "LOGIN WITH GOOGLE") {
      window.location.assign("/api/auth/google/login");
      return;
    }
    if (selectedItem === "LOGIN WITH FACEBOOK") {
      window.location.assign("/api/auth/facebook/login");
      return;
    }
    if (selectedItem === "BACK") {
      state.mode = "menu";
      syncMenuMusicForMode(state.mode);
      state.menuIndex = loginMenuIndex();
      return;
    }
    return;
  }

  if (state.mode === "trackSelect") {
    const backIndex = trackSelectBackIndex();
    const startTournamentIdx = trackSelectStartTournamentIndex();

    if (state.trackSelectIndex === backIndex) {
      state.mode = "gameModeSelect";
      syncMenuMusicForMode(state.mode);
      return;
    }

    if (state.gameMode === "tournament" && state.trackSelectIndex === startTournamentIdx) {
      startTournament();
      return;
    }

    if (state.gameMode === "tournament") {
      // Toggle track selection
      const idx = state.trackSelectIndex;
      if (idx >= 0 && idx < trackOptions.length) {
        if (state.tournament.selectedTrackIndices.has(idx)) {
          state.tournament.selectedTrackIndices.delete(idx);
        } else {
          state.tournament.selectedTrackIndices.add(idx);
        }
      }
      return;
    }

    // Single race mode
    if (state.trackSelectIndex >= 0 && state.trackSelectIndex < trackOptions.length) {
      state.selectedTrackIndex = state.trackSelectIndex;
      applyTrackPreset(state.selectedTrackIndex);
      setCurbSegments(initCurbSegments());
      setRaceReturnTarget("trackSelect");
      state.mode = "racing";
      syncMenuMusicForMode(state.mode);
      prepareSingleRaceAiRoster();
      resetRace();
      const selected = trackOptions[state.selectedTrackIndex];
      if (selected) setTrackInUrl(selected.id);
    }
    return;
  }

  if (state.mode === "settings") {
    const selectedSetting = currentSettingsItems()[state.settingsIndex];
    if (selectedSetting === "PLAYER NAME") {
      state.editingName = !state.editingName;
      return;
    }
    if (selectedSetting === "PLAYER COLOR") {
      stepPlayerColor(1);
      return;
    }
    if (selectedSetting === "MENU MUSIC") {
      toggleMenuMusic();
      return;
    }
    if (selectedSetting === "AI OPPONENTS") {
      cycleAiOpponentCount();
      return;
    }
    if (selectedSetting === "SIDEWAYS DRIFT") {
      toggleSidewaysDrift();
      return;
    }
    if (selectedSetting === "DEBUG MODE") {
      toggleDebugMode();
      return;
    }
    if (selectedSetting === "LOGOUT") {
      Promise.resolve(logoutAuth())
        .then(() => {
          state.auth.authenticated = false;
          state.auth.userId = null;
          state.auth.displayName = null;
          state.auth.isAdmin = false;
          state.playerName = sanitizePlayerName(state.playerName);
          state.mode = "menu";
          setMainMenuUrl();
          syncMenuMusicForMode(state.mode);
          state.menuIndex = 0;
          state.settingsIndex = 0;
          state.editingName = false;
          state.paused = false;
          showSnackbar("Logged out", { seconds: 1.8, kind: "info" });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : "Logout failed";
          showSnackbar(message, { seconds: 2, kind: "error" });
        });
      return;
    }
    if (selectedSetting === "BACK") {
      state.mode = "menu";
      setMainMenuUrl();
      syncMenuMusicForMode(state.mode);
      state.menuIndex = settingsMenuIndex();
      state.paused = false;
      return;
    }
    return;
  }

  if (state.mode === "tournamentLobby") {
    const shareIndex = state.tournamentRoom.slots.length;
    const startIndex = state.tournamentRoom.isHost ? shareIndex + 1 : -1;
    if (state.tournamentLobbyIndex === shareIndex) {
      void copyTournamentRoomUrl();
      return;
    }
    if (state.tournamentLobbyIndex === startIndex && canStartHostedRoomRace()) {
      startHostedRoomRace();
    }
    return;
  }

  if (state.mode === "tournamentStandings") {
    advanceFromTournamentStandings();
    return;
  }

  if (state.mode === "tournamentFinal") {
    if (tournamentRoomActive()) leaveTournamentRoom({ resetUrl: false });
    state.mode = "menu";
    syncMenuMusicForMode(state.mode);
    state.menuIndex = 0;
    state.paused = false;
    state.pauseMenuIndex = 0;
    return;
  }

  if (state.mode === "racing" && state.finished) {
    if (state.raceReturn.mode === "editor") {
      returnFromRace();
    } else if (state.gameMode === "tournament") {
      // Only allow finishing tournament race when all human players have finished
      if (allTournamentHumansFinished()) {
        finishTournamentRace();
      }
    } else {
      returnToTrackSelect();
    }
  }
}

function onKeyDown(e) {
  const key = e.key.toLowerCase();
  const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

  if (
    ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key) ||
    ((key === "backspace" || key === "delete") &&
      (state.mode === "trackSelect" || state.mode === "editor" || state.modal.open))
  ) {
    e.preventDefault();
  }

  if (state.mode === "editor" && key === "s" && (e.metaKey || e.ctrlKey) && !e.altKey) {
    e.preventDefault();
    if (!e.repeat) promptSaveEditorTrack();
    return;
  }

  if (state.modal.open) {
    if (state.modal.mode === "input") {
      if (["arrowleft", "arrowright", "arrowup", "arrowdown", "tab"].includes(key)) {
        state.modal.selectedAction = state.modal.selectedAction === "cancel" ? "confirm" : "cancel";
        return;
      }
      if (key === "escape") {
        closeModal({ runCancel: true });
        return;
      }
      if (key === "enter") {
        const shouldSubmit = state.modal.selectedAction === "confirm";
        const onSubmit = state.modal.onSubmit;
        const value = state.modal.inputValue;
        if (shouldSubmit && !String(value || "").trim()) {
          showSnackbar("Track name required", { seconds: 2, kind: "error" });
          return;
        }
        closeModal();
        if (shouldSubmit && typeof onSubmit === "function") {
          Promise.resolve(onSubmit(value)).catch((error) => {
            const message = error instanceof Error ? error.message : "Action failed";
            showSnackbar(message, { seconds: 2, kind: "error" });
          });
        }
        return;
      }
      if (key === "backspace") {
        state.modal.inputValue = state.modal.inputValue.slice(0, -1);
        return;
      }
      if (
        key.length === 1 &&
        /^[a-z0-9 _-]$/i.test(key) &&
        state.modal.inputValue.length < state.modal.inputMaxLength
      ) {
        state.modal.inputValue += key.toUpperCase();
      }
      return;
    }

    if (["arrowleft", "arrowright", "arrowup", "arrowdown", "tab"].includes(key)) {
      state.modal.selectedAction = state.modal.selectedAction === "cancel" ? "confirm" : "cancel";
      return;
    }
    if (key === "escape") {
      closeModal({ runCancel: true });
      return;
    }
    if (key === "enter") {
      const shouldConfirm = state.modal.selectedAction === "confirm";
      const onConfirm = state.modal.onConfirm;
      closeModal();
      if (shouldConfirm && typeof onConfirm === "function") {
        Promise.resolve(onConfirm()).catch(() => {
          showSnackbar("Action failed", { seconds: 2, kind: "error" });
        });
      }
      return;
    }
    return;
  }

  if (state.mode === "settings" && state.editingName) {
    if (key === "escape") {
      state.editingName = false;
      return;
    }
    if (key === "enter") {
      if (state.playerName.trim().length > 0) {
        state.playerName = sanitizePlayerName(state.playerName);
        if (state.auth.authenticated) {
          Promise.resolve(updateAuthDisplayName(state.playerName))
            .then((payload) => {
              const nextName = sanitizePlayerName(payload.display_name || state.playerName);
              state.playerName = nextName;
              state.auth.displayName = nextName;
              showSnackbar("Display name updated", {
                seconds: 1.8,
                kind: "success",
              });
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : "Update failed";
              showSnackbar(message, { seconds: 2, kind: "error" });
            });
        }
        savePlayerName(state.playerName);
        state.editingName = false;
      }
      return;
    }
    if (key === "backspace") {
      state.playerName = state.playerName.slice(0, -1);
      return;
    }
    if (/^[a-z0-9 ]$/.test(key) && state.playerName.length < 12) {
      state.playerName += key.toUpperCase();
      return;
    }
  }

  // Keep gameplay/menu shortcuts on plain keys only.
  if (hasModifier) return;

  if (state.mode === "racing") {
    if (state.finished && key === "escape") {
      if (state.raceReturn.mode === "editor") returnFromRace();
      else if (state.gameMode === "tournament") {
        if (allTournamentHumansFinished()) finishTournamentRace();
      } else returnToTrackSelect();
      clearRaceInputs();
      return;
    }

    if (!state.paused && !e.repeat) {
      if (key === "c") {
        emitFinishConfetti({ bestLap: true, bestRace: true });
      }
    }

    if (tournamentRoomActive() && (key === "p" || key === "escape")) {
      if (!e.repeat) {
        if (state.tournamentRoom.paused) {
          toggleTournamentRoomPause();
        } else {
          pauseActiveRace();
        }
      }
      clearRaceInputs();
      return;
    }

    if (key === "p" || key === "escape") {
      if (!state.paused) {
        pauseActiveRace();
      } else if (key === "p") {
        state.paused = false;
      }
      clearRaceInputs();
      return;
    }

    if (state.paused) {
      if (tournamentRoomActive()) {
        if (key === "arrowup" || key === "w") {
          state.pauseMenuIndex = (state.pauseMenuIndex + 2 - 1) % 2;
        }
        if (key === "arrowdown" || key === "s") {
          state.pauseMenuIndex = (state.pauseMenuIndex + 1) % 2;
        }
        if (key === "enter") {
          if (state.pauseMenuIndex === 0) toggleTournamentRoomPause();
          else endTournamentRoom();
        }
        clearRaceInputs();
        return;
      }
      if (key === "arrowup" || key === "w") {
        state.pauseMenuIndex = (state.pauseMenuIndex + 2 - 1) % 2;
      }
      if (key === "arrowdown" || key === "s") {
        state.pauseMenuIndex = (state.pauseMenuIndex + 1) % 2;
      }
      if (key === "enter") {
        if (state.pauseMenuIndex === 0) {
          state.paused = false;
        } else {
          returnFromRace();
          clearRaceInputs();
        }
      }
      clearRaceInputs();
      return;
    }
  }

  if (state.mode === "trackSelect" && key === "escape") {
    state.mode = "gameModeSelect";
    syncMenuMusicForMode(state.mode);
    return;
  }
  if (state.mode === "tournamentLobby" && key === "escape") {
    leaveTournamentRoom();
    state.mode = "trackSelect";
    syncMenuMusicForMode(state.mode);
    return;
  }
  if (state.mode === "gameModeSelect" && key === "escape") {
    state.mode = "menu";
    setMainMenuUrl();
    syncMenuMusicForMode(state.mode);
    state.menuIndex = raceMenuIndex();
    return;
  }
  if (state.mode === "tournamentStandings" && key === "escape") {
    advanceFromTournamentStandings();
    return;
  }
  if (state.mode === "tournamentFinal" && key === "escape") {
    state.mode = "menu";
    syncMenuMusicForMode(state.mode);
    state.menuIndex = 0;
    return;
  }
  if (state.mode === "settings" && key === "escape") {
    state.mode = "menu";
    setMainMenuUrl();
    syncMenuMusicForMode(state.mode);
    state.menuIndex = settingsMenuIndex();
    state.paused = false;
    return;
  }
  if (state.mode === "loginProviders" && key === "escape") {
    state.mode = "menu";
    syncMenuMusicForMode(state.mode);
    state.menuIndex = loginMenuIndex();
    return;
  }
  if (state.mode === "editor" && key === "escape") {
    clearEditorDragSession();
    state.editor.viewDragging = false;
    state.editor.drawing = false;
    state.editor.activeStroke = [];
    returnToTrackSelect();
    return;
  }
  if (state.mode === "editor" && (key === "backspace" || key === "delete")) {
    if (e.repeat) return;
    deleteActiveEditorSelection();
    return;
  }

  if (
    key === "p" &&
    state.mode === "trackSelect" &&
    state.trackSelectIndex >= 0 &&
    state.trackSelectIndex < trackOptions.length
  ) {
    const preset = selectedTrackPreset();
    if (!selectedTrackCanPublish() || !preset) return;
    Promise.resolve(setTrackPublished(preset.id, !preset.isPublished))
      .then((updatedTrack) => {
        const updatedPreset = setTrackPresetMetadata(
          updatedTrack.id,
          {
            name: updatedTrack.name,
            ownerUserId: updatedTrack.owner_user_id || null,
            ownerDisplayName: updatedTrack.owner_display_name || null,
            bestLapMs: Number.isFinite(updatedTrack.best_lap_ms)
              ? Number(updatedTrack.best_lap_ms)
              : null,
            bestLapDisplayName: updatedTrack.best_lap_display_name || null,
            bestRaceMs: Number.isFinite(updatedTrack.best_race_ms)
              ? Number(updatedTrack.best_race_ms)
              : null,
            bestRaceDisplayName: updatedTrack.best_race_display_name || null,
            isPublished: Boolean(updatedTrack.is_published),
            shareToken: updatedTrack.share_token || null,
            fromDb: true,
          },
          {
            currentUserId: state.auth.userId,
            currentUserIsAdmin: state.auth.isAdmin,
          },
        );
        if (!updatedPreset) return;
        showSnackbar(updatedPreset.isPublished ? "Track published" : "Track unpublished", {
          seconds: 1.8,
          kind: "success",
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Publish update failed";
        showSnackbar(message, { seconds: 2, kind: "error" });
      });
    return;
  }

  if (
    key === "r" &&
    state.mode === "trackSelect" &&
    state.trackSelectIndex >= 0 &&
    state.trackSelectIndex < trackOptions.length
  ) {
    const preset = selectedTrackPreset();
    if (!selectedTrackCanRename() || !preset) return;
    openTrackNameModal({
      initialValue: preset.name || "",
      confirmLabel: "Save",
      onSubmit: async (rawName) => {
        const nextName = typeof rawName === "string" ? rawName.trim() : "";
        const updatedTrack = await renameTrack(preset.id, nextName);
        const updatedPreset = setTrackPresetMetadata(
          updatedTrack.id,
          {
            name: updatedTrack.name,
            ownerUserId: updatedTrack.owner_user_id || null,
            ownerDisplayName: updatedTrack.owner_display_name || null,
            bestLapMs: Number.isFinite(updatedTrack.best_lap_ms)
              ? Number(updatedTrack.best_lap_ms)
              : null,
            bestLapDisplayName: updatedTrack.best_lap_display_name || null,
            bestRaceMs: Number.isFinite(updatedTrack.best_race_ms)
              ? Number(updatedTrack.best_race_ms)
              : null,
            bestRaceDisplayName: updatedTrack.best_race_display_name || null,
            isPublished: Boolean(updatedTrack.is_published),
            shareToken: updatedTrack.share_token || null,
            fromDb: true,
          },
          {
            currentUserId: state.auth.userId,
            currentUserIsAdmin: state.auth.isAdmin,
          },
        );
        if (!updatedPreset) return;
        showSnackbar("Track renamed", { seconds: 1.8, kind: "success" });
      },
    });
    return;
  }

  if (
    key === "x" &&
    state.mode === "trackSelect" &&
    state.trackSelectIndex >= 0 &&
    state.trackSelectIndex < trackOptions.length
  ) {
    if (e.repeat) return;
    promptClearSelectedTrackRecords();
    return;
  }

  if (
    key === "e" &&
    state.mode === "trackSelect" &&
    state.trackSelectIndex >= 0 &&
    state.trackSelectIndex < trackOptions.length
  ) {
    enterEditor(state.trackSelectIndex);
    return;
  }
  if (state.mode === "trackSelect" && key === "n") {
    createEmptyTrackAndEdit();
    return;
  }
  if (
    (key === "delete" || key === "del" || key === "backspace") &&
    state.mode === "trackSelect" &&
    state.trackSelectIndex >= 0 &&
    state.trackSelectIndex < trackOptions.length
  ) {
    const preset = getTrackPreset(state.trackSelectIndex);
    if (!preset || !canDeleteTrackPreset(preset, state.auth.userId, state.auth.isAdmin)) {
      showSnackbar("Only unpublished tracks you own can be deleted, unless you are admin", {
        seconds: 1.8,
        kind: "error",
      });
      return;
    }
    openConfirmModal({
      title: "Delete Track",
      message: `Are you sure you want to cancel the ${preset.name}?`,
      confirmLabel: "Yes",
      cancelLabel: "No",
      danger: true,
      onConfirm: async () => {
        try {
          await deleteOwnTrackFromApi(preset.id);
          removeTrackPresetById(preset.id, { removePersisted: true });
          showSnackbar(`Track ${preset.name} deleted`, {
            seconds: 1.8,
            kind: "success",
          });
          if (trackOptions.length > 0) {
            state.trackSelectIndex = Math.max(
              0,
              Math.min(state.trackSelectIndex, trackOptions.length - 1),
            );
            state.selectedTrackIndex = state.trackSelectIndex;
            syncTrackSelectWindow();
          } else {
            state.trackSelectIndex = 0;
            state.selectedTrackIndex = 0;
            state.trackSelectViewOffset = 0;
          }
          clearTrackInUrl(preset.id);
          showSnackbar("Track deleted", { seconds: 1.8, kind: "success" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Delete failed";
          showSnackbar(message, { seconds: 2, kind: "error" });
        }
      },
    });
    return;
  }

  if (key === "a" && state.mode === "trackSelect" && state.gameMode === "single") {
    toggleAiOpponents();
    return;
  }

  if (state.mode === "editor") {
    if (key === "s") {
      if (e.repeat) return;
      promptSaveEditorTrack();
      return;
    }
    if (key === "c") {
      if (e.repeat) return;
      state.editor.showCurbs = !state.editor.showCurbs;
      return;
    }
    if (key === "t") {
      if (e.repeat) return;
      toggleEditorTool("tree");
      return;
    }
    if (key === "g") {
      if (e.repeat) return;
      toggleEditorTool("terrain");
      return;
    }
    if (key === "w") {
      if (e.repeat) return;
      toggleEditorTool("pond");
      return;
    }
    if (key === "o") {
      if (e.repeat) return;
      toggleEditorTool("oil");
      return;
    }
    if (key === "b") {
      if (e.repeat) return;
      toggleEditorTool("barrel");
      return;
    }
    if (key === "l") {
      if (e.repeat) return;
      toggleEditorTool("wall");
      return;
    }
    if (key === "r") {
      if (e.repeat) return;
      toggleEditorTool("ramp");
      return;
    }
    if (key === "j") {
      if (e.repeat) return;
      toggleEditorTool("bridgeDeck");
      return;
    }
    if (key === "h") {
      if (e.repeat) return;
      setEditorPanMode(!state.editor.panMode);
      return;
    }
    if (key === "enter") {
      startEditorRace();
      return;
    }
    if (key === " ") {
      rebuildEditorTrackGeometry();
      return;
    }
  }

  if (key === "arrowup") {
    if (state.mode === "menu") {
      const items = currentMenuItems();
      state.menuIndex = (state.menuIndex + items.length - 1) % items.length;
    }
    if (state.mode === "gameModeSelect") {
      const items = getGameModeItems();
      state.gameModeIndex = (state.gameModeIndex + items.length - 1) % items.length;
    }
    if (state.mode === "settings") {
      const items = currentSettingsItems();
      state.settingsIndex = (state.settingsIndex + items.length - 1) % items.length;
    }
    if (state.mode === "loginProviders") {
      const items = currentLoginProviderItems();
      state.loginProviderIndex = (state.loginProviderIndex + items.length - 1) % items.length;
    }
    if (state.mode === "trackSelect") {
      const backIndex = trackSelectBackIndex();
      const startIdx = trackSelectStartTournamentIndex();
      if (state.trackSelectIndex === backIndex || state.trackSelectIndex === startIdx) {
        // Jump from button row back to last track
        const lastTrack = trackOptions.length - 1;
        if (lastTrack >= 0) {
          state.trackSelectIndex = lastTrack;
          syncTrackSelectWindow();
        }
      } else if (state.trackSelectIndex > 0) {
        // Move up one row (previous index in same column)
        const row = state.trackSelectIndex % TRACK_GRID_ROWS;
        if (row > 0) {
          state.trackSelectIndex -= 1;
        }
      }
    }
    if (state.mode === "tournamentLobby") {
      const maxIndex = state.tournamentRoom.slots.length + (state.tournamentRoom.isHost ? 1 : 0);
      state.tournamentLobbyIndex = Math.max(0, state.tournamentLobbyIndex - 1);
      state.tournamentLobbyIndex = Math.min(state.tournamentLobbyIndex, maxIndex);
    }
    keys.up = true;
  }
  if (key === "arrowdown") {
    if (state.mode === "menu") {
      const items = currentMenuItems();
      state.menuIndex = (state.menuIndex + 1) % items.length;
    }
    if (state.mode === "gameModeSelect") {
      const items = getGameModeItems();
      state.gameModeIndex = (state.gameModeIndex + 1) % items.length;
    }
    if (state.mode === "settings") {
      const items = currentSettingsItems();
      state.settingsIndex = (state.settingsIndex + 1) % items.length;
    }
    if (state.mode === "loginProviders") {
      const items = currentLoginProviderItems();
      state.loginProviderIndex = (state.loginProviderIndex + 1) % items.length;
    }
    if (state.mode === "trackSelect") {
      if (state.trackSelectIndex >= 0 && state.trackSelectIndex < trackOptions.length) {
        const row = state.trackSelectIndex % TRACK_GRID_ROWS;
        const col = Math.floor(state.trackSelectIndex / TRACK_GRID_ROWS);
        if (row < TRACK_GRID_ROWS - 1 && col * TRACK_GRID_ROWS + row + 1 < trackOptions.length) {
          state.trackSelectIndex += 1;
        } else {
          // Bottom of grid — go to primary action button
          state.trackSelectIndex =
            state.gameMode === "tournament"
              ? trackSelectStartTournamentIndex()
              : trackSelectBackIndex();
        }
      }
    }
    if (state.mode === "tournamentLobby") {
      const maxIndex = state.tournamentRoom.slots.length + (state.tournamentRoom.isHost ? 1 : 0);
      state.tournamentLobbyIndex = Math.min(maxIndex, state.tournamentLobbyIndex + 1);
    }
    keys.down = true;
  }
  if (
    key === "arrowleft" &&
    state.mode === "trackSelect" &&
    state.trackSelectIndex < trackSelectCardCount()
  ) {
    // Move left one column (subtract TRACK_GRID_ROWS)
    const newIdx = state.trackSelectIndex - TRACK_GRID_ROWS;
    if (newIdx >= 0) {
      state.trackSelectIndex = newIdx;
      syncTrackSelectWindow();
    }
  }
  if (key === "arrowleft" && state.mode === "tournamentLobby") {
    const shareIndex = state.tournamentRoom.slots.length;
    const startIndex = shareIndex + 1;
    if (state.tournamentRoom.isHost && state.tournamentLobbyIndex >= shareIndex) {
      state.tournamentLobbyIndex =
        state.tournamentLobbyIndex === startIndex ? shareIndex : startIndex;
    }
  }
  if (
    key === "arrowright" &&
    state.mode === "trackSelect" &&
    state.trackSelectIndex < trackSelectCardCount()
  ) {
    // Move right one column (add TRACK_GRID_ROWS)
    const newIdx = state.trackSelectIndex + TRACK_GRID_ROWS;
    if (newIdx < trackOptions.length) {
      state.trackSelectIndex = newIdx;
      syncTrackSelectWindow();
    }
  }
  if (key === "arrowright" && state.mode === "tournamentLobby") {
    const shareIndex = state.tournamentRoom.slots.length;
    const startIndex = shareIndex + 1;
    if (state.tournamentRoom.isHost && state.tournamentLobbyIndex >= shareIndex) {
      state.tournamentLobbyIndex =
        state.tournamentLobbyIndex === startIndex ? shareIndex : startIndex;
    }
  }
  if (
    key === "arrowleft" &&
    state.mode === "trackSelect" &&
    state.trackSelectIndex >= trackSelectCardCount()
  ) {
    // On button row: toggle between back and start tournament
    if (state.gameMode === "tournament") {
      if (state.trackSelectIndex === trackSelectBackIndex()) {
        state.trackSelectIndex = trackSelectStartTournamentIndex();
      } else {
        state.trackSelectIndex = trackSelectBackIndex();
      }
    }
  }
  if (
    key === "arrowright" &&
    state.mode === "trackSelect" &&
    state.trackSelectIndex >= trackSelectCardCount()
  ) {
    if (state.gameMode === "tournament") {
      if (state.trackSelectIndex === trackSelectBackIndex()) {
        state.trackSelectIndex = trackSelectStartTournamentIndex();
      } else {
        state.trackSelectIndex = trackSelectBackIndex();
      }
    }
  }
  if ((key === "arrowleft" || key === "arrowright") && state.mode === "settings") {
    const selected = currentSettingsItems()[state.settingsIndex];
    if (selected === "PLAYER COLOR") {
      stepPlayerColor(key === "arrowleft" ? -1 : 1);
    } else if (selected === "AI OPPONENTS") {
      stepAiOpponentCount(key === "arrowleft" ? -1 : 1);
    } else if (selected === "SIDEWAYS DRIFT") {
      toggleSidewaysDrift();
    } else if (selected === "DEBUG MODE") {
      toggleDebugMode();
    }
  }
  if (key === "enter") activateSelection();

  if (state.mode === "racing") {
    if (key === "w" || key === "arrowup") keys.accel = true;
    if (key === "s" || key === "arrowdown") keys.brake = true;
    if (key === "a" || key === "arrowleft") keys.left = true;
    if (key === "d" || key === "arrowright") keys.right = true;
    if (key === " ") keys.handbrake = true;
  }
}

function onKeyUp(e) {
  const key = e.key.toLowerCase();
  if (key === "w" || key === "arrowup") {
    keys.accel = false;
    keys.up = false;
  }
  if (key === "s" || key === "arrowdown") {
    keys.brake = false;
    keys.down = false;
  }
  if (key === "a" || key === "arrowleft") keys.left = false;
  if (key === "d" || key === "arrowright") keys.right = false;
  if (key === " ") keys.handbrake = false;
}

export function initInputHandlers() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener(
    "keydown",
    () => {
      void unlockMenuMusic();
    },
    { once: true },
  );
  window.addEventListener(
    "pointerdown",
    () => {
      void unlockMenuMusic();
    },
    { once: true },
  );
  window.addEventListener(
    "touchstart",
    () => {
      void unlockMenuMusic();
    },
    { once: true },
  );
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", (event) => {
    updateEditorCursorFromEvent(event);
    if (state.mode === "editor" && state.editor.toolbar.dragging) {
      state.editor.toolbar.x = state.editor.cursorScreenX - state.editor.toolbar.dragOffsetX;
      state.editor.toolbar.y = state.editor.cursorScreenY - state.editor.toolbar.dragOffsetY;
      clampEditorToolbarPosition();
      saveEditorToolbarPosition();
      return;
    }
    if (state.mode === "editor" && state.editor.viewDragging) {
      const dx = state.editor.cursorScreenX - state.editor.viewDragLastScreenX;
      const dy = state.editor.cursorScreenY - state.editor.viewDragLastScreenY;
      panEditorViewBy(dx, dy);
      state.editor.viewDragLastScreenX = state.editor.cursorScreenX;
      state.editor.viewDragLastScreenY = state.editor.cursorScreenY;
      updateEditorCursorFromScreen(
        state.editor.cursorScreenX,
        state.editor.cursorScreenY,
        state.editor.cursorCanvasY,
      );
      return;
    }
    if (state.mode === "editor" && updateEditorCanvasInteraction()) {
      return;
    }
    if (state.mode === "editor") {
      const toolbarHit = editorToolbarActionAt(
        state.editor.cursorScreenX,
        state.editor.cursorScreenY,
      );
      state.editor.toolbar.hoverLabel =
        toolbarHit?.type === "action" ? editorToolbarActionLabel(toolbarHit.id) : "";
    } else {
      state.editor.toolbar.hoverLabel = "";
    }
  });
  window.addEventListener("contextmenu", (event) => {
    if (state.mode === "editor" && state.editor.activeTool === "terrain") event.preventDefault();
  });
  window.addEventListener("mousedown", (event) => {
    void unlockMenuMusic();
    if (state.mode === "tournamentLobby" && event.button === 0) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;
      const action = tournamentLobbyActionAt(x, y);
      if (action === "share") {
        void copyTournamentRoomUrl();
        return;
      }
      if (action === "start" && canStartHostedRoomRace()) {
        startHostedRoomRace();
        return;
      }
    }
    if (
      state.mode !== "editor" ||
      (event.button !== 0 && !(state.editor.activeTool === "terrain" && event.button === 2))
    ) {
      return;
    }
    updateEditorCursorFromEvent(event);
    if (state.editor.activeTool === "terrain" && event.button === 2) event.preventDefault();
    const toolbarHit = editorToolbarActionAt(
      state.editor.cursorScreenX,
      state.editor.cursorScreenY,
    );
    if (!toolbarHit && state.editor.assetPaletteOpen) {
      state.editor.assetPaletteOpen = false;
    }
    if (toolbarHit?.type === "drag") {
      state.editor.toolbar.dragging = true;
      state.editor.toolbar.dragOffsetX = state.editor.cursorScreenX - state.editor.toolbar.x;
      state.editor.toolbar.dragOffsetY = state.editor.cursorScreenY - state.editor.toolbar.y;
      return;
    }
    if (toolbarHit?.type === "action") {
      performEditorToolbarAction(toolbarHit.id);
      return;
    }
    if (toolbarHit?.type === "panel") return;
    const topBarAction = editorTopBarActionAt(
      state.editor.cursorScreenX,
      state.editor.cursorCanvasY,
    );
    if (topBarAction) {
      performEditorTopBarAction(topBarAction);
      return;
    }
    beginEditorCanvasInteraction(event.button);
  });
  window.addEventListener("mouseup", (event) => {
    if (
      state.mode !== "editor" ||
      (event.button !== 0 && !(state.editor.activeTool === "terrain" && event.button === 2))
    ) {
      return;
    }
    if (state.editor.toolbar.dragging) {
      state.editor.toolbar.dragging = false;
      clampEditorToolbarPosition();
      saveEditorToolbarPosition();
      return;
    }
    if (state.editor.viewDragging) {
      state.editor.viewDragging = false;
      return;
    }
    endEditorCanvasInteraction();
  });
}

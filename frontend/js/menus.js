import {
  applyTrackPreset,
  canDeleteTrackPreset,
  canvas,
  CENTERLINE_SMOOTHING_MODES,
  DEFAULT_CENTERLINE_SMOOTHING_MODE,
  deleteOwnTrackFromApi,
  getMenuItems,
  getLoginProviderItems,
  getTrackPreset,
  getSettingsItems,
  importTrackPresetData,
  removeTrackPresetById,
  regenerateTrackFromCenterlineStrokes,
  saveTrackPresetToDb,
  saveMenuMusicEnabled,
  setTrackPresetMetadata,
  physicsConfig,
  sanitizePlayerName,
  saveDebugMode,
  saveTrackPreset,
  savePlayerName,
  trackOptions,
  track,
  normalizeCenterlineSmoothingMode,
} from "./parameters.js";
import { keys, setCurbSegments, state } from "./state.js";
import { clearRaceInputs, resetRace } from "./physics.js";
import { showSnackbar } from "./snackbar.js";
import { initCurbSegments } from "./track.js";
import {
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

const EDITOR_TOP_BAR_HEIGHT = 56;
const TRACK_SELECT_VISIBLE_CARDS = 4;
const EDITOR_OBJECT_PLACE_TOOLS = [
  { id: "water", label: "Water", icon: "≈", shortcut: "W" },
  { id: "barrel", label: "Barrel", icon: "◉", shortcut: "B" },
  { id: "tree", label: "Tree", icon: "♣", shortcut: "T" },
  { id: "spring", label: "Spring", icon: "✹", shortcut: "" },
  { id: "wall", label: "Wall", icon: "▭", shortcut: "L" },
];
const EDITOR_TOOLBAR_WIDTH = 320;
const EDITOR_TOOLBAR_TITLE_HEIGHT = 32;
const EDITOR_TOOLBAR_ROW_HEIGHT = 32;
const EDITOR_TOOLBAR_SECTION_HEIGHT = 38;
const EDITOR_TOOLBAR_SECTION_LABEL_HEIGHT = 22;
const EDITOR_DEFAULT_HALF_WIDTH = 60;
const EDITOR_ZOOM_STEP = 0.1;
const EDITOR_MIN_WORLD_SCALE = 0.5;
const EDITOR_MAX_WORLD_SCALE = 1.75;
const EDITOR_TOOLBAR_POSITION_STORAGE_KEY = "carun.editorToolbarPosition";

function clampWorldScale(value) {
  return Math.max(
    EDITOR_MIN_WORLD_SCALE,
    Math.min(EDITOR_MAX_WORLD_SCALE, value),
  );
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
  toolbar.x = Math.max(
    10,
    Math.min(toolbar.x, canvas.width - layout.panel.width - 10),
  );
  toolbar.y = Math.max(
    10,
    Math.min(
      toolbar.y,
      canvas.height - EDITOR_TOP_BAR_HEIGHT - layout.panel.height - 10,
    ),
  );
}

function pointInRect(x, y, rect) {
  return (
    rect &&
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

function getDefaultStrokeHalfWidth(preset) {
  const latestStroke =
    preset?.centerlineStrokes?.[preset.centerlineStrokes.length - 1];
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
    if (
      entry.kind === "stroke" &&
      preset.centerlineStrokes[entry.strokeIndex]
    ) {
      state.editor.latestEditTarget = {
        kind: "stroke",
        strokeIndex: entry.strokeIndex,
      };
      return;
    }
  }
  state.editor.latestEditTarget = null;
}

function setEditorTool(nextTool) {
  state.editor.activeTool = nextTool;
}

function toggleEditorTool(nextTool) {
  setEditorTool(state.editor.activeTool === nextTool ? "road" : nextTool);
}

function triggerEditorSelectionFlash(kind, index) {
  state.editor.selectionFlash.kind = kind;
  state.editor.selectionFlash.index = Number.isInteger(index) ? index : -1;
  state.editor.selectionFlash.time = 0.48;
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

export function getEditorToolbarLayout() {
  const toolbar = state.editor.toolbar;
  const panelHeight =
    EDITOR_TOOLBAR_TITLE_HEIGHT +
    EDITOR_TOOLBAR_SECTION_LABEL_HEIGHT +
    EDITOR_TOOLBAR_ROW_HEIGHT * 3 +
    EDITOR_TOOLBAR_SECTION_HEIGHT * 2 +
    14 +
    EDITOR_TOOLBAR_SECTION_LABEL_HEIGHT +
    EDITOR_TOOLBAR_SECTION_HEIGHT * 3 +
    14 +
    EDITOR_TOOLBAR_SECTION_HEIGHT +
    20;
  const panel = {
    x: toolbar.x,
    y: toolbar.y,
    width: toolbar.width || EDITOR_TOOLBAR_WIDTH,
    height: panelHeight,
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
  const objectToolButtonWidth =
    (panel.width - 24 - objectToolButtonGap * 2) / 3;
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
  const objectSelectTop = objectToolRowY + EDITOR_TOOLBAR_ROW_HEIGHT * 2 + 8;
  const objectActionTop = objectSelectTop + EDITOR_TOOLBAR_SECTION_HEIGHT;
  const actionY = objectActionTop + 2;
  const iconButtonWidth = 34;
  const iconGap = 8;
  const stepperWidth = 94;
  const roadHeaderTop = objectActionTop + EDITOR_TOOLBAR_SECTION_HEIGHT + 14;
  const roadSelectTop = roadHeaderTop + EDITOR_TOOLBAR_SECTION_LABEL_HEIGHT + 4;
  const roadActionTop = roadSelectTop + EDITOR_TOOLBAR_SECTION_HEIGHT;
  const roadActionY = roadActionTop + 2;
  const roadStepperWidth = 138;
  const roadSmoothTop = roadActionTop + EDITOR_TOOLBAR_SECTION_HEIGHT;
  const zoomTop = roadSmoothTop + EDITOR_TOOLBAR_SECTION_HEIGHT + 14;
  return {
    panel,
    titleBar,
    objectHeader,
    objectToolButtons,
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
      x: panel.x + panel.width - 42,
      y: roadSelectTop + 2,
      width: 30,
      height: 24,
    },
    roadValue: {
      x: panel.x + 52,
      y: roadSelectTop,
      width: panel.width - 104,
      height: 28,
    },
    roadDeleteButton: {
      x: panel.x + 12,
      y: roadActionY,
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
    zoomLabel: { x: panel.x + 14, y: zoomTop, width: 60, height: 28 },
    zoomOut: { x: panel.x + 102, y: zoomTop + 2, width: 40, height: 24 },
    zoomIn: { x: panel.x + 154, y: zoomTop + 2, width: 40, height: 24 },
    zoomValue: { x: panel.x + 196, y: zoomTop, width: 42, height: 28 },
  };
}

function editorToolbarActionAt(x, y) {
  const layout = getEditorToolbarLayout();
  if (!pointInRect(x, y, layout.panel)) return null;
  if (pointInRect(x, y, layout.titleBar)) return { type: "drag" };
  for (const row of layout.objectToolButtons) {
    if (pointInRect(x, y, row)) return { type: "action", id: row.id };
  }
  if (pointInRect(x, y, layout.objectDeleteButton))
    return { type: "action", id: layout.objectDeleteButton.id };
  if (pointInRect(x, y, layout.objectSizeDown))
    return { type: "action", id: layout.objectSizeDown.id };
  if (pointInRect(x, y, layout.objectSizeUp))
    return { type: "action", id: layout.objectSizeUp.id };
  if (pointInRect(x, y, layout.rotateLeftButton))
    return { type: "action", id: layout.rotateLeftButton.id };
  if (pointInRect(x, y, layout.rotateRightButton))
    return { type: "action", id: layout.rotateRightButton.id };
  if (pointInRect(x, y, layout.objectPrev))
    return { type: "action", id: "objectPrev" };
  if (pointInRect(x, y, layout.objectNext))
    return { type: "action", id: "objectNext" };
  if (pointInRect(x, y, layout.roadPrev))
    return { type: "action", id: "roadPrev" };
  if (pointInRect(x, y, layout.roadNext))
    return { type: "action", id: "roadNext" };
  if (pointInRect(x, y, layout.roadDeleteButton))
    return { type: "action", id: layout.roadDeleteButton.id };
  if (pointInRect(x, y, layout.roadSizeDown))
    return { type: "action", id: layout.roadSizeDown.id };
  if (pointInRect(x, y, layout.roadSizeUp))
    return { type: "action", id: layout.roadSizeUp.id };
  if (pointInRect(x, y, layout.roadSmoothPrev))
    return { type: "action", id: "roadSmoothPrev" };
  if (pointInRect(x, y, layout.roadSmoothNext))
    return { type: "action", id: "roadSmoothNext" };
  if (pointInRect(x, y, layout.zoomOut))
    return { type: "action", id: "zoomOut" };
  if (pointInRect(x, y, layout.zoomIn)) return { type: "action", id: "zoomIn" };
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
  switch (actionId) {
    case "objectDelete":
      return "Delete";
    case "water":
      return "Water";
    case "barrel":
      return "Barrel";
    case "tree":
      return "Tree";
    case "spring":
      return "Spring";
    case "wall":
      return "Wall";
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
    case "roadDelete":
      return "Delete Segment";
    case "roadSizeDown":
      return "Width -";
    case "roadSizeUp":
      return "Width +";
    case "roadSmoothPrev":
      return "Smoothing -";
    case "roadSmoothNext":
      return "Smoothing +";
    case "zoomOut":
      return "Zoom Out";
    case "zoomIn":
      return "Zoom In";
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
  const selectedMenuIndex = Math.max(
    0,
    Math.min(state.menuIndex, menuItems.length - 1),
  );
  let maxMenuLabelWidth = 0;
  for (const item of menuItems) {
    maxMenuLabelWidth = Math.max(maxMenuLabelWidth, measureTextWidth(item));
  }
  const highlightWidth = Math.max(460, maxMenuLabelWidth + 96);
  return { menuItems, selectedMenuIndex, highlightWidth };
}

export function getLoginProviderRenderModel(measureTextWidth) {
  const loginItems = currentLoginProviderItems();
  const selectedLoginIndex = Math.max(
    0,
    Math.min(state.loginProviderIndex, loginItems.length - 1),
  );
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
  const rowGap = 66;
  const startY = 338;

  const rowLabels = settingsItems.map((item) => {
    if (item === "PLAYER NAME") {
      const suffix = state.editingName ? "_" : "";
      return `${item}: ${state.playerName}${suffix}`;
    }
    if (item === "MENU MUSIC") {
      return `${item}: ${isMenuMusicEnabled() ? "ON" : "OFF"}`;
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
  const highlightWidth = Math.max(560, maxWidth + 92);

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

function trackSelectVisibleCount() {
  return Math.min(TRACK_SELECT_VISIBLE_CARDS, Math.max(1, trackOptions.length));
}

function syncTrackSelectWindow() {
  const cardCount = trackSelectCardCount();
  const visibleCount = trackSelectVisibleCount();
  const maxOffset = Math.max(0, cardCount - visibleCount);
  if (state.trackSelectIndex >= cardCount) {
    state.trackSelectViewOffset = Math.max(
      0,
      Math.min(state.trackSelectViewOffset, maxOffset),
    );
    return;
  }

  let nextOffset = Math.max(
    0,
    Math.min(state.trackSelectViewOffset, maxOffset),
  );
  if (state.trackSelectIndex < nextOffset) nextOffset = state.trackSelectIndex;
  if (state.trackSelectIndex >= nextOffset + visibleCount)
    nextOffset = state.trackSelectIndex - visibleCount + 1;
  state.trackSelectViewOffset = Math.max(0, Math.min(nextOffset, maxOffset));
}

function selectedTrackPreset() {
  if (
    state.trackSelectIndex < 0 ||
    state.trackSelectIndex >= trackOptions.length
  )
    return null;
  return getTrackPreset(state.trackSelectIndex);
}

function selectedTrackCanDelete() {
  return canDeleteTrackPreset(selectedTrackPreset(), state.auth.userId);
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

export function getTrackSelectRenderModel() {
  const visibleCount = trackSelectVisibleCount();
  const totalCount = trackOptions.length;
  const maxOffset = Math.max(0, totalCount - visibleCount);
  const viewOffset = Math.max(
    0,
    Math.min(state.trackSelectViewOffset, maxOffset),
  );
  const visibleTracks = trackOptions.slice(
    viewOffset,
    viewOffset + visibleCount,
  );
  const selectedTrack = selectedTrackPreset();

  return {
    visibleTracks,
    viewOffset,
    visibleCount,
    totalCount,
    showLeftHint: viewOffset > 0,
    showRightHint: viewOffset + visibleCount < totalCount,
    selectedTrackCanDelete: selectedTrackCanDelete(),
    selectedTrackCanPublish: selectedTrackCanPublish(),
    selectedTrackCanRename: selectedTrackCanRename(),
    selectedTrackIsPublished: Boolean(selectedTrack?.isPublished),
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
  window.history.replaceState(
    {},
    "",
    `${url.pathname}${url.search ? url.search : ""}${url.hash}`,
  );
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

function setTrackInUrl(trackId) {
  const cleanTrackId = typeof trackId === "string" ? trackId.trim() : "";
  if (!cleanTrackId) return;
  replaceAppUrl({ pathname: `/tracks/${encodeURIComponent(cleanTrackId)}` });
}

function clearTrackInUrl(trackId) {
  const currentPath =
    typeof window !== "undefined" ? window.location.pathname : "";
  const expectedPath = `/tracks/${encodeURIComponent(trackId)}`;
  if (currentPath !== expectedPath) return;
  replaceAppUrl({ pathname: "/tracks" });
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
  state.modal.inputValue =
    typeof initialValue === "string" ? initialValue.slice(0, maxLength) : "";
  state.modal.inputPlaceholder =
    typeof placeholder === "string" ? placeholder : "";
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

function setRaceReturnTarget(mode, editorTrackIndex = null) {
  state.raceReturn.mode = mode;
  state.raceReturn.editorTrackIndex =
    mode === "editor" && Number.isInteger(editorTrackIndex)
      ? editorTrackIndex
      : null;
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
  const worldScale = clampWorldScale(Number(track.worldScale) || 1);
  state.editor.cursorScreenX = screenX;
  state.editor.cursorCanvasY = canvasY;
  state.editor.cursorScreenY = screenY;
  state.editor.cursorX = track.cx + (screenX - track.cx) / worldScale;
  state.editor.cursorY = track.cy + (screenY - track.cy) / worldScale;
}

function rebuildEditorTrackGeometry() {
  const generated = regenerateTrackFromCenterlineStrokes(
    state.editor.trackIndex,
  );
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
  }
}

function cycleSelectionIndex(count, currentIndex, direction) {
  if (!count) return null;
  if (
    !Number.isInteger(currentIndex) ||
    currentIndex < 0 ||
    currentIndex >= count
  )
    return count - 1;
  return (currentIndex + direction + count) % count;
}

function selectEditorObject(direction) {
  const preset = getTrackPreset(state.editor.trackIndex);
  const count = preset.worldObjects?.length || 0;
  if (!count) {
    if (state.editor.latestEditTarget?.kind === "object")
      state.editor.latestEditTarget = null;
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
    if (state.editor.latestEditTarget?.kind === "stroke")
      state.editor.latestEditTarget = null;
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
  if (
    target?.kind === "stroke" &&
    preset.centerlineStrokes?.[target.strokeIndex]
  ) {
    return target;
  }
  if (preset.centerlineStrokes?.length) {
    return { kind: "stroke", strokeIndex: preset.centerlineStrokes.length - 1 };
  }
  return null;
}

function reindexEditorStack(preset, kind, removedIndex) {
  if (!Array.isArray(preset.editStack)) return;
  const key = kind === "object" ? "objectIndex" : "strokeIndex";
  preset.editStack = preset.editStack.flatMap((entry) => {
    if (entry.kind !== kind) return [entry];
    if (entry[key] === removedIndex) return [];
    if (entry[key] > removedIndex) return [{ ...entry, [key]: entry[key] - 1 }];
    return [entry];
  });
}

function shiftEditorStackForInsert(preset, kind, insertedIndex) {
  if (!Array.isArray(preset.editStack)) return;
  const key = kind === "object" ? "objectIndex" : "strokeIndex";
  preset.editStack = preset.editStack.map((entry) => {
    if (entry.kind !== kind) return entry;
    if (entry[key] >= insertedIndex) return { ...entry, [key]: entry[key] + 1 };
    return entry;
  });
}

function deleteSelectedEditorTarget(kind) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  const target =
    kind === "object"
      ? objectSelectionTarget(preset)
      : roadSelectionTarget(preset);
  if (!target) return;
  if (target.kind === "object") {
    if (!preset.worldObjects?.[target.objectIndex]) return;
    preset.worldObjects.splice(target.objectIndex, 1);
    reindexEditorStack(preset, "object", target.objectIndex);
    if (preset.worldObjects.length) {
      state.editor.latestEditTarget = {
        kind: "object",
        objectIndex: Math.min(
          target.objectIndex,
          preset.worldObjects.length - 1,
        ),
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
      strokeIndex: Math.min(
        target.strokeIndex,
        preset.centerlineStrokes.length - 1,
      ),
    };
  } else {
    syncLatestEditorTarget(preset);
  }
  rebuildEditorTrackGeometry();
}

function adjustSelectedObjectSize(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  const target = objectSelectionTarget(preset);
  if (!target) return;
  const object = preset.worldObjects[target.objectIndex];
  if (!object) return;
  if (object.type === "pond") {
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
  if (object.type === "wall") {
    object.length = Math.max(32, Math.min(160, object.length + direction * 8));
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
      (Number.isFinite(point.halfWidth)
        ? point.halfWidth
        : getDefaultStrokeHalfWidth(preset)) +
      direction * 4;
    point.halfWidth = Math.max(24, Math.min(120, nextWidth));
  }
  state.editor.latestEditTarget = target;
  rebuildEditorTrackGeometry();
}

function rotateSelectedEditorObject(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  const target = objectSelectionTarget(preset);
  if (!target) return;
  const object = preset.worldObjects[target.objectIndex];
  if (!object) return;
  object.angle =
    ((object.angle || 0) + direction * (Math.PI / 12)) % (Math.PI * 2);
  state.editor.latestEditTarget = target;
  applyTrackPreset(state.editor.trackIndex);
}

function adjustEditorZoom(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (!preset?.track) return;
  const current = clampWorldScale(Number(preset.track.worldScale) || 1);
  const next = clampWorldScale(
    Number((current + direction * EDITOR_ZOOM_STEP).toFixed(2)),
  );
  if (next === current) return;
  preset.track.worldScale = next;
  applyTrackPreset(state.editor.trackIndex);
}

function adjustEditorSmoothing(direction) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (!preset?.track) return;
  const current = normalizeCenterlineSmoothingMode(
    preset.track.centerlineSmoothingMode,
  );
  const index = CENTERLINE_SMOOTHING_MODES.indexOf(current);
  const nextIndex = Math.max(
    0,
    Math.min(CENTERLINE_SMOOTHING_MODES.length - 1, index + direction),
  );
  if (nextIndex === index) return;
  preset.track.centerlineSmoothingMode = CENTERLINE_SMOOTHING_MODES[nextIndex];
  if (!rebuildEditorTrackGeometry()) {
    applyTrackPreset(state.editor.trackIndex);
  }
}

function performEditorToolbarAction(actionId) {
  if (actionId === "objectDelete") deleteSelectedEditorTarget("object");
  if (actionId === "water") toggleEditorTool("pond");
  if (actionId === "barrel") toggleEditorTool("barrel");
  if (actionId === "tree") toggleEditorTool("tree");
  if (actionId === "spring") toggleEditorTool("spring");
  if (actionId === "wall") toggleEditorTool("wall");
  if (actionId === "objectPrev") selectEditorObject(-1);
  if (actionId === "objectNext") selectEditorObject(1);
  if (actionId === "objectSizeDown") adjustSelectedObjectSize(-1);
  if (actionId === "objectSizeUp") adjustSelectedObjectSize(1);
  if (actionId === "rotateLeft") rotateSelectedEditorObject(-1);
  if (actionId === "rotateRight") rotateSelectedEditorObject(1);
  if (actionId === "save") promptSaveEditorTrack();
  if (actionId === "toggleCurbs")
    state.editor.showCurbs = !state.editor.showCurbs;
  if (actionId === "back") returnToTrackSelect();
  if (actionId === "roadPrev") selectEditorRoad(-1);
  if (actionId === "roadNext") selectEditorRoad(1);
  if (actionId === "roadDelete") deleteSelectedEditorTarget("stroke");
  if (actionId === "roadSizeDown") adjustSelectedRoadWidth(-1);
  if (actionId === "roadSizeUp") adjustSelectedRoadWidth(1);
  if (actionId === "roadSmoothPrev") adjustEditorSmoothing(-1);
  if (actionId === "roadSmoothNext") adjustEditorSmoothing(1);
  if (actionId === "zoomOut") adjustEditorZoom(-1);
  if (actionId === "zoomIn") adjustEditorZoom(1);
}

function performEditorTopBarAction(actionId) {
  if (actionId === "save") promptSaveEditorTrack();
  if (actionId === "toggleCurbs")
    state.editor.showCurbs = !state.editor.showCurbs;
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

async function saveEditorTrack(requestedName) {
  const trackIndex = state.editor.trackIndex;
  const previousPreset = getTrackPreset(trackIndex);
  const previousId = previousPreset.id;
  const shouldReplacePrevious =
    !previousPreset.fromDb && previousPreset.source !== "system";
  saveTrackPreset(trackIndex);
  try {
    const imported = await saveTrackPresetToDb(trackIndex, {
      currentUserId: state.auth.userId,
      name: requestedName,
    });
    if (!imported) {
      showSnackbar("Save failed", { seconds: 2, kind: "error" });
      return;
    }
    if (shouldReplacePrevious && previousId !== imported.id) {
      removeTrackPresetById(previousId, { removePersisted: true });
    }
    const importedIndex = trackOptions.findIndex(
      (opt) => opt.id === imported.id,
    );
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

function openTrackNameModal({
  initialValue = "",
  confirmLabel = "Save",
  onSubmit,
}) {
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

function toggleDebugMode() {
  physicsConfig.flags.DEBUG_MODE = !physicsConfig.flags.DEBUG_MODE;
  saveDebugMode(physicsConfig.flags.DEBUG_MODE);
}

function toggleMenuMusic() {
  const nextValue = !isMenuMusicEnabled();
  saveMenuMusicEnabled(nextValue);
  setMenuMusicEnabled(nextValue);
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
  state.mode = "editor";
  syncMenuMusicForMode(state.mode);
  state.editor.trackIndex = trackIndex;
  state.editor.activeTool = "road";
  state.editor.drawing = false;
  state.editor.activeStroke = [];
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

function activateSelection() {
  state.menuIndex = Math.max(
    0,
    Math.min(state.menuIndex, currentMenuItems().length - 1),
  );
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
      return;
    }
    if (selectedItem === "SETTINGS") {
      state.mode = "settings";
      syncMenuMusicForMode(state.mode);
      state.settingsIndex = 0;
      state.editingName = false;
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
    if (state.trackSelectIndex === backIndex) {
      state.mode = "menu";
      setMainMenuUrl();
      syncMenuMusicForMode(state.mode);
      state.menuIndex = raceMenuIndex();
    } else {
      state.selectedTrackIndex = state.trackSelectIndex;
      applyTrackPreset(state.selectedTrackIndex);
      setCurbSegments(initCurbSegments());
      setRaceReturnTarget("trackSelect");
      state.mode = "racing";
      syncMenuMusicForMode(state.mode);
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
    if (selectedSetting === "MENU MUSIC") {
      toggleMenuMusic();
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
          syncMenuMusicForMode(state.mode);
          state.menuIndex = 0;
          state.settingsIndex = 0;
          state.editingName = false;
          state.paused = false;
          showSnackbar("Logged out", { seconds: 1.8, kind: "info" });
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "Logout failed";
          showSnackbar(message, { seconds: 2, kind: "error" });
        });
      return;
    }
    if (selectedSetting === "BACK") {
      state.mode = "menu";
      syncMenuMusicForMode(state.mode);
      state.menuIndex = settingsMenuIndex();
      state.paused = false;
      return;
    }
    return;
  }

  if (state.mode === "racing" && state.finished) {
    if (state.raceReturn.mode === "editor") {
      returnFromRace();
    } else {
      state.mode = "menu";
      syncMenuMusicForMode(state.mode);
      state.paused = false;
      state.pauseMenuIndex = 0;
    }
  }
}

function onKeyDown(e) {
  const key = e.key.toLowerCase();
  const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

  if (
    ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key) ||
    (key === "backspace" &&
      (state.mode === "trackSelect" ||
        state.mode === "editor" ||
        state.modal.open))
  ) {
    e.preventDefault();
  }

  if (
    state.mode === "editor" &&
    key === "s" &&
    (e.metaKey || e.ctrlKey) &&
    !e.altKey
  ) {
    e.preventDefault();
    if (!e.repeat) promptSaveEditorTrack();
    return;
  }

  if (state.modal.open) {
    if (state.modal.mode === "input") {
      if (
        ["arrowleft", "arrowright", "arrowup", "arrowdown", "tab"].includes(key)
      ) {
        state.modal.selectedAction =
          state.modal.selectedAction === "cancel" ? "confirm" : "cancel";
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
            const message =
              error instanceof Error ? error.message : "Action failed";
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

    if (
      ["arrowleft", "arrowright", "arrowup", "arrowdown", "tab"].includes(key)
    ) {
      state.modal.selectedAction =
        state.modal.selectedAction === "cancel" ? "confirm" : "cancel";
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
              const nextName = sanitizePlayerName(
                payload.display_name || state.playerName,
              );
              state.playerName = nextName;
              state.auth.displayName = nextName;
              showSnackbar("Display name updated", {
                seconds: 1.8,
                kind: "success",
              });
            })
            .catch((error) => {
              const message =
                error instanceof Error ? error.message : "Update failed";
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
      else {
        state.mode = "menu";
        syncMenuMusicForMode(state.mode);
        state.paused = false;
        state.pauseMenuIndex = 0;
      }
      clearRaceInputs();
      return;
    }

    if (!state.paused && !e.repeat) {
      if (key === "c") {
        emitFinishConfetti({ bestLap: true, bestRace: true });
      }
    }

    if (key === "p" || key === "escape") {
      if (!state.paused) {
        state.paused = true;
        state.pauseMenuIndex = 0;
      } else if (key === "p") {
        state.paused = false;
      }
      clearRaceInputs();
      return;
    }

    if (state.paused) {
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
    state.mode = "menu";
    setMainMenuUrl();
    syncMenuMusicForMode(state.mode);
    state.menuIndex = raceMenuIndex();
    return;
  }
  if (state.mode === "settings" && key === "escape") {
    state.mode = "menu";
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
    state.editor.drawing = false;
    state.editor.activeStroke = [];
    returnToTrackSelect();
    return;
  }
  if (state.mode === "editor" && key === "backspace") {
    if (e.repeat) return;
    if (state.editor.latestEditTarget?.kind === "stroke")
      deleteSelectedEditorTarget("stroke");
    else deleteSelectedEditorTarget("object");
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
          { currentUserId: state.auth.userId },
        );
        if (!updatedPreset) return;
        showSnackbar(
          updatedPreset.isPublished ? "Track published" : "Track unpublished",
          { seconds: 1.8, kind: "success" },
        );
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "Publish update failed";
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
          { currentUserId: state.auth.userId },
        );
        if (!updatedPreset) return;
        showSnackbar("Track renamed", { seconds: 1.8, kind: "success" });
      },
    });
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
    if (!preset || !canDeleteTrackPreset(preset, state.auth.userId)) {
      showSnackbar("Only your unpublished tracks can be deleted", {
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
          const message =
            error instanceof Error ? error.message : "Delete failed";
          showSnackbar(message, { seconds: 2, kind: "error" });
        }
      },
    });
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
    if (key === "w") {
      if (e.repeat) return;
      toggleEditorTool("pond");
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
    if (state.mode === "settings") {
      const items = currentSettingsItems();
      state.settingsIndex =
        (state.settingsIndex + items.length - 1) % items.length;
    }
    if (state.mode === "loginProviders") {
      const items = currentLoginProviderItems();
      state.loginProviderIndex =
        (state.loginProviderIndex + items.length - 1) % items.length;
    }
    if (state.mode === "trackSelect") {
      if (state.trackSelectIndex === trackSelectBackIndex()) {
        state.trackSelectIndex = state.selectedTrackIndex;
        syncTrackSelectWindow();
      }
    }
    keys.up = true;
  }
  if (key === "arrowdown") {
    if (state.mode === "menu") {
      const items = currentMenuItems();
      state.menuIndex = (state.menuIndex + 1) % items.length;
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
      state.trackSelectIndex = trackSelectBackIndex();
    }
    keys.down = true;
  }
  if (
    key === "arrowleft" &&
    state.mode === "trackSelect" &&
    state.trackSelectIndex < trackSelectCardCount()
  ) {
    state.trackSelectIndex =
      (state.trackSelectIndex + trackSelectCardCount() - 1) %
      trackSelectCardCount();
    syncTrackSelectWindow();
  }
  if (
    key === "arrowright" &&
    state.mode === "trackSelect" &&
    state.trackSelectIndex < trackSelectCardCount()
  ) {
    state.trackSelectIndex =
      (state.trackSelectIndex + 1) % trackSelectCardCount();
    syncTrackSelectWindow();
  }
  if (
    (key === "arrowleft" || key === "arrowright") &&
    state.mode === "settings"
  ) {
    const selected = currentSettingsItems()[state.settingsIndex];
    if (selected === "DEBUG MODE") toggleDebugMode();
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
      state.editor.toolbar.x =
        state.editor.cursorScreenX - state.editor.toolbar.dragOffsetX;
      state.editor.toolbar.y =
        state.editor.cursorScreenY - state.editor.toolbar.dragOffsetY;
      clampEditorToolbarPosition();
      saveEditorToolbarPosition();
      return;
    }
    if (state.mode === "editor") {
      const toolbarHit = editorToolbarActionAt(
        state.editor.cursorScreenX,
        state.editor.cursorScreenY,
      );
      state.editor.toolbar.hoverLabel =
        toolbarHit?.type === "action"
          ? editorToolbarActionLabel(toolbarHit.id)
          : "";
    } else {
      state.editor.toolbar.hoverLabel = "";
    }
    if (!state.editor.drawing || state.mode !== "editor") return;
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
  });
  window.addEventListener("mousedown", (event) => {
    void unlockMenuMusic();
    if (state.mode !== "editor" || event.button !== 0) return;
    updateEditorCursorFromEvent(event);
    const toolbarHit = editorToolbarActionAt(
      state.editor.cursorScreenX,
      state.editor.cursorScreenY,
    );
    if (toolbarHit?.type === "drag") {
      state.editor.toolbar.dragging = true;
      state.editor.toolbar.dragOffsetX =
        state.editor.cursorScreenX - state.editor.toolbar.x;
      state.editor.toolbar.dragOffsetY =
        state.editor.cursorScreenY - state.editor.toolbar.y;
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
    if (state.editor.activeTool !== "road") {
      placeEditorObject(state.editor.activeTool);
      return;
    }
    const preset = getTrackPreset(state.editor.trackIndex);
    const halfWidth = getDefaultStrokeHalfWidth(preset);
    state.editor.drawing = true;
    state.editor.activeStroke = [
      { x: state.editor.cursorX, y: state.editor.cursorY, halfWidth },
    ];
  });
  window.addEventListener("mouseup", (event) => {
    if (state.mode !== "editor" || event.button !== 0) return;
    if (state.editor.toolbar.dragging) {
      state.editor.toolbar.dragging = false;
      clampEditorToolbarPosition();
      saveEditorToolbarPosition();
      return;
    }
    if (!state.editor.drawing) return;
    state.editor.drawing = false;
    const stroke = state.editor.activeStroke;
    state.editor.activeStroke = [];
    if (stroke.length < 2) return;
    const preset = getTrackPreset(state.editor.trackIndex);
    if (!preset.centerlineStrokes) preset.centerlineStrokes = [];
    const nextStroke = stroke.map((p) => ({
      x: p.x,
      y: p.y,
      halfWidth: Number.isFinite(p.halfWidth)
        ? p.halfWidth
        : EDITOR_DEFAULT_HALF_WIDTH,
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
  });
}

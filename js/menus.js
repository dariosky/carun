import {
  applyTrackPreset,
  canvas,
  exportTrackPresetData,
  getTrackPreset,
  importTrackPresetData,
  regenerateTrackFromCenterlineStrokes,
  menuItems,
  physicsConfig,
  sanitizePlayerName,
  saveTrackPreset,
  savePlayerName,
  settingsItems,
  trackOptions,
} from "./parameters.js";
import { keys, setCurbSegments, state } from "./state.js";
import { clearRaceInputs, resetRace } from "./physics.js";
import { initCurbSegments } from "./track.js";

function returnToTrackSelect() {
  if (trackOptions.length > 0) {
    state.selectedTrackIndex = Math.max(0, Math.min(state.selectedTrackIndex, trackOptions.length - 1));
  } else {
    state.selectedTrackIndex = 0;
  }
  state.mode = "trackSelect";
  state.trackSelectIndex = state.selectedTrackIndex;
  state.paused = false;
  state.pauseMenuIndex = 0;
}

function updateEditorCursorFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  state.editor.cursorX = (event.clientX - rect.left) * scaleX;
  state.editor.cursorY = (event.clientY - rect.top) * scaleY;
}

function placeEditorObject(type) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (!preset.editStack) preset.editStack = [];
  const x = state.editor.cursorX;
  const y = state.editor.cursorY;

  if (type === "tree") {
    const tree = { type: "tree", x, y, r: 22 + Math.random() * 6 };
    preset.worldObjects.push(tree);
    preset.editStack.push({ kind: "object" });
    applyTrackPreset(state.editor.trackIndex);
    return;
  }
  if (type === "pond") {
    const pond = {
      type: "pond",
      x,
      y,
      rx: 58 + Math.random() * 24,
      ry: 30 + Math.random() * 18,
      seed: Math.random() * 2 - 1,
    };
    preset.worldObjects.push(pond);
    preset.editStack.push({ kind: "object" });
    applyTrackPreset(state.editor.trackIndex);
    return;
  }
  if (type === "barrel") {
    const barrel = { type: "barrel", x, y, r: 12 };
    preset.worldObjects.push(barrel);
    preset.editStack.push({ kind: "object" });
    applyTrackPreset(state.editor.trackIndex);
  }
}

function undoLastEditorAddition() {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (!preset.editStack || preset.editStack.length === 0) return;

  const lastAction = preset.editStack.pop();
  if (lastAction.kind === "object" && preset.worldObjects.length) {
    preset.worldObjects.pop();
  }
  if (lastAction.kind === "stroke" && preset.centerlineStrokes.length) {
    preset.centerlineStrokes.pop();
  }

  applyTrackPreset(state.editor.trackIndex);
  setCurbSegments(initCurbSegments());
}

function showSnackbar(text, seconds = 1.4) {
  state.snackbar.text = text;
  state.snackbar.time = seconds;
}

function trackSelectCardCount() {
  return trackOptions.length + 1; // Track cards + plus card.
}

function trackSelectBackIndex() {
  return trackSelectCardCount();
}

function saveEditorTrack() {
  const trackIndex = state.editor.trackIndex;
  saveTrackPreset(trackIndex);
  const exportData = exportTrackPresetData(trackIndex);
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `carun-track-${exportData.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showSnackbar("Saved");
}

function openTrackImportDialog() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const imported = importTrackPresetData(parsed, { persist: true });
      if (!imported) {
        showSnackbar("Invalid track file", 2);
        return;
      }
      const importedIndex = trackOptions.findIndex((opt) => opt.id === imported.id);
      if (importedIndex >= 0) {
        state.selectedTrackIndex = importedIndex;
        state.trackSelectIndex = importedIndex;
      }
      showSnackbar("Imported", 1.6);
    } catch {
      showSnackbar("Import failed", 2);
    }
  });
  input.click();
}

function createEmptyTrackAndEdit() {
  const id = `track-${Date.now()}`;
  const newTrack = {
    id,
    name: "NEW TRACK",
    track: {
      cx: canvas.width * 0.5,
      cy: canvas.height * 0.53,
      outerA: 480,
      outerB: 250,
      innerA: 320,
      innerB: 150,
      warpOuter: [],
      warpInner: [],
      borderSize: 22,
      centerlineLoop: null,
      centerlineHalfWidth: 60,
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
    showSnackbar("Could not create track", 2);
    return;
  }
  const idx = trackOptions.findIndex((opt) => opt.id === imported.id);
  if (idx < 0) {
    showSnackbar("Could not create track", 2);
    return;
  }
  state.selectedTrackIndex = idx;
  state.trackSelectIndex = idx;
  showSnackbar("New track created", 1.6);
  enterEditor(idx);
}

function enterEditor(trackIndex) {
  state.selectedTrackIndex = trackIndex;
  applyTrackPreset(trackIndex);
  setCurbSegments(initCurbSegments());
  state.mode = "editor";
  state.editor.trackIndex = trackIndex;
  state.editor.drawing = false;
  state.editor.activeStroke = [];
}

function activateSelection() {
  if (state.mode === "menu") {
    if (state.menuIndex === 0) {
      if (trackOptions.length > 0) {
        state.selectedTrackIndex = Math.max(0, Math.min(state.selectedTrackIndex, trackOptions.length - 1));
      } else {
        state.selectedTrackIndex = 0;
      }
      state.mode = "trackSelect";
      state.trackSelectIndex = state.selectedTrackIndex;
    }
    if (state.menuIndex === 1) {
      state.mode = "settings";
      state.settingsIndex = 0;
      state.editingName = false;
    }
    return;
  }

  if (state.mode === "trackSelect") {
    const addIndex = trackOptions.length;
    const backIndex = trackSelectBackIndex();
    if (state.trackSelectIndex === backIndex) {
      state.mode = "menu";
      state.menuIndex = 0;
    } else if (state.trackSelectIndex === addIndex) {
      openTrackImportDialog();
    } else {
      state.selectedTrackIndex = state.trackSelectIndex;
      applyTrackPreset(state.selectedTrackIndex);
      setCurbSegments(initCurbSegments());
      state.mode = "racing";
      resetRace();
    }
    return;
  }

  if (state.mode === "settings") {
    if (state.settingsIndex === 0) {
      state.editingName = !state.editingName;
    }
    if (state.settingsIndex === 1) {
      state.mode = "menu";
      state.paused = false;
    }
    return;
  }

  if (state.mode === "racing" && state.finished) {
    state.mode = "menu";
    state.paused = false;
    state.pauseMenuIndex = 0;
  }
}

function onKeyDown(e) {
  const key = e.key.toLowerCase();

  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
    e.preventDefault();
  }

  if (state.mode === "settings" && state.editingName) {
    if (key === "escape") {
      state.editingName = false;
      return;
    }
    if (key === "enter") {
      if (state.playerName.trim().length > 0) {
        state.playerName = sanitizePlayerName(state.playerName);
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

  if (state.mode === "racing") {
    if (state.finished && key === "escape") {
      state.mode = "menu";
      state.paused = false;
      state.pauseMenuIndex = 0;
      clearRaceInputs();
      return;
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
          returnToTrackSelect();
          clearRaceInputs();
        }
      }
      clearRaceInputs();
      return;
    }
  }

  if (state.mode === "trackSelect" && key === "escape") {
    state.mode = "menu";
    state.menuIndex = 0;
    return;
  }
  if (state.mode === "editor" && key === "escape") {
    state.editor.drawing = false;
    state.editor.activeStroke = [];
    returnToTrackSelect();
    return;
  }
  if (state.mode === "editor" && key === "backspace") {
    undoLastEditorAddition();
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

  if (state.mode === "editor") {
    if (key === "t") placeEditorObject("tree");
    if (key === "w") placeEditorObject("pond");
    if (key === "b") placeEditorObject("barrel");
    if (key === "s") {
      saveEditorTrack();
      return;
    }
    if (key === " ") {
      const generated = regenerateTrackFromCenterlineStrokes(state.editor.trackIndex);
      if (generated) {
        applyTrackPreset(state.editor.trackIndex);
        setCurbSegments(initCurbSegments());
      }
      return;
    }
  }

  if (key === "arrowup") {
    if (state.mode === "menu") state.menuIndex = (state.menuIndex + menuItems.length - 1) % menuItems.length;
    if (state.mode === "settings") {
      state.settingsIndex = (state.settingsIndex + settingsItems.length - 1) % settingsItems.length;
    }
    if (state.mode === "trackSelect") {
      state.trackSelectIndex =
        state.trackSelectIndex === trackSelectBackIndex() ? state.selectedTrackIndex : trackSelectBackIndex();
    }
    keys.up = true;
  }
  if (key === "arrowdown") {
    if (state.mode === "menu") state.menuIndex = (state.menuIndex + 1) % menuItems.length;
    if (state.mode === "settings") state.settingsIndex = (state.settingsIndex + 1) % settingsItems.length;
    if (state.mode === "trackSelect") {
      state.trackSelectIndex =
        state.trackSelectIndex === trackSelectBackIndex() ? state.selectedTrackIndex : trackSelectBackIndex();
    }
    keys.down = true;
  }
  if (key === "arrowleft" && state.mode === "trackSelect" && state.trackSelectIndex < trackSelectCardCount()) {
    state.trackSelectIndex = (state.trackSelectIndex + trackSelectCardCount() - 1) % trackSelectCardCount();
  }
  if (key === "arrowright" && state.mode === "trackSelect" && state.trackSelectIndex < trackSelectCardCount()) {
    state.trackSelectIndex = (state.trackSelectIndex + 1) % trackSelectCardCount();
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
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", (event) => {
    updateEditorCursorFromEvent(event);
    if (!state.editor.drawing || state.mode !== "editor") return;
    const points = state.editor.activeStroke;
    const last = points[points.length - 1];
    const x = state.editor.cursorX;
    const y = state.editor.cursorY;
    if (!last || Math.hypot(x - last.x, y - last.y) > 4) {
      points.push({ x, y });
    }
  });
  window.addEventListener("mousedown", (event) => {
    if (state.mode !== "editor" || event.button !== 0) return;
    updateEditorCursorFromEvent(event);
    state.editor.drawing = true;
    state.editor.activeStroke = [{ x: state.editor.cursorX, y: state.editor.cursorY }];
  });
  window.addEventListener("mouseup", (event) => {
    if (state.mode !== "editor" || event.button !== 0) return;
    if (!state.editor.drawing) return;
    state.editor.drawing = false;
    const stroke = state.editor.activeStroke;
    state.editor.activeStroke = [];
    if (stroke.length < 2) return;
    const preset = getTrackPreset(state.editor.trackIndex);
    if (!preset.centerlineStrokes) preset.centerlineStrokes = [];
    preset.centerlineStrokes.push(stroke.map((p) => ({ x: p.x, y: p.y })));
    if (!preset.editStack) preset.editStack = [];
    preset.editStack.push({ kind: "stroke" });
  });
}

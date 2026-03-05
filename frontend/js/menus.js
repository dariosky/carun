import {
  applyTrackPreset,
  canDeleteTrackPreset,
  canvas,
  deleteOwnTrackFromApi,
  getMenuItems,
  getLoginProviderItems,
  getTrackPreset,
  getSettingsItems,
  importTrackPresetData,
  removeTrackPresetById,
  regenerateTrackFromCenterlineStrokes,
  saveTrackPresetToDb,
  setTrackPresetMetadata,
  physicsConfig,
  sanitizePlayerName,
  saveDebugMode,
  saveTrackPreset,
  savePlayerName,
  trackOptions,
} from "./parameters.js";
import { keys, setCurbSegments, state } from "./state.js";
import { clearRaceInputs, resetRace } from "./physics.js";
import { initCurbSegments } from "./track.js";
import { logoutAuth, setTrackPublished, updateAuthDisplayName } from "./api.js";

const EDITOR_TOP_BAR_HEIGHT = 56;
const TRACK_SELECT_VISIBLE_CARDS = 4;

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
  const rowGap = 74;
  const startY = 338;

  const rowLabels = settingsItems.map((item) => {
    if (item === "PLAYER NAME") {
      const suffix = state.editingName ? "_" : "";
      return `${item}: ${state.playerName}${suffix}`;
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

export function getTrackSelectRenderModel() {
  const visibleCount = trackSelectVisibleCount();
  const totalCount = trackOptions.length;
  const maxOffset = Math.max(0, totalCount - visibleCount);
  const viewOffset = Math.max(
    0,
    Math.min(state.trackSelectViewOffset, maxOffset),
  );
  const visibleTracks = trackOptions
    .slice(viewOffset, viewOffset + visibleCount)
    .map((track) => ({
      ...track,
      showAdminBadge: Boolean(
        state.auth.isAdmin &&
        track.fromDb &&
        track.ownerUserId &&
        track.ownerUserId !== state.auth.userId,
      ),
    }));
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

function setTrackInUrl(trackId) {
  const cleanTrackId = typeof trackId === "string" ? trackId.trim() : "";
  if (!cleanTrackId) return;
  const url = new URL(window.location.href);
  url.searchParams.set("track", cleanTrackId);
  window.history.replaceState(
    {},
    "",
    `${url.pathname}?${url.searchParams.toString()}${url.hash}`,
  );
}

function clearTrackInUrl(trackId) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("track") !== trackId) return;
  url.searchParams.delete("track");
  const query = url.searchParams.toString();
  window.history.replaceState(
    {},
    "",
    `${url.pathname}${query ? `?${query}` : ""}${url.hash}`,
  );
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
  state.modal.title = title || "Confirm";
  state.modal.message = message || "";
  state.modal.confirmLabel = confirmLabel;
  state.modal.cancelLabel = cancelLabel;
  state.modal.danger = danger;
  state.modal.selectedAction = "cancel";
  state.modal.onConfirm = typeof onConfirm === "function" ? onConfirm : null;
  state.modal.onCancel = null;
}

function closeModal({ runCancel = false } = {}) {
  const onCancel = state.modal.onCancel;
  state.modal.open = false;
  state.modal.title = "";
  state.modal.message = "";
  state.modal.confirmLabel = "Yes";
  state.modal.cancelLabel = "No";
  state.modal.danger = false;
  state.modal.selectedAction = "cancel";
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
  state.trackSelectIndex = state.selectedTrackIndex;
  syncTrackSelectWindow();
  state.paused = false;
  state.pauseMenuIndex = 0;
}

function updateEditorCursorFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  state.editor.cursorX = (event.clientX - rect.left) * scaleX;
  state.editor.cursorY =
    (event.clientY - rect.top) * scaleY - EDITOR_TOP_BAR_HEIGHT;
}

function placeEditorObject(type) {
  if (state.mode !== "editor") return;
  const preset = getTrackPreset(state.editor.trackIndex);
  if (!preset.editStack) preset.editStack = [];
  const x = state.editor.cursorX;
  const y = state.editor.cursorY;
  if (y < 0) return;

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
  if (!preset.editStack) preset.editStack = [];

  // Legacy/imported tracks can have strokes without an aligned editStack.
  if (preset.editStack.length === 0) {
    if (preset.centerlineStrokes && preset.centerlineStrokes.length) {
      preset.centerlineStrokes.pop();
      applyTrackPreset(state.editor.trackIndex);
      setCurbSegments(initCurbSegments());
    }
    return;
  }

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
  return trackOptions.length; // Track cards only.
}

function trackSelectBackIndex() {
  return trackSelectCardCount();
}

async function saveEditorTrack() {
  const trackIndex = state.editor.trackIndex;
  const previousPreset = getTrackPreset(trackIndex);
  const previousId = previousPreset.id;
  const shouldReplacePrevious =
    !previousPreset.fromDb && previousPreset.source !== "system";
  saveTrackPreset(trackIndex);
  try {
    const imported = await saveTrackPresetToDb(trackIndex, {
      currentUserId: state.auth.userId,
    });
    if (!imported) {
      showSnackbar("Save failed", 2);
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
      setTrackInUrl(imported.id);
    }
    showSnackbar("Saved to DB");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    if (message.toLowerCase().includes("authentication required"))
      showSnackbar("Login required", 2);
    else showSnackbar(message, 2);
  }
}

function toggleDebugMode() {
  physicsConfig.flags.DEBUG_MODE = !physicsConfig.flags.DEBUG_MODE;
  saveDebugMode(physicsConfig.flags.DEBUG_MODE);
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
  syncTrackSelectWindow();
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
  const preset = getTrackPreset(trackIndex);
  if (preset) setTrackInUrl(preset.id);
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
      state.trackSelectIndex = state.selectedTrackIndex;
      syncTrackSelectWindow();
      return;
    }
    if (selectedItem === "SETTINGS") {
      state.mode = "settings";
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
      state.menuIndex = loginMenuIndex();
      return;
    }
    return;
  }

  if (state.mode === "trackSelect") {
    const backIndex = trackSelectBackIndex();
    if (state.trackSelectIndex === backIndex) {
      state.mode = "menu";
      state.menuIndex = raceMenuIndex();
    } else {
      state.selectedTrackIndex = state.trackSelectIndex;
      applyTrackPreset(state.selectedTrackIndex);
      setCurbSegments(initCurbSegments());
      state.mode = "racing";
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
          state.menuIndex = 0;
          state.settingsIndex = 0;
          state.editingName = false;
          state.paused = false;
          showSnackbar("Logged out", 1.8);
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : "Logout failed";
          showSnackbar(message, 2);
        });
      return;
    }
    if (selectedSetting === "BACK") {
      state.mode = "menu";
      state.menuIndex = settingsMenuIndex();
      state.paused = false;
      return;
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

  if (state.modal.open) {
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
          showSnackbar("Action failed", 2);
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
              showSnackbar("Display name updated", 1.8);
            })
            .catch((error) => {
              const message =
                error instanceof Error ? error.message : "Update failed";
              showSnackbar(message, 2);
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
    state.menuIndex = raceMenuIndex();
    return;
  }
  if (state.mode === "settings" && key === "escape") {
    state.mode = "menu";
    state.menuIndex = settingsMenuIndex();
    state.paused = false;
    return;
  }
  if (state.mode === "loginProviders" && key === "escape") {
    state.mode = "menu";
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
    undoLastEditorAddition();
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
            isPublished: Boolean(updatedTrack.is_published),
            shareToken: updatedTrack.share_token || null,
            fromDb: true,
          },
          { currentUserId: state.auth.userId },
        );
        if (!updatedPreset) return;
        showSnackbar(
          updatedPreset.isPublished ? "Track published" : "Track unpublished",
          1.8,
        );
      })
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "Publish update failed";
        showSnackbar(message, 2);
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
    (key === "delete" || key === "del") &&
    state.mode === "trackSelect" &&
    state.trackSelectIndex >= 0 &&
    state.trackSelectIndex < trackOptions.length
  ) {
    const preset = getTrackPreset(state.trackSelectIndex);
    if (!preset || !canDeleteTrackPreset(preset, state.auth.userId)) {
      showSnackbar("Only your unpublished tracks can be deleted", 1.8);
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
          showSnackbar("Track deleted", 1.8);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Delete failed";
          showSnackbar(message, 2);
        }
      },
    });
    return;
  }

  if (state.mode === "editor") {
    if (key === "c") {
      if (e.repeat) return;
      state.editor.showCurbs = !state.editor.showCurbs;
      return;
    }
    if (key === "t") placeEditorObject("tree");
    if (key === "w") placeEditorObject("pond");
    if (key === "b") placeEditorObject("barrel");
    if (key === "r") {
      state.selectedTrackIndex = state.editor.trackIndex;
      applyTrackPreset(state.editor.trackIndex);
      setCurbSegments(initCurbSegments());
      state.mode = "racing";
      resetRace();
      const selected = trackOptions[state.selectedTrackIndex];
      if (selected) setTrackInUrl(selected.id);
      return;
    }
    if (key === "s") {
      saveEditorTrack();
      return;
    }
    if (key === " ") {
      const generated = regenerateTrackFromCenterlineStrokes(
        state.editor.trackIndex,
      );
      if (generated) {
        applyTrackPreset(state.editor.trackIndex);
        setCurbSegments(initCurbSegments());
      }
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
    if (state.editor.cursorY < 0) return;
    state.editor.drawing = true;
    state.editor.activeStroke = [
      { x: state.editor.cursorX, y: state.editor.cursorY },
    ];
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

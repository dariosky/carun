import { menuItems, sanitizePlayerName, savePlayerName, settingsItems } from "./parameters.js";
import { keys, state } from "./state.js";
import { clearRaceInputs, resetRace } from "./physics.js";

function activateSelection() {
  if (state.mode === "menu") {
    if (state.menuIndex === 0) {
      state.mode = "racing";
      resetRace();
    }
    if (state.menuIndex === 1) {
      state.mode = "settings";
      state.settingsIndex = 0;
      state.editingName = false;
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
          state.mode = "menu";
          state.paused = false;
          state.pauseMenuIndex = 0;
        }
      }
      clearRaceInputs();
      return;
    }
  }

  if (key === "arrowup") {
    if (state.mode === "menu") state.menuIndex = (state.menuIndex + menuItems.length - 1) % menuItems.length;
    if (state.mode === "settings") {
      state.settingsIndex = (state.settingsIndex + settingsItems.length - 1) % settingsItems.length;
    }
    keys.up = true;
  }
  if (key === "arrowdown") {
    if (state.mode === "menu") state.menuIndex = (state.menuIndex + 1) % menuItems.length;
    if (state.mode === "settings") state.settingsIndex = (state.settingsIndex + 1) % settingsItems.length;
    keys.down = true;
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
}

import test from "node:test";
import assert from "node:assert/strict";

import {
  makeTrackData,
  setupFrontendTestEnv,
} from "./helpers/frontend-test-env.mjs";

setupFrontendTestEnv();

const { keys, state } = await import("../js/state.js");
const { physicsConfig } = await import("../js/parameters.js");
const {
  getLoginProviderRenderModel,
  getMainMenuRenderModel,
  getSettingsHeaderRenderModel,
  getSettingsRenderLayout,
  pauseActiveRace,
} = await import("../js/menus.js");

test("main menu model switches items by auth state", () => {
  state.auth.authenticated = false;
  state.menuIndex = 1;
  const loggedOut = getMainMenuRenderModel((text) => text.length * 10);
  assert.deepEqual(loggedOut.menuItems, [
    "LOGIN",
    "RACE ANONYMOUSLY",
    "SETTINGS",
  ]);
  assert.equal(loggedOut.selectedMenuIndex, 1);

  state.auth.authenticated = true;
  state.menuIndex = 0;
  const loggedIn = getMainMenuRenderModel((text) => text.length * 10);
  assert.deepEqual(loggedIn.menuItems, ["RACE", "SETTINGS"]);
  assert.equal(loggedIn.selectedMenuIndex, 0);
});

test("main menu highlight width grows for longest label", () => {
  state.auth.authenticated = false;
  const model = getMainMenuRenderModel((text) => text.length * 10);
  assert.equal(model.highlightWidth, 256 > 460 ? 256 : 460);

  const widerModel = getMainMenuRenderModel((text) =>
    text === "RACE ANONYMOUSLY" ? 500 : text.length * 10,
  );
  assert.equal(widerModel.highlightWidth, 596);
});

test("login providers model exposes provider options and selected row", () => {
  state.loginProviderIndex = 1;
  const model = getLoginProviderRenderModel((text) => text.length * 10);
  assert.deepEqual(model.loginItems, [
    "LOGIN WITH GOOGLE",
    "LOGIN WITH FACEBOOK",
    "BACK",
  ]);
  assert.equal(model.selectedLoginIndex, 1);
  assert.equal(
    model.highlightWidth,
    Math.max(540, "LOGIN WITH FACEBOOK".length * 10 + 120),
  );
});

test("settings render layout uses longest rendered row label", () => {
  state.auth.authenticated = true;
  state.playerName = "SUPERLONGNAME";
  state.playerColor = "sky";
  state.editingName = false;
  physicsConfig.flags.AI_OPPONENTS_ENABLED = true;
  physicsConfig.flags.AI_OPPONENT_COUNT = 3;
  physicsConfig.flags.DEBUG_MODE = true;

  const layout = getSettingsRenderLayout((text) => text.length * 10);
  assert.deepEqual(layout.settingsItems, [
    "PLAYER NAME",
    "PLAYER COLOR",
    "MENU MUSIC",
    "AI OPPONENTS",
    "DEBUG MODE",
    "LOGOUT",
    "BACK",
  ]);
  assert.equal(layout.rowGap, 56);
  assert.equal(layout.startY, 314);

  const longestRow = "PLAYER NAME: SUPERLONGNAME";
  const expected = Math.max(720, longestRow.length * 10 + 92);
  assert.equal(layout.highlightWidth, expected);
});

test("settings render layout shows AI count even when AI are disabled", () => {
  state.auth.authenticated = false;
  state.playerColor = "mint";
  physicsConfig.flags.AI_OPPONENTS_ENABLED = false;
  physicsConfig.flags.AI_OPPONENT_COUNT = 4;

  const layout = getSettingsRenderLayout((text) => text.length * 10);
  assert.deepEqual(layout.settingsItems, [
    "PLAYER NAME",
    "PLAYER COLOR",
    "MENU MUSIC",
    "AI OPPONENTS",
    "DEBUG MODE",
    "BACK",
  ]);
  assert.equal(layout.rowLabels[1], "PLAYER COLOR: MINT");
  assert.equal(layout.rowLabels[3], "AI OPPONENTS: 4 (AI OFF)");
});

test("settings header model defines centered title", () => {
  const header = getSettingsHeaderRenderModel();
  assert.equal(header.text, "SETTINGS");
  assert.equal(header.textAlign, "center");
  assert.equal(header.xRatio, 0.5);
});

test("pauseActiveRace pauses a local race and clears held inputs", () => {
  state.mode = "racing";
  state.paused = false;
  state.pauseMenuIndex = 1;
  state.tournamentRoom.active = false;
  keys.accel = true;
  keys.left = true;
  keys.handbrake = true;

  const paused = pauseActiveRace();

  assert.equal(paused, true);
  assert.equal(state.paused, true);
  assert.equal(state.pauseMenuIndex, 0);
  assert.equal(keys.accel, false);
  assert.equal(keys.left, false);
  assert.equal(keys.handbrake, false);
});

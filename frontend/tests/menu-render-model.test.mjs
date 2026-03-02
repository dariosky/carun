import test from "node:test";
import assert from "node:assert/strict";

function setupDomStubs() {
  const noop = () => {};
  const fakeCtx = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    lineWidth: 0,
    globalAlpha: 1,
    save: noop,
    restore: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop,
    measureText: (text) => ({ width: String(text).length * 10 }),
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    clip: noop,
    rect: noop,
    arc: noop,
    translate: noop,
    scale: noop,
    drawImage: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    setLineDash: noop,
  };
  const fakeCanvas = {
    width: 1280,
    height: 720,
    getContext: () => fakeCtx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  };
  globalThis.window = {
    location: { href: "http://localhost:8080/" },
    history: { replaceState: noop },
    addEventListener: noop,
  };
  globalThis.document = {
    getElementById: () => fakeCanvas,
    createElement: () => fakeCanvas,
  };
  globalThis.Image = class {
    addEventListener() {}
    set src(_) {}
  };
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return fakeCtx;
    }
  };
}

setupDomStubs();

const { state } = await import("../js/state.js");
const { physicsConfig } = await import("../js/parameters.js");
const {
  getMainMenuRenderModel,
  getSettingsRenderLayout,
  getSettingsHeaderRenderModel,
} = await import("../js/menus.js");

test("main menu model switches items by auth state", () => {
  state.auth.authenticated = false;
  state.menuIndex = 1;
  const loggedOut = getMainMenuRenderModel((text) => text.length * 10);
  assert.deepEqual(loggedOut.menuItems, ["LOGIN", "RACE ANONYMOUSLY", "SETTINGS"]);
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
  // "RACE ANONYMOUSLY" = 16 chars => 160 + 96 padding.
  assert.equal(model.highlightWidth, 256 > 460 ? 256 : 460);

  const widerModel = getMainMenuRenderModel((text) =>
    text === "RACE ANONYMOUSLY" ? 500 : text.length * 10,
  );
  assert.equal(widerModel.highlightWidth, 596);
});

test("settings render layout uses longest rendered row label", () => {
  state.auth.authenticated = true;
  state.playerName = "SUPERLONGNAME";
  state.editingName = false;
  physicsConfig.flags.DEBUG_MODE = true;

  const layout = getSettingsRenderLayout((text) => text.length * 10);
  assert.deepEqual(layout.settingsItems, ["PLAYER NAME", "DEBUG MODE", "LOGOUT", "BACK"]);
  assert.equal(layout.rowGap, 74);
  assert.equal(layout.startY, 338);

  const longestRow = "PLAYER NAME: SUPERLONGNAME";
  const expected = Math.max(560, longestRow.length * 10 + 92);
  assert.equal(layout.highlightWidth, expected);
});

test("settings header model defines centered title", () => {
  const header = getSettingsHeaderRenderModel();
  assert.equal(header.text, "SETTINGS");
  assert.equal(header.textAlign, "center");
  assert.equal(header.xRatio, 0.5);
});

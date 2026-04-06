import test from "node:test";
import assert from "node:assert/strict";

import { setupFrontendTestEnv } from "./helpers/frontend-test-env.mjs";

setupFrontendTestEnv();

const { startGameLoop, requestImmediateFrame, stopGameLoop } = await import("../js/game-loop.js");
const { state } = await import("../js/state.js");

function installLoopSpies() {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  const rafCallbacks = [];
  const timeoutCalls = [];
  const clearedTimeouts = [];

  globalThis.requestAnimationFrame = (callback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  window.setTimeout = (callback, delay) => {
    timeoutCalls.push({ callback, delay });
    return timeoutCalls.length;
  };
  window.clearTimeout = (handle) => {
    clearedTimeouts.push(handle);
  };

  return {
    rafCallbacks,
    timeoutCalls,
    clearedTimeouts,
    restore() {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
      stopGameLoop();
    },
  };
}

test("idle menu frames fall back to timed scheduling instead of continuous animation frames", () => {
  const spies = installLoopSpies();
  state.mode = "menu";
  state.snackbar.time = 0;
  globalThis.document.hidden = false;

  let updates = 0;
  let renders = 0;
  startGameLoop({
    update() {
      updates += 1;
    },
    render() {
      renders += 1;
    },
  });

  assert.equal(spies.rafCallbacks.length, 1);
  assert.equal(spies.timeoutCalls.length, 0);

  spies.rafCallbacks.shift()(1000);

  assert.equal(updates, 1);
  assert.equal(renders, 1);
  assert.equal(spies.rafCallbacks.length, 0);
  assert.equal(spies.timeoutCalls.length, 1);
  assert.equal(spies.timeoutCalls[0].delay, Math.round(1000 / 12));

  requestImmediateFrame();

  assert.deepEqual(spies.clearedTimeouts, [1]);
  assert.equal(spies.rafCallbacks.length, 1);

  spies.restore();
});

test("racing keeps scheduling animation frames continuously", () => {
  const spies = installLoopSpies();
  state.mode = "racing";
  state.snackbar.time = 0;
  globalThis.document.hidden = false;

  startGameLoop({
    update() {},
    render() {},
  });

  assert.equal(spies.rafCallbacks.length, 1);

  spies.rafCallbacks.shift()(1000);

  assert.equal(spies.timeoutCalls.length, 0);
  assert.equal(spies.rafCallbacks.length, 1);

  spies.restore();
});

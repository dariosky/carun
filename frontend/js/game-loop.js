import { physicsConfig } from "./parameters.js";
import { hasActiveScreenParticles } from "./particles.js";
import { state } from "./state.js";

const ACTIVE_FPS = 60;
const ANIMATED_UI_FPS = 30;
const IDLE_UI_FPS = 12;

let frameHandle = null;
let timeoutHandle = null;
let callbacks = null;
let running = false;
let lastFrameAt = 0;
let visibilityListenerAttached = false;

function clearScheduledFrame() {
  if (frameHandle !== null) {
    cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }
  if (timeoutHandle !== null) {
    window.clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
}

function hiddenDocument() {
  return typeof document !== "undefined" && document.hidden;
}

function hasAnimatedUiWork() {
  return state.snackbar.time > 0 || hasActiveScreenParticles();
}

function targetFps() {
  if (hiddenDocument()) return 0;
  if (state.mode === "racing" || state.mode === "editor") return ACTIVE_FPS;
  if (hasAnimatedUiWork()) return ANIMATED_UI_FPS;
  return IDLE_UI_FPS;
}

function scheduleNextFrame({ immediate = false } = {}) {
  if (!running || frameHandle !== null || timeoutHandle !== null) return;

  const fps = targetFps();
  if (immediate || fps >= ACTIVE_FPS) {
    frameHandle = requestAnimationFrame(runFrame);
    return;
  }

  const delayMs = Math.max(0, Math.round(1000 / Math.max(1, fps)));
  timeoutHandle = window.setTimeout(() => {
    timeoutHandle = null;
    frameHandle = requestAnimationFrame(runFrame);
  }, delayMs);
}

function updatePerformanceCounters(dt) {
  const rawFps = dt > 0 ? 1 / dt : 0;
  const smooth = 0.12;
  state.performance.fps = state.performance.fps
    ? state.performance.fps * (1 - smooth) + rawFps * smooth
    : rawFps;
}

function runFrame(now) {
  frameHandle = null;
  if (!running || !callbacks) return;

  const dt = Math.min(physicsConfig.car.dtClamp, (now - lastFrameAt) / 1000);
  lastFrameAt = now;
  updatePerformanceCounters(dt);

  callbacks.update(dt);
  callbacks.render();
  scheduleNextFrame();
}

function handleVisibilityChange() {
  if (!running) return;
  clearScheduledFrame();
  scheduleNextFrame({ immediate: !hiddenDocument() });
}

export function requestImmediateFrame() {
  if (!running) return;
  clearScheduledFrame();
  scheduleNextFrame({ immediate: true });
}

export function stopGameLoop() {
  running = false;
  callbacks = null;
  clearScheduledFrame();
}

export function startGameLoop({ update, render }) {
  callbacks = { update, render };
  running = true;
  lastFrameAt = performance.now();
  clearScheduledFrame();

  if (!visibilityListenerAttached && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = true;
  }

  scheduleNextFrame({ immediate: true });
}

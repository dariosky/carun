import { loadPlayerName, track } from "./parameters.js";
import { nextTaglineSet } from "./taglines.js";

const initialTaglines = nextTaglineSet();
const buildLabelFromWindow =
  typeof window !== "undefined" && typeof window.__CARUN_BUILD_LABEL__ === "string"
    ? window.__CARUN_BUILD_LABEL__
    : "v.dev";

export const state = {
  mode: "menu",
  paused: false,
  pauseMenuIndex: 0,
  menuIndex: 0,
  trackSelectIndex: 0,
  selectedTrackIndex: 0,
  settingsIndex: 0,
  playerName: loadPlayerName(),
  editingName: false,
  raceTime: 0,
  finished: false,
  startSequence: {
    active: false,
    elapsed: 0,
    goTime: 0,
    goFlash: 0,
  },
  checkpointBlink: {
    time: 0,
    duration: 0.45,
  },
  editor: {
    trackIndex: 0,
    cursorX: track.cx,
    cursorY: track.cy,
    drawing: false,
    activeStroke: [],
    showCurbs: true,
  },
  snackbar: {
    text: "",
    time: 0,
  },
  modal: {
    open: false,
    title: "",
    message: "",
    confirmLabel: "Yes",
    cancelLabel: "No",
    danger: false,
    selectedAction: "cancel",
    onConfirm: null,
    onCancel: null,
  },
  performance: {
    fps: 0,
  },
  buildLabel: buildLabelFromWindow,
  menuTagline: {
    list: initialTaglines,
    index: 0,
    elapsed: 0,
    displaySeconds: 30,
    fadeSeconds: 1,
  },
};

export const keys = {
  up: false,
  down: false,
  left: false,
  right: false,
  accel: false,
  brake: false,
  handbrake: false,
};

export const lapData = {
  currentLapStart: 0,
  lapTimes: [],
  maxLaps: 3,
  passed: new Set([0]),
  nextCheckpointIndex: 1,
  lap: 1,
};

export const car = {
  x: track.cx,
  y: track.cy + 205,
  vx: 0,
  vy: 0,
  angle: Math.PI,
  speed: 0,
  width: 34,
  height: 20,
};

export const physicsRuntime = {
  input: { throttle: 0, brake: 0, steer: 0, handbrake: 0 },
  steeringRate: 0,
  recoveryTimer: 0,
  collisionGripTimer: 0,
  prevSteerAbs: 0,
  surface: {
    lateralGripMul: 1,
    longDragMul: 1,
    engineMul: 1,
    coastDecelMul: 1,
  },
  debug: {
    slipAngle: 0,
    surface: "asphalt",
    vForward: 0,
    vLateral: 0,
    pivotX: track.cx,
    pivotY: track.cy,
  },
  wheelLastPoints: null,
  prevForwardSpeed: null,
};

export let curbSegments = { outer: [], inner: [] };
export const skidMarks = [];

export function setCurbSegments(segments) {
  curbSegments = segments;
}

export const kartSprite = new Image();
export let kartSpriteReady = false;
export const appLogo = new Image();
export let appLogoReady = false;

kartSprite.addEventListener("load", () => {
  kartSpriteReady = true;
});
kartSprite.addEventListener("error", () => {
  console.warn("Failed to load kart sprite at assets/kart.png");
});
kartSprite.src = "assets/kart.png";

appLogo.addEventListener("load", () => {
  appLogoReady = true;
});
appLogo.addEventListener("error", () => {
  console.warn("Failed to load app logo at assets/carun.svg");
});
appLogo.src = "assets/carun.svg";

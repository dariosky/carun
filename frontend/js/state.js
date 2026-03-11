import { loadPlayerName, track } from "./parameters.js";
import { nextTaglineSet } from "./taglines.js";

const initialTaglines = nextTaglineSet();
const buildLabelFromWindow =
  typeof window !== "undefined" &&
  typeof window.__CARUN_BUILD_LABEL__ === "string"
    ? window.__CARUN_BUILD_LABEL__
    : "v.dev";

export const state = {
  mode: "menu",
  paused: false,
  pauseMenuIndex: 0,
  menuIndex: 0,
  loginProviderIndex: 0,
  trackSelectIndex: 0,
  trackSelectViewOffset: 0,
  selectedTrackIndex: 0,
  settingsIndex: 0,
  gameModeIndex: 0,
  gameMode: "single",
  tournament: {
    selectedTrackIndices: new Set(),
    trackOrder: [],
    currentRaceIndex: 0,
    scores: {},
    raceResults: [],
  },
  playerName: loadPlayerName(),
  auth: {
    authenticated: false,
    userId: null,
    displayName: null,
    isAdmin: false,
  },
  editingName: false,
  raceTime: 0,
  finished: false,
  raceSubmission: {
    inFlight: false,
    completed: false,
  },
  raceStandings: {
    nextFinishOrder: 1,
    playerFinishOrder: 0,
    aiFinishOrder: 0,
  },
  raceReturn: {
    mode: "trackSelect",
    editorTrackIndex: null,
  },
  finishCelebration: {
    bestLap: false,
    bestRace: false,
    totalTime: 0,
    bestLapTime: 0,
    confettiActive: false,
  },
  startSequence: {
    active: false,
    elapsed: 0,
    goTime: 0,
    goFlash: 0,
    lastCountdownStep: 0,
  },
  checkpointBlink: {
    time: 0,
    duration: 0.45,
  },
  editor: {
    trackIndex: 0,
    cursorX: track.cx,
    cursorY: track.cy,
    cursorScreenX: track.cx,
    cursorCanvasY: track.cy,
    cursorScreenY: track.cy,
    activeTool: "road",
    drawing: false,
    activeStroke: [],
    showCurbs: true,
    toolbar: {
      x: 18,
      y: 18,
      width: 252,
      dragging: false,
      dragOffsetX: 0,
      dragOffsetY: 0,
      hoverLabel: "",
    },
    latestEditTarget: null,
    selectionFlash: {
      kind: null,
      index: -1,
      time: 0,
    },
  },
  snackbar: {
    text: "",
    time: 0,
    kind: "info",
  },
  modal: {
    open: false,
    mode: "confirm",
    title: "",
    message: "",
    confirmLabel: "Yes",
    cancelLabel: "No",
    danger: false,
    selectedAction: "cancel",
    inputValue: "",
    inputPlaceholder: "",
    inputMaxLength: 36,
    onSubmit: null,
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
  finished: false,
  finishTime: 0,
};

export const aiLapData = {
  currentLapStart: 0,
  lapTimes: [],
  maxLaps: 3,
  passed: new Set([0]),
  nextCheckpointIndex: 1,
  lap: 1,
  finished: false,
  finishTime: 0,
};

export const car = {
  x: track.cx,
  y: track.cy + 205,
  vx: 0,
  vy: 0,
  angle: Math.PI,
  speed: 0,
  z: 0,
  vz: 0,
  airborne: false,
  airTime: 0,
  visualScale: 1,
  width: 34,
  height: 20,
};

export const aiCar = {
  x: track.cx,
  y: track.cy + 170,
  vx: 0,
  vy: 0,
  angle: Math.PI,
  speed: 0,
  z: 0,
  vz: 0,
  airborne: false,
  airTime: 0,
  visualScale: 1,
  width: 34,
  height: 20,
  label: "RIVAL",
};

export const physicsRuntime = {
  input: { throttle: 0, brake: 0, steer: 0, handbrake: 0 },
  steeringRate: 0,
  recoveryTimer: 0,
  collisionGripTimer: 0,
  impactCooldown: 0,
  lastGroundedSpeed: 0,
  landingBouncePending: false,
  landingCooldown: 0,
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
    z: 0,
    vz: 0,
  },
  wheelLastPoints: null,
  prevForwardSpeed: null,
  particleEmitters: {
    smokeCooldown: 0,
    splashCooldown: 0,
    dustCooldown: 0,
  },
};

export const aiPhysicsRuntime = {
  input: { throttle: 0, brake: 0, steer: 0, handbrake: 0 },
  steeringRate: 0,
  recoveryTimer: 0,
  collisionGripTimer: 0,
  impactCooldown: 0,
  prevSteerAbs: 0,
  lastGroundedSpeed: 0,
  landingBouncePending: false,
  landingCooldown: 0,
  mode: "race",
  recoveryMode: "none",
  targetLaneOffset: 0,
  blockedTimer: 0,
  progress: 0,
  progressAtLastSample: 0,
  lowProgressTimer: 0,
  offRoadTimer: 0,
  repeatedCollisionTimer: 0,
  lastCollisionNormalX: 0,
  lastCollisionNormalY: 0,
  lastCollisionTime: 0,
  softResetCooldown: 0,
  replanCooldown: 0,
  currentNodeId: -1,
  lastValidNodeId: -1,
  targetNodeId: -1,
  routeNodeIndex: -1,
  rejoinRouteIndex: -1,
  pathCursor: 0,
  plannedNodeIds: [],
  desiredSpeed: 0,
  targetPoint: { x: track.cx, y: track.cy },
  debugPathPoints: [],
  surface: {
    lateralGripMul: 1,
    longDragMul: 1,
    engineMul: 1,
    coastDecelMul: 1,
  },
  wheelLastPoints: null,
  prevForwardSpeed: null,
  particleEmitters: {
    smokeCooldown: 0,
    splashCooldown: 0,
    dustCooldown: 0,
  },
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
export const facebookLogo = new Image();
export let facebookLogoReady = false;

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

facebookLogo.addEventListener("load", () => {
  facebookLogoReady = true;
});
facebookLogo.addEventListener("error", () => {
  console.warn(
    "Failed to load facebook logo at assets/facebook-svgrepo-com.svg",
  );
});
facebookLogo.src = "assets/facebook-svgrepo-com.svg";

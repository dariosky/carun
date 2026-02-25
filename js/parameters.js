const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

export { canvas, ctx };

export const WIDTH = canvas.width;
export const HEIGHT = canvas.height;

const PLAYER_NAME_STORAGE_KEY = "carun.playerName";

export function sanitizePlayerName(raw) {
  if (typeof raw !== "string") return "PLAYER";
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim().slice(0, 12);
  return cleaned || "PLAYER";
}

export function loadPlayerName() {
  try {
    return sanitizePlayerName(localStorage.getItem(PLAYER_NAME_STORAGE_KEY));
  } catch {
    return "PLAYER";
  }
}

export function savePlayerName(name) {
  try {
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, sanitizePlayerName(name));
  } catch {
    // Ignore storage failures (private mode, blocked storage, etc.).
  }
}

export const menuItems = ["START RACE", "SETTINGS"];
export const settingsItems = ["PLAYER NAME", "BACK"];

export const track = {
  cx: WIDTH * 0.5,
  cy: HEIGHT * 0.53,
  outerA: 500,
  outerB: 265,
  innerA: 315,
  innerB: 145,
  warpOuter: [
    { f: 2, amp: 0.055, phase: 0.45 },
    { f: 3, amp: 0.038, phase: -0.7 },
    { f: 5, amp: 0.022, phase: 1.15 },
  ],
  warpInner: [
    { f: 2, amp: 0.04, phase: 0.7 },
    { f: 3, amp: 0.025, phase: -0.5 },
    { f: 5, amp: 0.015, phase: 1.4 },
  ],
  borderSize: 22,
};

export const checkpoints = [
  { angle: 0 },
  { angle: Math.PI * 0.5 },
  { angle: Math.PI },
  { angle: Math.PI * 1.5 },
];

export const CHECKPOINT_WIDTH_MULTIPLIER = 1.4;

export const worldObjects = [
  { type: "tree", x: 150, y: 150, r: 26 },
  { type: "tree", x: 1080, y: 136, r: 24 },
  { type: "tree", x: 172, y: 596, r: 23 },
  { type: "tree", x: 1110, y: 580, r: 22 },
  { type: "pond", x: 650, y: 350, rx: 95, ry: 52, seed: 0.8 },
  { type: "pond", x: 215, y: 340, rx: 60, ry: 34, seed: -0.55 },
  { type: "barrel", x: 447, y: 153, r: 13 },
  { type: "barrel", x: 847, y: 567, r: 13 },
];

export const CURB_MIN_WIDTH = 3;
export const CURB_MAX_WIDTH = 22;
export const CURB_STRIPE_LENGTH = 10;
export const CURB_OUTSET = 20;

export const physicsConfig = {
  car: {
    maxSpeed: 350,
    engineAccel: 800,
    brakeDecel: 1500,
    coastDecel: 320,
    longDrag: 0.85,
    lateralGrip: 6.4,
    steerRate: 3.6,
    steerAtLowSpeedMul: 0.35,
    yawDamping: 8.0,
    reverseMaxSpeedMul: 0.32,
    inputSmoothing: 0.2,
    dtClamp: 0.033,
  },
  assists: {
    autoDriftGripCut: 0.3,
    driftAssistRecoveryBoost: 0.75,
    driftAssistRecoveryTime: 0.2,
    speedSensitiveSteer: 0.55,
    handbrakeGrip: 0.28,
    handbrakeYawBoost: 0.8,
    handbrakeLongDecel: 1400,
  },
  surfaces: {
    asphalt: { lateralGripMul: 0.95, longDragMul: 1.0, engineMul: 1.0, coastDecelMul: 1.0 },
    curb: { lateralGripMul: 1.18, longDragMul: 1.02, engineMul: 1.0, coastDecelMul: 1.05 },
    grass: { lateralGripMul: 0.85, longDragMul: 4.0, engineMul: 0.24, coastDecelMul: 5.0 },
    water: { lateralGripMul: 0.14, longDragMul: 3.3, engineMul: 0.22, coastDecelMul: 2.8 },
  },
  flags: {
    AUTO_DRIFT_ON_STEER: true,
    DRIFT_ASSIST_RECOVERY: false,
    HANDBRAKE_MODE: true,
    SPEED_SENSITIVE_STEERING: true,
    SURFACE_BLENDING: true,
    DEBUG_VECTORS: true,
    ARCADE_COLLISION_PUSH: true,
  },
  constants: {
    surfaceBlendTime: 0.05,
    driftSteerThreshold: 0.08,
    lowSpeedSteerAt: 120,
    pivotAtLowSpeedRatio: 0.5,
    pivotFromRearRatio: 0.9,
    pivotBlendSpeed: 320,
  },
};

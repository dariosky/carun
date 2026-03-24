import {
  AI_OPPONENT_COUNT,
  AI_DRIVING_STYLE_POOL,
  AI_BUMP_NAME_POOL,
  AI_LONG_NAME_POOL,
  AI_OPPONENT_NAME_POOL,
  AI_PRECISE_NAME_POOL,
  CAR_COLOR_PALETTE,
  loadPlayerName,
  loadPlayerColor,
  physicsConfig,
  sanitizeCarColor,
  track,
} from "./parameters.js";
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
  tournamentLobbyIndex: 0,
  gameMode: "single",
  tournament: {
    selectedTrackIndices: new Set(),
    trackOrder: [],
    currentRaceIndex: 0,
    scores: {},
    raceResults: [],
  },
  tournamentRoom: {
    active: false,
    roomId: null,
    participantId: null,
    localSlotId: null,
    isHost: false,
    phase: "lobby",
    paused: false,
    pausedBy: null,
    status: "idle",
    tracks: [],
    slots: [],
    lastPlayerStateAt: 0,
    lastAiStateAt: 0,
    pendingSkidMarks: [],
    scores: {},
    raceResults: [],
    currentRaceIndex: 0,
    remoteStates: {},
  },
  playerName: loadPlayerName(),
  playerColor: loadPlayerColor(),
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
    finishOrders: { player: 0 },
  },
  aiRoster: [],
  raceReturn: {
    mode: "trackSelect",
    editorTrackIndex: null,
  },
  finishCelebration: {
    bestLap: false,
    bestRace: false,
    totalTime: 0,
    bestLapTime: 0,
    bestLapImprovementMs: null,
    bestRaceImprovementMs: null,
    previousBestLapMs: null,
    previousBestRaceMs: null,
    previousBestLapDisplayName: null,
    previousBestRaceDisplayName: null,
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
    roadMode: "segment",
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
    panMode: false,
    viewOffsetX: 0,
    viewOffsetY: 0,
    viewDragging: false,
    viewDragLastScreenX: 0,
    viewDragLastScreenY: 0,
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

function createLapProgressState() {
  return {
    currentLapStart: 0,
    lapTimes: [],
    maxLaps: 3,
    passed: new Set([0]),
    nextCheckpointIndex: 1,
    lap: 1,
    finished: false,
    finishTime: 0,
    finalPosition: 0,
  };
}

function createVehicleState({
  id = "vehicle",
  x = track.cx,
  y = track.cy + 205,
  label = "",
} = {}) {
  return {
    id,
    x,
    y,
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
    label,
  };
}

function createPhysicsRuntimeState() {
  return {
    input: { throttle: 0, brake: 0, steer: 0, handbrake: 0 },
    steeringRate: 0,
    driftAmount: 0,
    driftDirection: 0,
    driftRecoveryTimer: 0,
    recoveryTimer: 0,
    collisionGripTimer: 0,
    impactCooldown: 0,
    lastGroundedSpeed: 0,
    landingBouncePending: false,
    landingCooldown: 0,
    oilCarry: 0,
    oilCarryTime: 0,
    prevSteerAbs: 0,
    surface: {
      lateralGripMul: 1,
      longDragMul: 1,
      engineMul: 1,
      coastDecelMul: 1,
    },
    debug: {
      slipAngle: 0,
      rearSlip: 0,
      yawAssist: 0,
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
}

function createAiPhysicsRuntimeState() {
  return {
    input: { throttle: 0, brake: 0, steer: 0, handbrake: 0 },
    steeringRate: 0,
    driftAmount: 0,
    driftDirection: 0,
    driftRecoveryTimer: 0,
    recoveryTimer: 0,
    collisionGripTimer: 0,
    impactCooldown: 0,
    prevSteerAbs: 0,
    lastGroundedSpeed: 0,
    landingBouncePending: false,
    landingCooldown: 0,
    oilCarry: 0,
    oilCarryTime: 0,
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
    debug: {
      slipAngle: 0,
      rearSlip: 0,
      yawAssist: 0,
      surface: "asphalt",
      vForward: 0,
      vLateral: 0,
      pivotX: track.cx,
      pivotY: track.cy,
      z: 0,
      vz: 0,
    },
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
}

export function getAiLabel(index) {
  return `AI ${index + 1}`;
}

function shuffleArray(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickUniqueNames(pool, count, usedNames) {
  const names = [];
  const shuffled = shuffleArray(pool);
  for (const candidate of shuffled) {
    if (usedNames.has(candidate)) continue;
    names.push(candidate);
    usedNames.add(candidate);
    if (names.length >= count) break;
  }
  if (names.length >= count) return names;

  const fallback = shuffleArray(AI_OPPONENT_NAME_POOL);
  for (const candidate of fallback) {
    if (usedNames.has(candidate)) continue;
    names.push(candidate);
    usedNames.add(candidate);
    if (names.length >= count) break;
  }
  return names;
}

function syncAiRosterToCars() {
  aiCars.forEach((vehicle, index) => {
    vehicle.label = state.aiRoster[index]?.name || getAiLabel(index);
  });
}

function pickRivalColorIds(count, blockedColorId, shuffle = false) {
  const pool = CAR_COLOR_PALETTE.map((option) => option.id).filter(
    (colorId) => colorId !== sanitizeCarColor(blockedColorId),
  );
  const orderedPool = shuffle ? shuffleArray(pool) : pool;
  return Array.from(
    { length: count },
    (_, index) => orderedPool[index % orderedPool.length],
  );
}

function normalizeAiColorIds(profiles, fallbackColors, blockedColorId) {
  const blocked = sanitizeCarColor(blockedColorId);
  const availableColors = CAR_COLOR_PALETTE.map((option) => option.id).filter(
    (colorId) => colorId !== blocked,
  );
  const used = new Set();

  return profiles.map((profile, index) => {
    const requested = sanitizeCarColor(profile?.color, fallbackColors[index]);
    if (!used.has(requested) && requested !== blocked) {
      used.add(requested);
      return requested;
    }
    const fallback =
      availableColors.find((colorId) => !used.has(colorId)) ||
      fallbackColors[index] ||
      availableColors[index % availableColors.length];
    used.add(fallback);
    return fallback;
  });
}

function getConfiguredAiOpponentCount() {
  const configured = Number(physicsConfig.flags.AI_OPPONENT_COUNT);
  if (!Number.isFinite(configured)) return 0;
  return Math.max(0, Math.min(AI_OPPONENT_COUNT, Math.round(configured)));
}

export function getActiveAiOpponentCount() {
  return Math.max(0, Math.min(aiCars.length, state.aiRoster.length));
}

export function getActiveAiCars() {
  return aiCars.slice(0, getActiveAiOpponentCount());
}

export function getActiveAiLapDataList() {
  return aiLapDataList.slice(0, getActiveAiOpponentCount());
}

export function getActiveAiPhysicsRuntimes() {
  return aiPhysicsRuntimes.slice(0, getActiveAiOpponentCount());
}

export function assignAiRoster(profiles = null) {
  const rosterProfiles = Array.isArray(profiles) ? profiles : [];
  const rosterSize = Array.isArray(profiles)
    ? Math.max(0, Math.min(AI_OPPONENT_COUNT, rosterProfiles.length))
    : getConfiguredAiOpponentCount();
  const fallbackColors = pickRivalColorIds(rosterSize, state.playerColor);
  const normalizedColors = normalizeAiColorIds(
    rosterProfiles,
    fallbackColors,
    state.playerColor,
  );
  state.aiRoster = Array.from({ length: rosterSize }, (_, index) => {
    const profile = rosterProfiles[index];
    const name = String(profile?.name || "").trim();
    const style = AI_DRIVING_STYLE_POOL.includes(profile?.style)
      ? profile.style
      : "precise";
    const topSpeedMul = Number.isFinite(profile?.topSpeedMul)
      ? Math.max(0.8, Math.min(1, Number(profile.topSpeedMul)))
      : 1;
    const laneOffset = Number.isFinite(profile?.laneOffset)
      ? Number(profile.laneOffset)
      : style === "long"
        ? 18
        : 0;
    return {
      id: `ai-${index + 1}`,
      name: name || getAiLabel(index),
      style,
      color: normalizedColors[index],
      topSpeedMul,
      laneOffset,
      kind: profile?.kind === "remoteHuman" ? "remoteHuman" : "ai",
      participantId:
        typeof profile?.participantId === "string"
          ? profile.participantId
          : null,
      slotId: typeof profile?.slotId === "string" ? profile.slotId : null,
      connected: profile?.connected === false ? false : true,
      externalControl: Boolean(profile?.externalControl),
    };
  });
  syncAiRosterToCars();
  return state.aiRoster;
}

export function assignRandomAiRoster() {
  const targetCount = getConfiguredAiOpponentCount();
  if (targetCount <= 0) return assignAiRoster([]);
  const usedNames = new Set();
  const maxBumpCount = Math.max(0, targetCount - 1);
  const bumpCount = Math.min(maxBumpCount, Math.random() < 0.5 ? 2 : 3);
  const longCount = Math.max(0, targetCount - 1 - bumpCount);
  const preciseNames = pickUniqueNames(AI_PRECISE_NAME_POOL, 1, usedNames);
  const bumpNames = pickUniqueNames(AI_BUMP_NAME_POOL, bumpCount, usedNames);
  const longNames = pickUniqueNames(AI_LONG_NAME_POOL, longCount, usedNames);

  const profiles = [
    {
      style: "precise",
      name: preciseNames[0] || getAiLabel(0),
      topSpeedMul: 1,
      laneOffset: 0,
    },
    ...bumpNames.map((name) => ({
      style: "bump",
      name,
      topSpeedMul: Number((0.8 + Math.random() * 0.2).toFixed(2)),
      laneOffset: 0,
    })),
    ...longNames.map((name) => {
      const laneSign = Math.random() < 0.5 ? -1 : 1;
      return {
        style: "long",
        name,
        topSpeedMul: Number((0.8 + Math.random() * 0.2).toFixed(2)),
        laneOffset: laneSign * (14 + Math.round(Math.random() * 8)),
      };
    }),
  ];
  const rivalColors = pickRivalColorIds(targetCount, state.playerColor, true);

  return assignAiRoster(
    shuffleArray(profiles).map((profile, index) => ({
      id: `ai-${index + 1}`,
      color: rivalColors[index],
      ...profile,
    })),
  );
}

export const lapData = createLapProgressState();

export const aiLapDataList = Array.from({ length: AI_OPPONENT_COUNT }, () =>
  createLapProgressState(),
);

export const car = createVehicleState({
  id: "player",
  x: track.cx,
  y: track.cy + 205,
});

export const aiCars = Array.from({ length: AI_OPPONENT_COUNT }, (_, index) =>
  createVehicleState({
    id: `ai-${index + 1}`,
    x: track.cx,
    y: track.cy + 170 - index * 6,
    label: getAiLabel(index),
  }),
);

export const aiCar = aiCars[0];
export const aiLapData = aiLapDataList[0];

export const physicsRuntime = createPhysicsRuntimeState();

export const aiPhysicsRuntimes = Array.from({ length: AI_OPPONENT_COUNT }, () =>
  createAiPhysicsRuntimeState(),
);

export const aiPhysicsRuntime = aiPhysicsRuntimes[0];

Object.assign(
  state.raceStandings.finishOrders,
  ...aiCars.map((vehicle) => ({
    [vehicle.id]: 0,
  })),
);
assignAiRoster();

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

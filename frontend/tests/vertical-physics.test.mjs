import test from "node:test";
import assert from "node:assert/strict";
import { aiWallJumpShortcutTrack } from "./fixtures/ai-wall-jump-shortcut-track.mjs";

function setupDomStubs() {
  const noop = () => {};
  const fakeCtx = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    lineWidth: 0,
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    save: noop,
    restore: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fillText: noop,
    measureText: (text) => ({ width: String(text).length * 10 }),
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    clip: noop,
    rect: noop,
    arc: noop,
    ellipse: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    drawImage: noop,
    roundRect: noop,
    quadraticCurveTo: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    setLineDash: noop,
    fill: noop,
  };
  const fakeCanvas = {
    width: 1280,
    height: 720,
    getContext: () => fakeCtx,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1280,
      height: 720,
    }),
  };
  globalThis.window = {
    location: { href: "http://localhost:8080/" },
    history: { replaceState: noop },
    addEventListener: noop,
  };
  globalThis.localStorage = {
    getItem: () => null,
    setItem: noop,
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

const {
  applyTrackPreset,
  AI_BUMP_NAME_POOL,
  AI_OPPONENT_NAME_POOL,
  AI_LONG_NAME_POOL,
  AI_PRECISE_NAME_POOL,
  checkpoints,
  getTrackPresetById,
  importTrackPresetData,
  physicsConfig,
  removeTrackPresetById,
  trackOptions,
  worldObjects,
} = await import("../js/parameters.js");
const {
  aiCar,
  aiCars,
  aiLapData,
  aiLapDataList,
  aiPhysicsRuntime,
  aiPhysicsRuntimes,
  assignAiRoster,
  assignRandomAiRoster,
  car,
  keys,
  lapData,
  physicsRuntime,
  skidMarks,
  state,
} = await import("../js/state.js");
const {
  applyExternalRivalState,
  buildFinishCelebrationStats,
  getExternalHumanRivalCount,
  getFinishCelebrationStandings,
  planTrackNavPath,
  resetRace,
  resolveCarToCarCollision,
  updateRace,
} = await import("../js/physics.js");
const { gameAudio } = await import("../js/game-audio.js");
const { ambientAnimals } = await import("../js/ambient-animals.js");
const {
  findNearestTrackNavNode,
  findSpringTrigger,
  getTrackNavigationGraph,
  pointOnCenterLine,
  pointInsideWallFootprint,
  resolveObjectCollisions,
  surfaceAt,
  trackFrameAtAngle,
} = await import("../js/track.js");

function getObjectByType(objects, type) {
  return objects.find((object) => object.type === type);
}

function enableAiOpponents() {
  physicsConfig.flags.AI_OPPONENTS_ENABLED = true;
  physicsConfig.flags.AI_OPPONENT_COUNT = aiCars.length;
  if (state.aiRoster.length !== aiCars.length) assignAiRoster();
}

function disableAiOpponents() {
  physicsConfig.flags.AI_OPPONENTS_ENABLED = false;
}

function makeTrackData() {
  return {
    cx: 640,
    cy: 360,
    borderSize: 22,
    centerlineHalfWidth: 60,
    centerlineWidthProfile: new Array(8).fill(60),
    centerlineSmoothingMode: "light",
    worldScale: 1,
    startAngle: 0,
    centerlineLoop: [
      { x: 260, y: 240 },
      { x: 450, y: 150 },
      { x: 850, y: 150 },
      { x: 1020, y: 280 },
      { x: 1020, y: 510 },
      { x: 840, y: 610 },
      { x: 430, y: 610 },
      { x: 250, y: 480 },
    ],
  };
}

function makeIntersectionTrackData() {
  return {
    cx: 640,
    cy: 360,
    borderSize: 22,
    centerlineHalfWidth: 58,
    centerlineWidthProfile: new Array(8).fill(58),
    centerlineSmoothingMode: "light",
    worldScale: 1,
    startAngle: 0,
    centerlineLoop: [
      { x: 340, y: 210 },
      { x: 560, y: 320 },
      { x: 870, y: 210 },
      { x: 760, y: 360 },
      { x: 870, y: 510 },
      { x: 560, y: 400 },
      { x: 340, y: 510 },
      { x: 450, y: 360 },
    ],
  };
}

function getPathSurfaceExposure(graph, pathNodeIds, samplesPerSegment = 10) {
  const counts = { grass: 0, water: 0, oil: 0 };
  for (let index = 0; index < pathNodeIds.length - 1; index++) {
    const fromNode = graph.nodes[pathNodeIds[index]];
    const toNode = graph.nodes[pathNodeIds[index + 1]];
    if (!fromNode || !toNode) continue;
    for (let step = 0; step <= samplesPerSegment; step++) {
      const t = step / samplesPerSegment;
      const x = fromNode.x + (toNode.x - fromNode.x) * t;
      const y = fromNode.y + (toNode.y - fromNode.y) * t;
      const surface = surfaceAt(x, y);
      if (surface === "grass" || surface === "water" || surface === "oil") counts[surface] += 1;
    }
  }
  return counts;
}

function makeSpringShortcutScenario(kind = "wall") {
  const trackData = makeTrackData();
  const frame = trackFrameAtAngle(Math.PI * 0.18, trackData);
  const objects = [
    {
      type: "spring",
      x: frame.point.x,
      y: frame.point.y,
      r: 20,
      angle: 0,
      height: 0.4,
    },
  ];
  if (kind === "wall") {
    objects.push({
      type: "wall",
      x: frame.point.x + frame.tangent.x * 70,
      y: frame.point.y + frame.tangent.y * 70,
      angle: Math.atan2(frame.tangent.y, frame.tangent.x) + Math.PI * 0.5,
      width: 18,
      length: 120,
      height: 2.5,
    });
  } else if (kind === "pond") {
    objects.push({
      type: "pond",
      x: frame.point.x + frame.tangent.x * 95,
      y: frame.point.y + frame.tangent.y * 95,
      rx: 70,
      ry: 42,
      angle: Math.atan2(frame.tangent.y, frame.tangent.x),
      seed: 0.2,
    });
  }
  return { trackData, objects };
}

function preparePlayerMotion({
  speed = 0,
  throttle = false,
  brake = false,
  left = false,
  right = false,
  handbrake = false,
} = {}) {
  disableAiOpponents();
  resetRace();
  state.startSequence.active = false;
  worldObjects.length = 0;
  skidMarks.length = 0;
  keys.accel = throttle;
  keys.brake = brake;
  keys.left = left;
  keys.right = right;
  keys.handbrake = handbrake;
  car.vx = Math.cos(car.angle) * speed;
  car.vy = Math.sin(car.angle) * speed;
  car.speed = speed;
  physicsRuntime.driftAmount = 0;
  physicsRuntime.driftDirection = 0;
  physicsRuntime.driftRecoveryTimer = 0;
  physicsRuntime.wheelLastPoints = null;
  physicsRuntime.prevForwardSpeed = null;
}

function absoluteAngleDelta(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

test("legacy world objects gain default heights and wall defaults", () => {
  const imported = importTrackPresetData({
    id: "vertical-legacy",
    name: "VERTICAL LEGACY",
    track: makeTrackData(),
    checkpoints: [],
    worldObjects: [
      { type: "tree", x: 100, y: 120, r: 24 },
      { type: "barrel", x: 140, y: 120, r: 12 },
      { type: "spring", x: 180, y: 120, r: 16 },
      { type: "wall", x: 220, y: 120 },
      { type: "oil", x: 260, y: 120 },
    ],
    centerlineStrokes: [],
    editStack: [],
  });

  const preset = getTrackPresetById(imported.id);
  const tree = getObjectByType(preset.worldObjects, "tree");
  const barrel = getObjectByType(preset.worldObjects, "barrel");
  const spring = getObjectByType(preset.worldObjects, "spring");
  const wall = getObjectByType(preset.worldObjects, "wall");
  const oil = getObjectByType(preset.worldObjects, "oil");

  assert.ok(tree);
  assert.ok(barrel);
  assert.ok(spring);
  assert.ok(wall);
  assert.ok(oil);

  assert.ok(Number.isFinite(tree.height) && tree.height > 0);
  assert.ok(Number.isFinite(barrel.height) && barrel.height > 0);
  assert.ok(Number.isFinite(spring.height) && spring.height > 0);
  assert.ok(Number.isFinite(wall.height) && wall.height > 0);
  assert.equal(wall.width, 18);
  assert.equal(wall.length, 90);
  assert.equal(oil.rx, 78);
  assert.equal(oil.ry, 44);

  removeTrackPresetById(imported.id);
});

test("resetRace rebuilds authored rooster actors and rooster hits apply blood carry", () => {
  const originalTrackId = trackOptions[0]?.id || null;
  const originalPlayAnimalSplash = gameAudio.playAnimalSplash;
  const splashCalls = [];
  const imported = importTrackPresetData({
    id: "vertical-rooster-hit",
    name: "VERTICAL ROOSTER HIT",
    track: makeTrackData(),
    checkpoints: [],
    worldObjects: [{ type: "animal", kind: "rooster", x: 648, y: 565, r: 12, angle: 0 }],
    centerlineStrokes: [],
    editStack: [],
  });
  assert.ok(imported);

  const trackIndex = trackOptions.findIndex((option) => option.id === imported.id);
  assert.ok(trackIndex >= 0);
  state.selectedTrackIndex = trackIndex;
  gameAudio.playAnimalSplash = (kind, intensity) => {
    splashCalls.push({ kind, intensity });
  };

  try {
    applyTrackPreset(trackIndex);
    resetRace();

    assert.equal(ambientAnimals.length, 1);
    assert.equal(ambientAnimals[0].kind, "rooster");
    state.startSequence.active = false;
    physicsConfig.flags.AI_OPPONENTS_ENABLED = false;
    car.x = ambientAnimals[0].x - 8;
    car.y = ambientAnimals[0].y;
    car.vx = 92;
    car.vy = 0;
    car.angle = 0;
    car.speed = 92;
    physicsRuntime.prevForwardSpeed = 92;

    updateRace(1 / 60);

    assert.equal(ambientAnimals[0].active, false);
    assert.ok(physicsRuntime.bloodCarry > 0.9);
    assert.equal(splashCalls.length, 1);
    assert.equal(splashCalls[0].kind, "rooster");
    assert.ok(splashCalls[0].intensity >= 0.55);
    const speedAfterHit = car.speed;

    updateRace(1 / 60);

    assert.ok(car.speed <= speedAfterHit);
    assert.ok(skidMarks.some((mark) => mark.color.includes("164, 14, 20")));
  } finally {
    gameAudio.playAnimalSplash = originalPlayAnimalSplash;
    removeTrackPresetById(imported.id);
    const restoreIndex = trackOptions.findIndex((option) => option.id === originalTrackId);
    state.selectedTrackIndex = restoreIndex >= 0 ? restoreIndex : 0;
    if (restoreIndex >= 0) applyTrackPreset(restoreIndex);
  }
});

test("sheep hits slow the car harder than rooster hits", () => {
  const originalTrackId = trackOptions[0]?.id || null;
  const originalPlayAnimalSplash = gameAudio.playAnimalSplash;
  const splashCalls = [];
  const imported = importTrackPresetData({
    id: "vertical-sheep-hit",
    name: "VERTICAL SHEEP HIT",
    track: makeTrackData(),
    checkpoints: [],
    worldObjects: [{ type: "animal", kind: "sheep", x: 648, y: 565, r: 30, angle: 0 }],
    centerlineStrokes: [],
    editStack: [],
  });
  assert.ok(imported);

  const trackIndex = trackOptions.findIndex((option) => option.id === imported.id);
  assert.ok(trackIndex >= 0);
  state.selectedTrackIndex = trackIndex;
  gameAudio.playAnimalSplash = (kind, intensity) => {
    splashCalls.push({ kind, intensity });
  };

  try {
    applyTrackPreset(trackIndex);
    resetRace();

    assert.equal(ambientAnimals.length, 1);
    assert.equal(ambientAnimals[0].kind, "sheep");
    state.startSequence.active = false;
    physicsConfig.flags.AI_OPPONENTS_ENABLED = false;
    car.x = ambientAnimals[0].x - 8;
    car.y = ambientAnimals[0].y;
    car.vx = 92;
    car.vy = 0;
    car.angle = 0;
    car.speed = 92;
    physicsRuntime.prevForwardSpeed = 92;

    updateRace(1 / 60);

    assert.equal(ambientAnimals[0].active, false);
    assert.ok(car.speed < 72);
    assert.ok(physicsRuntime.bloodCarry > 0.9);
    assert.equal(splashCalls.length, 1);
    assert.equal(splashCalls[0].kind, "sheep");
    assert.ok(splashCalls[0].intensity >= 0.55);
  } finally {
    gameAudio.playAnimalSplash = originalPlayAnimalSplash;
    removeTrackPresetById(imported.id);
    const restoreIndex = trackOptions.findIndex((option) => option.id === originalTrackId);
    state.selectedTrackIndex = restoreIndex >= 0 ? restoreIndex : 0;
    if (restoreIndex >= 0) applyTrackPreset(restoreIndex);
  }
});

test("bulls charge nearby cars on proximity alone", () => {
  const originalTrackId = trackOptions[0]?.id || null;
  const imported = importTrackPresetData({
    id: "vertical-bull-charge",
    name: "VERTICAL BULL CHARGE",
    track: makeTrackData(),
    checkpoints: [],
    worldObjects: [{ type: "animal", kind: "bull", x: 648, y: 565, r: 36, angle: 0 }],
    centerlineStrokes: [],
    editStack: [],
  });
  assert.ok(imported);

  const trackIndex = trackOptions.findIndex((option) => option.id === imported.id);
  assert.ok(trackIndex >= 0);
  state.selectedTrackIndex = trackIndex;

  try {
    applyTrackPreset(trackIndex);
    resetRace();

    assert.equal(ambientAnimals.length, 1);
    assert.equal(ambientAnimals[0].kind, "bull");
    state.startSequence.active = false;
    physicsConfig.flags.AI_OPPONENTS_ENABLED = false;
    car.x = ambientAnimals[0].x - 120;
    car.y = ambientAnimals[0].y;
    car.vx = 0;
    car.vy = 0;
    car.angle = 0;
    car.speed = 0;
    physicsRuntime.prevForwardSpeed = 0;

    updateRace(1 / 30);

    assert.equal(ambientAnimals[0].mode, "charge");
    assert.ok(ambientAnimals[0].targetSpeed >= 96);
  } finally {
    removeTrackPresetById(imported.id);
    const restoreIndex = trackOptions.findIndex((option) => option.id === originalTrackId);
    state.selectedTrackIndex = restoreIndex >= 0 ? restoreIndex : 0;
    if (restoreIndex >= 0) applyTrackPreset(restoreIndex);
  }
});

test("bull hits stay non-lethal and faster bulls knock the car back harder", () => {
  const originalTrackId = trackOptions[0]?.id || null;
  const originalPlayAnimalSplash = gameAudio.playAnimalSplash;
  const splashCalls = [];
  const imported = importTrackPresetData({
    id: "vertical-bull-hit",
    name: "VERTICAL BULL HIT",
    track: makeTrackData(),
    checkpoints: [],
    worldObjects: [{ type: "animal", kind: "bull", x: 648, y: 565, r: 36, angle: 0 }],
    centerlineStrokes: [],
    editStack: [],
  });
  assert.ok(imported);

  const trackIndex = trackOptions.findIndex((option) => option.id === imported.id);
  assert.ok(trackIndex >= 0);
  state.selectedTrackIndex = trackIndex;
  gameAudio.playAnimalSplash = (kind, intensity) => {
    splashCalls.push({ kind, intensity });
  };

  function runBullHit(bullSpeed) {
    applyTrackPreset(trackIndex);
    resetRace();
    state.startSequence.active = false;
    physicsConfig.flags.AI_OPPONENTS_ENABLED = false;
    const bull = ambientAnimals[0];
    bull.mode = "charge";
    bull.speed = bullSpeed;
    bull.targetSpeed = bullSpeed;
    bull.moveAngle = 0;
    bull.contactCooldown = 0;
    car.x = bull.x - 18;
    car.y = bull.y;
    car.vx = 72;
    car.vy = 0;
    car.angle = 0;
    car.speed = 72;
    physicsRuntime.prevForwardSpeed = 72;

    updateRace(1 / 60);

    return {
      vx: car.vx,
      vy: car.vy,
      bullActive: bull.active,
      bullMode: bull.mode,
      bullCooldown: bull.contactCooldown,
      bloodCarry: physicsRuntime.bloodCarry,
    };
  }

  try {
    const slowHit = runBullHit(18);
    const fastHit = runBullHit(92);

    assert.equal(slowHit.bullActive, true);
    assert.equal(fastHit.bullActive, true);
    assert.equal(splashCalls.length, 2);
    assert.equal(splashCalls[0]?.kind, "bull");
    assert.equal(splashCalls[1]?.kind, "bull");
    assert.ok(splashCalls[0]?.intensity >= 0.55);
    assert.ok(splashCalls[1]?.intensity >= 0.55);
    assert.equal(slowHit.bloodCarry, 0);
    assert.equal(fastHit.bloodCarry, 0);
    assert.ok(slowHit.bullCooldown > 0);
    assert.ok(fastHit.bullCooldown > 0);
    assert.equal(fastHit.bullMode, "recover");
    assert.ok(slowHit.vx < 0);
    assert.ok(fastHit.vx < slowHit.vx - 10);
    assert.ok(Math.abs(fastHit.vx) > Math.abs(slowHit.vx));
  } finally {
    gameAudio.playAnimalSplash = originalPlayAnimalSplash;
    removeTrackPresetById(imported.id);
    const restoreIndex = trackOptions.findIndex((option) => option.id === originalTrackId);
    state.selectedTrackIndex = restoreIndex >= 0 ? restoreIndex : 0;
    if (restoreIndex >= 0) applyTrackPreset(restoreIndex);
  }
});

test("legacy checkpoint angles migrate to editable progress checkpoints", () => {
  const originalTrackId = trackOptions[0]?.id || null;
  const imported = importTrackPresetData({
    id: "vertical-legacy-checkpoints",
    name: "VERTICAL LEGACY CHECKPOINTS",
    track: makeTrackData(),
    checkpoints: [
      { angle: 0 },
      { angle: Math.PI * 0.5 },
      { angle: Math.PI },
      { angle: Math.PI * 1.5 },
    ],
    worldObjects: [],
    centerlineStrokes: [],
    editStack: [],
  });

  const preset = getTrackPresetById(imported.id);
  assert.equal(preset.checkpoints.length, 3);
  assert.ok(
    preset.checkpoints.every(
      (checkpoint) => Number.isFinite(checkpoint.progress) && !Object.hasOwn(checkpoint, "angle"),
    ),
  );

  const trackIndex = trackOptions.findIndex((option) => option.id === imported.id);
  applyTrackPreset(trackIndex);
  assert.equal(checkpoints.length, 4);
  assert.equal(checkpoints[0].isStart, true);
  assert.ok(checkpoints.slice(1).every((checkpoint) => checkpoint.isStart === false));

  removeTrackPresetById(imported.id);
  const restoreIndex = trackOptions.findIndex((option) => option.id === originalTrackId);
  applyTrackPreset(restoreIndex >= 0 ? restoreIndex : 0);
});

test("height-aware collisions clear low obstacles and keep wall footprints solid", () => {
  const barrel = { type: "barrel", x: 300, y: 300, r: 14, height: 1 };
  const wall = {
    type: "wall",
    x: 420,
    y: 280,
    width: 18,
    length: 90,
    angle: Math.PI / 6,
    height: 2.5,
  };

  const grounded = resolveObjectCollisions(300, 300, 0, [barrel]);
  assert.equal(grounded.hit, true);

  const airborne = resolveObjectCollisions(300, 300, 1.5, [barrel]);
  assert.equal(airborne.hit, false);

  assert.equal(pointInsideWallFootprint(420, 280, wall), true);
  const wallHit = resolveObjectCollisions(420, 280, 0, [wall]);
  assert.equal(wallHit.hit, true);
  const wallClear = resolveObjectCollisions(420, 280, 3.1, [wall]);
  assert.equal(wallClear.hit, false);
});

test("spring detection returns only matching spring footprints", () => {
  const spring = { type: "spring", x: 240, y: 210, r: 18, height: 0.4 };
  assert.ok(findSpringTrigger(248, 214, [spring]));
  assert.equal(findSpringTrigger(280, 214, [spring]), null);
});

test("updateRace launches on spring and disables steering while airborne", () => {
  resetRace();
  state.startSequence.active = false;
  worldObjects.length = 0;
  worldObjects.push({
    type: "spring",
    x: car.x,
    y: car.y,
    r: 20,
    angle: 0,
    height: 0.4,
  });
  car.vx = Math.cos(car.angle) * 180;
  car.vy = Math.sin(car.angle) * 180;
  car.speed = 180;

  updateRace(0.016);
  assert.equal(car.airborne, true);
  assert.ok(car.vz > 0);
  const angleBefore = car.angle;

  keys.left = true;
  updateRace(0.016);
  keys.left = false;
  assert.equal(car.angle, angleBefore);
});

test("airborne player state reports flying surface instead of water", () => {
  resetRace();
  state.startSequence.active = false;
  worldObjects.length = 0;

  const audioCalls = [];
  const originalUpdateVehicleAudio = gameAudio.updateVehicleAudio;
  gameAudio.updateVehicleAudio = (params) => {
    audioCalls.push(params);
  };

  try {
    worldObjects.push({
      type: "pond",
      x: car.x,
      y: car.y,
      rx: 90,
      ry: 72,
      angle: 0,
      seed: 0.2,
    });
    worldObjects.push({
      type: "spring",
      x: car.x,
      y: car.y,
      r: 20,
      angle: 0,
      height: 0.4,
    });
    car.vx = Math.cos(car.angle) * 180;
    car.vy = Math.sin(car.angle) * 180;
    car.speed = 180;

    updateRace(0.016);

    assert.equal(car.airborne, true);
    assert.equal(physicsRuntime.debug.surface, "flying");
    assert.equal(audioCalls.at(-1)?.surface, "flying");
    assert.equal(audioCalls.at(-1)?.airborne, true);

    updateRace(0.016);

    assert.equal(car.airborne, true);
    assert.equal(physicsRuntime.debug.surface, "flying");
    assert.equal(audioCalls.at(-1)?.surface, "flying");
    assert.equal(audioCalls.at(-1)?.airborne, true);
  } finally {
    gameAudio.updateVehicleAudio = originalUpdateVehicleAudio;
  }
});

test("ai launches when it reaches a spring mid-frame and reports flying surface", () => {
  enableAiOpponents();
  resetRace();
  state.startSequence.active = false;
  worldObjects.length = 0;
  const audioCalls = [];
  const originalUpdateRivalVehicleAudio = gameAudio.updateRivalVehicleAudio;
  gameAudio.updateRivalVehicleAudio = (params) => {
    audioCalls.push(params);
  };

  try {
    const springDistance = 18;
    worldObjects.push({
      type: "spring",
      x: aiCar.x + Math.cos(aiCar.angle) * springDistance,
      y: aiCar.y + Math.sin(aiCar.angle) * springDistance,
      r: 16,
      angle: 0,
      height: 0.4,
    });
    aiCar.vx = Math.cos(aiCar.angle) * 220;
    aiCar.vy = Math.sin(aiCar.angle) * 220;
    aiCar.speed = 220;
    aiPhysicsRuntime.softResetCooldown = 99;

    updateRace(0.016);

    assert.equal(aiCar.airborne, true);
    assert.equal(aiPhysicsRuntime.debug.surface, "flying");
    assert.equal(audioCalls.at(-1)?.surface, "flying");
    assert.equal(audioCalls.at(-1)?.airborne, true);
  } finally {
    gameAudio.updateRivalVehicleAudio = originalUpdateRivalVehicleAudio;
  }
});

test("resetRace restores the selected preset world objects", () => {
  resetRace();
  const originalObjects = worldObjects.map((object) => ({ ...object }));

  worldObjects.length = 0;
  worldObjects.push({
    type: "pond",
    x: car.x,
    y: car.y,
    rx: 90,
    ry: 72,
    angle: 0,
    seed: 0.2,
  });
  worldObjects.push({
    type: "spring",
    x: car.x,
    y: car.y,
    r: 20,
    angle: 0,
    height: 0.4,
  });

  resetRace();

  assert.deepEqual(worldObjects, originalObjects);
});

test("resetRace spawns a five-car AI field with matching heading and lap state", () => {
  enableAiOpponents();
  resetRace();
  const graph = getTrackNavigationGraph();
  assert.equal(aiCars.length, 5);
  aiCars.forEach((vehicle, index) => {
    const lap = aiLapDataList[index];
    const runtime = aiPhysicsRuntimes[index];
    const nextCheckpointIndex = lap.nextCheckpointIndex;
    const goalNodeIds = graph.checkpointGoalNodeIds[nextCheckpointIndex]?.length
      ? graph.checkpointGoalNodeIds[nextCheckpointIndex]
      : graph.checkpointNodeIds[nextCheckpointIndex];
    const goalIndex = runtime.plannedNodeIds.findIndex((nodeId) => goalNodeIds.includes(nodeId));

    assert.equal(lap.lap, 1);
    assert.equal(lap.finished, false);
    assert.equal(vehicle.angle, car.angle);
    assert.ok(Math.hypot(vehicle.x - car.x, vehicle.y - car.y) > 20);
    assert.ok(runtime.plannedNodeIds.length > 3);
    assert.notEqual(runtime.targetNodeId, -1);
    assert.ok(goalIndex >= 0);
    assert.ok(goalIndex < runtime.plannedNodeIds.length - 1);
  });
});

test("random ai roster uses unique names from the configured pool", () => {
  physicsConfig.flags.AI_OPPONENT_COUNT = aiCars.length;
  state.playerColor = "sky";
  const roster = assignRandomAiRoster();
  const preciseDrivers = roster.filter((entry) => entry.style === "precise");
  const bumpDrivers = roster.filter((entry) => entry.style === "bump");
  const longDrivers = roster.filter((entry) => entry.style === "long");

  assert.equal(roster.length, aiCars.length);
  assert.equal(new Set(roster.map((entry) => entry.name)).size, aiCars.length);
  assert.ok(roster.every((entry) => AI_OPPONENT_NAME_POOL.includes(entry.name)));
  assert.equal(preciseDrivers.length, 1);
  assert.ok(bumpDrivers.length >= 2);
  assert.equal(longDrivers.length + bumpDrivers.length + preciseDrivers.length, aiCars.length);
  assert.equal(preciseDrivers[0].topSpeedMul, 1);
  assert.ok(preciseDrivers.every((entry) => AI_PRECISE_NAME_POOL.includes(entry.name)));
  assert.ok(bumpDrivers.every((entry) => AI_BUMP_NAME_POOL.includes(entry.name)));
  assert.ok(longDrivers.every((entry) => AI_LONG_NAME_POOL.includes(entry.name)));
  assert.ok(
    roster
      .filter((entry) => entry.style !== "precise")
      .every((entry) => entry.topSpeedMul >= 0.8 && entry.topSpeedMul <= 1),
  );
  assert.equal(new Set(roster.map((entry) => entry.color)).size, aiCars.length);
  assert.ok(roster.every((entry) => entry.color !== state.playerColor));
  assert.deepEqual(
    aiCars.map((vehicle) => vehicle.label),
    roster.map((entry) => entry.name),
  );
});

test("ai roster profiles propagate lane-offset styles into race runtime", () => {
  assignAiRoster([
    { name: "LONG ONE", style: "long", topSpeedMul: 0.82, laneOffset: 22 },
    { name: "PRECISE TWO", style: "precise", topSpeedMul: 1 },
    { name: "BUMP THREE", style: "bump", topSpeedMul: 0.9 },
    { name: "LONG FOUR", style: "long", topSpeedMul: 0.95, laneOffset: -18 },
    { name: "PRECISE FIVE", style: "precise", topSpeedMul: 0.88 },
  ]);
  enableAiOpponents();
  resetRace();

  assert.equal(aiCars[0].label, "LONG ONE");
  assert.equal(aiPhysicsRuntimes[0].targetLaneOffset, 22);
  assert.equal(aiPhysicsRuntimes[1].targetLaneOffset, 0);
  assert.equal(aiPhysicsRuntimes[3].targetLaneOffset, -18);
});

test("ai roster normalizes duplicate and player-conflicting colors", () => {
  state.playerColor = "sky";
  const roster = assignAiRoster([
    { name: "ONE", style: "precise", color: "sky" },
    { name: "TWO", style: "bump", color: "mint" },
    { name: "THREE", style: "long", color: "mint" },
    { name: "FOUR", style: "precise", color: "gold" },
    { name: "FIVE", style: "long", color: "gold" },
  ]);

  assert.equal(roster.length, 5);
  assert.ok(roster.every((entry) => entry.color !== "sky"));
  assert.equal(new Set(roster.map((entry) => entry.color)).size, roster.length);
});

test("external human rivals accept replicated lap state and stay counted until finished", () => {
  assignAiRoster([
    {
      name: "Remote One",
      style: "precise",
      topSpeedMul: 1,
      kind: "remoteHuman",
      externalControl: true,
      slotId: "slot-2",
      participantId: "guest-1",
    },
    { name: "AI Two", style: "long", topSpeedMul: 0.9, laneOffset: 18 },
    { name: "AI Three", style: "bump", topSpeedMul: 0.9 },
    { name: "AI Four", style: "precise", topSpeedMul: 1 },
    { name: "AI Five", style: "long", topSpeedMul: 0.88, laneOffset: -18 },
  ]);
  enableAiOpponents();
  resetRace();

  assert.equal(getExternalHumanRivalCount(), 1);

  applyExternalRivalState(0, {
    x: 480,
    y: 250,
    vx: 30,
    vy: 12,
    angle: 0.5,
    speed: 32,
    lap: 3,
    maxLaps: 3,
    lapTimes: [12.3, 11.7],
    passed: [0, 1, 2],
    nextCheckpointIndex: 0,
    finished: true,
    finishTime: 36.8,
    finalPosition: 2,
  });

  assert.equal(aiCars[0].x, 480);
  assert.equal(aiCars[0].y, 250);
  assert.equal(aiLapDataList[0].lap, 3);
  assert.equal(aiLapDataList[0].finished, true);
  assert.equal(state.raceStandings.finishOrders["ai-1"], 2);
  assert.equal(getExternalHumanRivalCount(), 0);

  assignRandomAiRoster();
  resetRace();
});

test("finish celebration stats report improvements against previous records", () => {
  const summary = buildFinishCelebrationStats({
    lapTimes: [32.5, 31.2, 30.4],
    selectedTrack: {
      bestLapMs: 31_000,
      bestRaceMs: 100_000,
      bestLapDisplayName: "LUNA",
      bestRaceDisplayName: "MARIO",
    },
  });

  assert.equal(summary.bestLap, true);
  assert.equal(summary.bestRace, true);
  assert.equal(summary.totalTime, 94.1);
  assert.equal(summary.bestLapTime, 30.4);
  assert.equal(summary.bestLapImprovementMs, 600);
  assert.equal(summary.bestRaceImprovementMs, 5900);
  assert.equal(summary.previousBestLapMs, 31_000);
  assert.equal(summary.previousBestRaceMs, 100_000);
  assert.equal(summary.previousBestLapDisplayName, "LUNA");
  assert.equal(summary.previousBestRaceDisplayName, "MARIO");
});

test("finish celebration standings focus on human racers when remote rivals are present", () => {
  physicsConfig.flags.AI_OPPONENTS_ENABLED = true;
  physicsConfig.flags.AI_OPPONENT_COUNT = 3;
  state.playerColor = "crimson";
  assignAiRoster([
    {
      name: "Remote One",
      style: "precise",
      kind: "remoteHuman",
      externalControl: true,
      color: "mint",
      slotId: "slot-2",
      participantId: "guest-1",
    },
    {
      name: "AI Two",
      style: "long",
      topSpeedMul: 0.92,
      laneOffset: 18,
      color: "gold",
    },
    { name: "AI Three", style: "bump", topSpeedMul: 0.9, color: "teal" },
  ]);
  resetRace();

  state.playerName = "PLAYER ONE";
  lapData.finished = true;
  lapData.finishTime = 50;
  lapData.finalPosition = 1;
  state.finished = true;
  state.raceStandings.playerFinishOrder = 1;
  state.raceStandings.finishOrders.player = 1;

  aiLapDataList[0].finished = true;
  aiLapDataList[0].finishTime = 53.4;
  aiLapDataList[0].finalPosition = 3;
  state.raceStandings.finishOrders["ai-1"] = 3;

  aiLapDataList[1].finished = true;
  aiLapDataList[1].finishTime = 51.1;
  aiLapDataList[1].finalPosition = 2;
  state.raceStandings.finishOrders["ai-2"] = 2;

  state.raceStandings.nextFinishOrder = 4;

  const summary = getFinishCelebrationStandings();

  assert.equal(summary.mode, "human");
  assert.equal(summary.totalRacers, 2);
  assert.equal(summary.finishedCount, 2);
  assert.deepEqual(
    summary.entries.map((entry) => entry.label),
    ["PLAYER ONE", "Remote One"],
  );
  assert.deepEqual(
    summary.entries.map((entry) => entry.position),
    [1, 2],
  );
  assert.deepEqual(
    summary.entries.map((entry) => entry.gapMs),
    [0, 3400],
  );
  assert.deepEqual(
    summary.entries.map((entry) => entry.accentColor),
    ["#d22525", "#66d987"],
  );

  assignRandomAiRoster();
  resetRace();
});

test("finish celebration standings keep unique accent colors for AI finishers", () => {
  physicsConfig.flags.AI_OPPONENTS_ENABLED = true;
  physicsConfig.flags.AI_OPPONENT_COUNT = 3;
  state.playerColor = "crimson";
  assignAiRoster([
    { name: "AI One", style: "precise", color: "mint" },
    { name: "AI Two", style: "long", laneOffset: 18, color: "gold" },
    { name: "AI Three", style: "bump", color: "teal" },
  ]);
  resetRace();

  lapData.finished = true;
  lapData.finishTime = 60;
  lapData.finalPosition = 1;
  state.finished = true;
  state.raceStandings.playerFinishOrder = 1;
  state.raceStandings.finishOrders.player = 1;

  aiLapDataList[0].finished = true;
  aiLapDataList[0].finishTime = 61;
  aiLapDataList[0].finalPosition = 2;
  state.raceStandings.finishOrders["ai-1"] = 2;

  aiLapDataList[1].finished = true;
  aiLapDataList[1].finishTime = 62.5;
  aiLapDataList[1].finalPosition = 3;
  state.raceStandings.finishOrders["ai-2"] = 3;

  aiLapDataList[2].finished = true;
  aiLapDataList[2].finishTime = 64;
  aiLapDataList[2].finalPosition = 4;
  state.raceStandings.finishOrders["ai-3"] = 4;
  state.raceStandings.nextFinishOrder = 5;

  const summary = getFinishCelebrationStandings();

  assert.equal(summary.mode, "all");
  assert.deepEqual(
    summary.entries.map((entry) => entry.accentColor),
    ["#d22525", "#66d987", "#ffd25e", "#34d1c6"],
  );
  assert.equal(new Set(summary.entries.map((entry) => entry.accentColor)).size, 4);

  assignRandomAiRoster();
  resetRace();
});

test("car-to-car collision separates overlapping racers and exchanges velocity", () => {
  const a = { x: 100, y: 100, vx: 40, vy: 0, width: 34, height: 20, speed: 40 };
  const b = {
    x: 108,
    y: 100,
    vx: -10,
    vy: 0,
    width: 34,
    height: 20,
    speed: 10,
  };

  const collided = resolveCarToCarCollision(a, b);

  assert.equal(collided, true);
  assert.ok(a.x < 100);
  assert.ok(b.x > 108);
  assert.ok(a.vx < 40);
  assert.ok(b.vx > -10);
});

test("track navigation graph exposes drivable nodes and checkpoint windows", () => {
  enableAiOpponents();
  resetRace();
  const graph = getTrackNavigationGraph();
  const nearestNode = findNearestTrackNavNode(car.x, car.y, {
    maxDistance: 120,
  });

  assert.ok(graph.nodes.length > 0);
  assert.ok(graph.bestLapRouteNodeIds.length > 12);
  assert.ok(graph.checkpointNodeIds.length >= 1);
  assert.ok(graph.checkpointNodeIds.every((nodeIds) => nodeIds.length > 0));
  assert.ok(nearestNode);
  assert.ok(Math.hypot(nearestNode.x - car.x, nearestNode.y - car.y) < 120);
});

test("ai replanning keeps the next unpassed checkpoint as the destination", () => {
  enableAiOpponents();
  resetRace();
  state.startSequence.active = false;
  const graph = getTrackNavigationGraph();
  const nextCheckpointIndex = aiLapData.nextCheckpointIndex;
  const goalNodeIds = graph.checkpointGoalNodeIds[nextCheckpointIndex]?.length
    ? graph.checkpointGoalNodeIds[nextCheckpointIndex]
    : graph.checkpointNodeIds[nextCheckpointIndex];
  aiCar.x += 26;
  aiCar.y -= 32;
  aiPhysicsRuntime.replanCooldown = 0;

  updateRace(0.016);

  const goalIndex = aiPhysicsRuntime.plannedNodeIds.findIndex((nodeId) =>
    goalNodeIds.includes(nodeId),
  );
  assert.equal(aiLapData.nextCheckpointIndex, nextCheckpointIndex);
  assert.ok(goalIndex >= 0);
  assert.ok(goalIndex < aiPhysicsRuntime.plannedNodeIds.length - 1);
});

test("planTrackNavPath prefers the branch that advances to the next checkpoint", () => {
  const graph = {
    nodes: [
      { id: 0, x: 0, y: 0, progress: 0.08 },
      { id: 1, x: 12, y: 0, progress: 0.16 },
      { id: 2, x: 24, y: 0, progress: 0.24 },
      { id: 3, x: 36, y: 0, progress: 0.32 },
      { id: 4, x: 6, y: 1, progress: 0.86 },
      { id: 5, x: 18, y: 1, progress: 0.94 },
    ],
    edges: [
      [
        { to: 1, cost: 20, step: 1, kind: "progress" },
        { to: 4, cost: 8, step: 10, kind: "junction" },
      ],
      [{ to: 2, cost: 20, step: 1, kind: "progress" }],
      [{ to: 3, cost: 20, step: 1, kind: "progress" }],
      [],
      [{ to: 5, cost: 8, step: 1, kind: "junction" }],
      [{ to: 3, cost: 8, step: 1, kind: "junction" }],
    ],
    averageSegmentLength: 12,
  };

  assert.deepEqual(planTrackNavPath(graph, 0, [3]), [0, 1, 2, 3]);
});

test("inner-loop checkpoint: AI enters loop, reaches checkpoint, and exits", () => {
  // Graph topology: a main line (0→1→2→3→4→5) with a side loop
  // branching at node 2 (junction to 6→7→8→back to 4).
  // The checkpoint (goal) is at node 7, inside the loop.
  // The optimal path enters the loop at 2, goes 6→7 (checkpoint), then
  // continues 7→8→4 to rejoin the main line.
  // It should NOT follow the entire main line 2→3→4→5 and skip the loop.
  //
  //  Main:     0 ──→ 1 ──→ 2 ──→ 3 ──→ 4 ──→ 5
  //                        ↓              ↑
  //  Loop:                 6 ──→ 7* ──→ 8 ┘
  //
  const speed = physicsConfig.ai.targetSpeedMax;
  const node = (id, x, y, progress) => ({
    id,
    x,
    y,
    progress,
    baseTargetSpeed: speed,
    surface: "asphalt",
    obstaclePenalty: 0,
    nearSpring: false,
  });
  const graph = {
    nodes: [
      node(0, 0, 0, 0.0),
      node(1, 40, 0, 0.1),
      node(2, 80, 0, 0.2), // branch point
      node(3, 120, 0, 0.3),
      node(4, 160, 0, 0.4), // rejoin point
      node(5, 200, 0, 0.5),
      node(6, 80, 40, 0.22), // loop entry
      node(7, 120, 40, 0.28), // CHECKPOINT (goal)
      node(8, 160, 40, 0.35), // loop exit
    ],
    edges: [
      /* 0 */ [{ to: 1, cost: 40, step: 1, kind: "progress" }],
      /* 1 */ [{ to: 2, cost: 40, step: 1, kind: "progress" }],
      /* 2 */ [
        { to: 3, cost: 40, step: 1, kind: "progress" },
        { to: 6, cost: 40, step: 2, kind: "junction" },
      ],
      /* 3 */ [{ to: 4, cost: 40, step: 1, kind: "progress" }],
      /* 4 */ [{ to: 5, cost: 40, step: 1, kind: "progress" }],
      /* 5 */ [],
      /* 6 */ [{ to: 7, cost: 40, step: 1, kind: "progress" }],
      /* 7 */ [{ to: 8, cost: 40, step: 1, kind: "progress" }],
      /* 8 */ [{ to: 4, cost: 40, step: 1, kind: "junction" }],
    ],
    averageSegmentLength: 40,
  };

  // Goal is node 7 (the checkpoint inside the loop)
  const path = planTrackNavPath(graph, 0, [7]);

  assert.ok(path.length > 0, "path should be found");
  // Must go through the loop: 0→1→2→6→7
  assert.ok(path.includes(6), "path must enter the loop (node 6)");
  assert.ok(path.includes(7), "path must reach the checkpoint (node 7)");
  // Must NOT include node 3 (the main-line node past the branch)
  assert.ok(!path.includes(3), "path should not follow the main line past the branch");
  assert.ok(!path.includes(5), "path should not continue to end of main line");
  assert.deepEqual(path, [0, 1, 2, 6, 7]);
});

test("time-based planner takes grass shortcut only when faster", () => {
  // Two paths from 0 to 2:
  //   Direct: 0 → 1(grass, 20px) → 2   — short but through grass
  //   Long:   0 → 3(asphalt, 80px) → 4(asphalt, 80px) → 2   — long but fast
  //
  // Grass equilibrium speed ≈ 0.153 × maxSpeed.
  // Direct time: 20 / (0.153 × 350) ≈ 0.37s
  // Long time: 160 / 350 ≈ 0.46s
  // → Grass shortcut is faster, planner should take it.
  const speed = physicsConfig.ai.targetSpeedMax;
  const node = (id, x, y, surface) => ({
    id,
    x,
    y,
    progress: id * 0.1,
    baseTargetSpeed: speed,
    surface,
    obstaclePenalty: 0,
    nearSpring: false,
  });
  const graph = {
    nodes: [
      node(0, 0, 0, "asphalt"),
      node(1, 10, 0, "grass"), // grass node
      node(2, 20, 0, "asphalt"),
      node(3, 0, 80, "asphalt"), // long way
      node(4, 20, 80, "asphalt"),
    ],
    edges: [
      /* 0 */ [
        { to: 1, cost: 10, step: 1, kind: "progress" },
        { to: 3, cost: 80, step: 1, kind: "progress" },
      ],
      /* 1 */ [{ to: 2, cost: 10, step: 1, kind: "progress" }],
      /* 2 */ [],
      /* 3 */ [{ to: 4, cost: 80, step: 1, kind: "progress" }],
      /* 4 */ [{ to: 2, cost: 80, step: 1, kind: "junction" }],
    ],
    averageSegmentLength: 20,
  };

  const path = planTrackNavPath(graph, 0, [2]);
  // The 20px grass shortcut is faster → planner takes the direct route
  assert.deepEqual(path, [0, 1, 2], "should take the short grass path when faster");
});

test("time-based planner avoids grass when asphalt route is faster", () => {
  // Two paths from 0 to 2:
  //   Direct: 0 → 1(grass, 200px) → 2   — long through grass
  //   Detour: 0 → 3(asphalt, 60px) → 4(asphalt, 60px) → 2   — moderate on asphalt
  //
  // Grass time: 200 / (0.153 × 350) ≈ 3.73s
  // Asphalt time: 120 / 350 ≈ 0.34s
  // → Asphalt is massively faster.
  const speed = physicsConfig.ai.targetSpeedMax;
  const node = (id, x, y, surface) => ({
    id,
    x,
    y,
    progress: id * 0.1,
    baseTargetSpeed: speed,
    surface,
    obstaclePenalty: 0,
    nearSpring: false,
  });
  const graph = {
    nodes: [
      node(0, 0, 0, "asphalt"),
      node(1, 100, 0, "grass"),
      node(2, 200, 0, "asphalt"),
      node(3, 30, 60, "asphalt"),
      node(4, 170, 60, "asphalt"),
    ],
    edges: [
      /* 0 */ [
        { to: 1, cost: 100, step: 1, kind: "progress" },
        { to: 3, cost: 60, step: 1, kind: "progress" },
      ],
      /* 1 */ [{ to: 2, cost: 100, step: 1, kind: "progress" }],
      /* 2 */ [],
      /* 3 */ [{ to: 4, cost: 60, step: 1, kind: "progress" }],
      /* 4 */ [{ to: 2, cost: 60, step: 1, kind: "junction" }],
    ],
    averageSegmentLength: 60,
  };

  const path = planTrackNavPath(graph, 0, [2]);
  // Asphalt detour is faster → planner avoids the grass
  assert.deepEqual(path, [0, 3, 4, 2], "should avoid long grass when asphalt is faster");
});

test("AI reverses out of a completed loop instead of repeating it", () => {
  // After hitting a checkpoint inside a loop, the AI is past it and needs
  // to reach the next checkpoint on the main section.  Backward edges let
  // the AI reverse to the junction instead of going all the way around.
  //
  //  Main:     0 ──→ 1 ──→ 2 ──→ 3(goal)
  //                  ↑      ↓
  //  Loop:           5 ←── 4    (AI is here at node 4, past the old checkpoint)
  //
  // Forward-only: 4→5 is not connected to 1 (no shortcut), so the AI
  // would need edges 4→…→loop…→1→2→3.
  // With backward edges: 4→(backward)→2→3.
  const speed = physicsConfig.ai.targetSpeedMax;
  const node = (id, x, y, progress) => ({
    id,
    x,
    y,
    progress,
    baseTargetSpeed: speed,
    surface: "asphalt",
    obstaclePenalty: 0,
    nearSpring: false,
  });
  const graph = {
    nodes: [
      node(0, 0, 0, 0.0),
      node(1, 40, 0, 0.1), // junction point
      node(2, 80, 0, 0.2), // junction point (loop exit / backward target)
      node(3, 120, 0, 0.3), // GOAL (next checkpoint)
      node(4, 80, 40, 0.25), // inside loop, past old checkpoint — AI starts here
      node(5, 40, 40, 0.15), // loop node
    ],
    edges: [
      /* 0 */ [{ to: 1, cost: 40, step: 1, kind: "progress" }],
      /* 1 */ [
        { to: 2, cost: 40, step: 1, kind: "progress" },
        { to: 5, cost: 40, step: 2, kind: "junction" },
      ],
      /* 2 */ [
        { to: 3, cost: 40, step: 1, kind: "progress" },
        { to: 4, cost: 40, step: 2, kind: "junction" },
      ],
      /* 3 */ [],
      /* 4 */ [
        { to: 5, cost: 40, step: 1, kind: "progress" },
        { to: 2, cost: 40, step: -1, kind: "backward" }, // backward to junction
      ],
      /* 5 */ [{ to: 1, cost: 40, step: 2, kind: "junction" }],
    ],
    averageSegmentLength: 40,
  };

  const path = planTrackNavPath(graph, 4, [3]);

  assert.ok(path.length > 0, "path should be found");
  // With backward edge: 4 → 2 (backward) → 3.  Only 3 nodes.
  // Without backward: 4 → 5 → 1 → 2 → 3.  5 nodes + more time.
  assert.deepEqual(path, [4, 2, 3], "should reverse to junction then go forward");
});

test("track navigation graph adds junction links for intersecting layouts", () => {
  const graph = getTrackNavigationGraph(makeIntersectionTrackData(), []);
  const junctionEdges = graph.edges.flat().filter((edge) => edge.kind === "junction");

  assert.ok(graph.nodes.length > 0);
  assert.ok(junctionEdges.length > 0);
  assert.ok(junctionEdges.some((edge) => edge.step >= physicsConfig.ai.navIntersectionMinSliceGap));
});

test("track navigation graph adds jump edges that clear blocking walls near springs", () => {
  const { trackData, objects } = makeSpringShortcutScenario("wall");
  const graph = getTrackNavigationGraph(trackData, objects);
  const jumpEdges = graph.edges.flat().filter((edge) => edge.kind === "jump");

  assert.ok(jumpEdges.length > 0);
  assert.ok(jumpEdges.some((edge) => edge.obstacleBypassed));
  assert.ok(jumpEdges.some((edge) => !Number.isFinite(edge.groundAlternativeCost)));
});

test("planTrackNavPath uses a spring jump route to cross a wall shortcut", () => {
  const { trackData, objects } = makeSpringShortcutScenario("wall");
  const graph = getTrackNavigationGraph(trackData, objects);
  const springNode = graph.nodes.find((node) =>
    graph.edges[node.id].some((edge) => edge.kind === "jump"),
  );
  const jumpEdge = graph.edges[springNode.id].find((edge) => edge.kind === "jump");
  const fartherGoal = graph.nodes.find(
    (node) =>
      node.sliceIndex >= graph.nodes[jumpEdge.to].sliceIndex + 3 &&
      (node.surface === "asphalt" || node.surface === "curb"),
  );
  const path = planTrackNavPath(graph, springNode.id, [fartherGoal.id]);
  const kinds = path
    .map((nodeId, index) =>
      index < path.length - 1
        ? graph.edges[nodeId].find((edge) => edge.to === path[index + 1])?.kind
        : null,
    )
    .filter(Boolean);

  assert.equal(kinds[0], "jump");
  assert.ok(kinds.includes("progress"));
});

test("planTrackNavPath uses a spring jump to skip a penalty pond when faster", () => {
  const { trackData, objects } = makeSpringShortcutScenario("pond");
  const graph = getTrackNavigationGraph(trackData, objects);
  const springNode = graph.nodes.find((node) =>
    graph.edges[node.id].some((edge) => edge.kind === "jump"),
  );
  const jumpEdge = graph.edges[springNode.id].find((edge) => edge.kind === "jump");
  const fartherGoal = graph.nodes.find(
    (node) =>
      node.sliceIndex >= graph.nodes[jumpEdge.to].sliceIndex + 3 &&
      (node.surface === "asphalt" || node.surface === "curb"),
  );
  const path = planTrackNavPath(graph, springNode.id, [fartherGoal.id]);
  const kinds = path
    .map((nodeId, index) =>
      index < path.length - 1
        ? graph.edges[nodeId].find((edge) => edge.to === path[index + 1])?.kind
        : null,
    )
    .filter(Boolean);

  assert.ok(jumpEdge.penaltySurfaceDistance > 60);
  assert.ok(jumpEdge.benefitCost > physicsConfig.ai.jumpMinBenefitCost);
  assert.equal(kinds[0], "jump");
});

test("checkpoint planning uses the wall-clearing jump on coarse spring spacing", () => {
  const originalTrackId = trackOptions[0]?.id || null;
  const imported = importTrackPresetData(
    {
      id: "vertical-wall-jump-regression",
      name: "VERTICAL WALL JUMP REGRESSION",
      track: aiWallJumpShortcutTrack.track,
      checkpoints: aiWallJumpShortcutTrack.checkpoints,
      worldObjects: aiWallJumpShortcutTrack.worldObjects,
      centerlineStrokes: [],
      editStack: [],
    },
    { persist: false },
  );

  try {
    const trackIndex = trackOptions.findIndex((option) => option.id === imported.id);
    applyTrackPreset(trackIndex);

    const graph = getTrackNavigationGraph();
    const jumpEdges = graph.edges.flat().filter((edge) => edge.kind === "jump");
    const goalNodeIds = graph.checkpointGoalNodeIds[2] || [];
    const approachNodes = graph.nodes.filter(
      (node) =>
        node.progress > 0.12 &&
        node.progress < 0.18 &&
        (node.surface === "asphalt" || node.surface === "curb"),
    );

    let jumpRoute = null;
    for (const node of approachNodes) {
      const path = planTrackNavPath(graph, node.id, goalNodeIds);
      const kinds = path
        .map((nodeId, index) =>
          index < path.length - 1
            ? graph.edges[nodeId].find((edge) => edge.to === path[index + 1])?.kind
            : null,
        )
        .filter(Boolean);
      if (kinds.includes("jump")) {
        jumpRoute = { nodeId: node.id, kinds };
        break;
      }
    }

    assert.ok(jumpEdges.length > 0, "expected jump edges on the spring section");
    assert.ok(
      jumpEdges.some((edge) => edge.obstacleBypassed),
      "expected a jump edge that clears the wall line",
    );
    assert.ok(jumpRoute, "expected checkpoint routing to use the jump shortcut");
    assert.ok(
      jumpRoute.kinds.slice(0, 4).includes("jump"),
      `expected the jump to appear early in the route, got ${jumpRoute.kinds.join(" -> ")}`,
    );
  } finally {
    removeTrackPresetById(imported.id);
    const restoreIndex = trackOptions.findIndex((option) => option.id === originalTrackId);
    applyTrackPreset(restoreIndex >= 0 ? restoreIndex : 0);
  }
});

test("checkpoint path planning avoids off-road shortcuts when a dry route exists", () => {
  enableAiOpponents();
  resetRace();
  const graph = getTrackNavigationGraph();
  const goalNodeIds = graph.checkpointGoalNodeIds[0];
  let worstExposure = null;

  for (const node of graph.nodes) {
    if (node.surface !== "asphalt" && node.surface !== "curb") continue;
    if (!(graph.edges[node.id] || []).length) continue;
    const path = planTrackNavPath(graph, node.id, goalNodeIds);
    if (path.length <= 10) continue;
    const exposure = getPathSurfaceExposure(graph, path);
    const totalExposure = exposure.grass + exposure.water + exposure.oil;
    if (!worstExposure || totalExposure > worstExposure.totalExposure) {
      worstExposure = { nodeId: node.id, exposure, totalExposure, path };
    }
  }

  assert.ok(worstExposure);
  // Time-based planner may route through small water/grass sections when the
  // shortcut is genuinely faster.  Ensure exposure stays moderate — large
  // detours through penalty surfaces should never be chosen.
  assert.ok(
    worstExposure.exposure.water <= 16,
    `water exposure ${worstExposure.exposure.water} exceeds 16`,
  );
  assert.ok(
    worstExposure.totalExposure <= 44,
    `total off-road exposure ${worstExposure.totalExposure} exceeds 44`,
  );
});

test("track navigation graph keeps water nodes available as expensive shortcuts", () => {
  const originalTrackId = trackOptions[0]?.id || null;
  const trackData = makeTrackData();
  const waterFrame = trackFrameAtAngle(Math.PI * 0.5, trackData);
  const imported = importTrackPresetData({
    id: "vertical-water-shortcut",
    name: "VERTICAL WATER SHORTCUT",
    track: trackData,
    checkpoints: [
      { angle: 0 },
      { angle: Math.PI * 0.5 },
      { angle: Math.PI },
      { angle: Math.PI * 1.5 },
    ],
    worldObjects: [
      {
        type: "pond",
        x: waterFrame.point.x,
        y: waterFrame.point.y,
        rx: 56,
        ry: 48,
        angle: 0,
        seed: 0.2,
      },
    ],
    centerlineStrokes: [],
    editStack: [],
  });

  try {
    const trackIndex = trackOptions.findIndex((option) => option.id === imported.id);
    state.selectedTrackIndex = trackIndex;
    applyTrackPreset(trackIndex);
    const graph = getTrackNavigationGraph();
    const waterNodeCount = graph.nodes.filter((node) => node.surface === "water").length;
    const connectedWaterNodeCount = graph.nodes.filter(
      (node) =>
        node.surface === "water" &&
        ((graph.edges[node.id] || []).length > 0 ||
          graph.edges.some((edges) => edges.some((edge) => edge.to === node.id))),
    ).length;

    assert.ok(waterNodeCount > 0);
    assert.ok(connectedWaterNodeCount > 0);
  } finally {
    removeTrackPresetById(imported.id);
    const restoreIndex = trackOptions.findIndex((option) => option.id === originalTrackId);
    state.selectedTrackIndex = restoreIndex >= 0 ? restoreIndex : 0;
    applyTrackPreset(restoreIndex >= 0 ? restoreIndex : 0);
  }
});

test("track navigation graph keeps oil nodes available as expensive shortcuts", () => {
  const originalTrackId = trackOptions[0]?.id || null;
  const trackData = makeTrackData();
  const oilFrame = trackFrameAtAngle(Math.PI * 0.32, trackData);
  const imported = importTrackPresetData({
    id: "vertical-oil-shortcut",
    name: "VERTICAL OIL SHORTCUT",
    track: trackData,
    checkpoints: [
      { angle: 0 },
      { angle: Math.PI * 0.5 },
      { angle: Math.PI },
      { angle: Math.PI * 1.5 },
    ],
    worldObjects: [
      {
        type: "oil",
        x: oilFrame.point.x,
        y: oilFrame.point.y,
        rx: 58,
        ry: 42,
        angle: 0,
        seed: -0.15,
      },
    ],
    centerlineStrokes: [],
    editStack: [],
  });

  try {
    const trackIndex = trackOptions.findIndex((option) => option.id === imported.id);
    state.selectedTrackIndex = trackIndex;
    applyTrackPreset(trackIndex);
    const graph = getTrackNavigationGraph();
    const oilNodeCount = graph.nodes.filter((node) => node.surface === "oil").length;
    const connectedOilNodeCount = graph.nodes.filter(
      (node) =>
        node.surface === "oil" &&
        ((graph.edges[node.id] || []).length > 0 ||
          graph.edges.some((edges) => edges.some((edge) => edge.to === node.id))),
    ).length;

    assert.ok(oilNodeCount > 0);
    assert.ok(connectedOilNodeCount > 0);
  } finally {
    removeTrackPresetById(imported.id);
    const restoreIndex = trackOptions.findIndex((option) => option.id === originalTrackId);
    state.selectedTrackIndex = restoreIndex >= 0 ? restoreIndex : 0;
    applyTrackPreset(restoreIndex >= 0 ? restoreIndex : 0);
  }
});

test("best lap route keeps clearance from placed road obstacles", () => {
  enableAiOpponents();
  resetRace();
  const obstaclePoint = pointOnCenterLine(Math.PI * 0.5);
  worldObjects.push({
    type: "barrel",
    x: obstaclePoint.x,
    y: obstaclePoint.y,
    r: 18,
  });

  const graph = getTrackNavigationGraph();
  const bestRouteDistance = graph.bestLapRouteNodeIds.reduce((best, nodeId) => {
    const node = graph.nodes[nodeId];
    return Math.min(best, Math.hypot(node.x - obstaclePoint.x, node.y - obstaclePoint.y));
  }, Infinity);

  worldObjects.pop();
  assert.ok(bestRouteDistance > physicsConfig.ai.obstacleHardClearance + 6);
});

test("ai recovery gets an off-road rival unstuck without entering water", () => {
  enableAiOpponents();
  resetRace();
  state.startSequence.active = false;
  worldObjects.length = 0;
  aiCar.x = 60;
  aiCar.y = 60;
  aiCar.vx = 0;
  aiCar.vy = 0;
  aiCar.speed = 0;

  for (let i = 0; i < 320; i++) {
    updateRace(0.016);
  }

  const nearestNode = findNearestTrackNavNode(aiCar.x, aiCar.y);
  const surface = surfaceAt(aiCar.x, aiCar.y);

  assert.ok(nearestNode);
  assert.ok(Math.hypot(aiCar.x - 60, aiCar.y - 60) > 80);
  assert.ok(aiCar.speed > 20);
  assert.notEqual(surface, "water");
});

test("ai uses the same grass slowdown and skid pipeline as the player", () => {
  enableAiOpponents();
  resetRace();
  state.startSequence.active = false;
  worldObjects.length = 0;
  skidMarks.length = 0;
  aiCar.x = 60;
  aiCar.y = 60;
  aiCar.angle = 0;
  aiCar.vx = 310;
  aiCar.vy = 0;
  aiCar.speed = 310;
  // Prevent soft-reset teleporting the AI back to the track.
  aiPhysicsRuntime.softResetCooldown = 99;
  // Pre-set the surface blend to grass values so the drag/engine multipliers
  // are already active from the first frame (surface blending is gradual).
  aiPhysicsRuntime.surface.lateralGripMul = 0.88;
  aiPhysicsRuntime.surface.longDragMul = 2.35;
  aiPhysicsRuntime.surface.engineMul = 0.36;
  aiPhysicsRuntime.surface.coastDecelMul = 2.6;

  const initialSpeed = aiCar.speed;
  for (let i = 0; i < 20; i++) {
    updateRace(0.016);
  }

  assert.equal(surfaceAt(aiCar.x, aiCar.y), "grass");
  assert.ok(aiPhysicsRuntime.surface.engineMul < 1);
  assert.ok(aiPhysicsRuntime.surface.longDragMul > 1);
  assert.ok(aiCar.speed < initialSpeed);
  assert.ok(skidMarks.length > 0);
});

test("heavy steering at speed builds player drift state and rear slip", () => {
  preparePlayerMotion({ speed: 230, right: true, throttle: true });
  const initialAngle = car.angle;

  for (let i = 0; i < 18; i++) {
    updateRace(0.016);
  }
  const travelAngle = Math.atan2(car.vy, car.vx);

  assert.ok(physicsRuntime.driftAmount > 0.35);
  assert.ok(Math.abs(physicsRuntime.debug.rearSlip) > 20);
  assert.ok(absoluteAngleDelta(travelAngle, car.angle) > 0.12);
  assert.ok(Math.abs(car.angle - initialAngle) > 0.12);
});

test("lift-off corner entry can still initiate drift without handbrake", () => {
  preparePlayerMotion({ speed: 245, right: true });
  for (let i = 0; i < 18; i++) {
    updateRace(0.016);
  }

  assert.ok(physicsRuntime.driftAmount > 0.18);
  assert.ok(Math.abs(physicsRuntime.debug.rearSlip) > 6);
  assert.equal(keys.handbrake, false);
});

test("handbrake drift rotates harder, slows the car, and creates skids", () => {
  preparePlayerMotion({ speed: 220, right: true });
  const baselineAngle = car.angle;
  for (let i = 0; i < 14; i++) {
    updateRace(0.016);
  }
  const noHandbrakeAngleDelta = Math.abs(car.angle - baselineAngle);
  const noHandbrakeTravelDelta = absoluteAngleDelta(Math.atan2(car.vy, car.vx), car.angle);
  const noHandbrakeSpeed = car.speed;

  preparePlayerMotion({ speed: 220, right: true, handbrake: true });
  const handbrakeAngle = car.angle;
  for (let i = 0; i < 14; i++) {
    updateRace(0.016);
  }

  assert.ok(Math.abs(car.angle - handbrakeAngle) > noHandbrakeAngleDelta + 0.04);
  assert.ok(
    absoluteAngleDelta(Math.atan2(car.vy, car.vx), car.angle) > noHandbrakeTravelDelta + 0.06,
  );
  assert.ok(car.speed < noHandbrakeSpeed - 10);
  assert.ok(skidMarks.length > 0);
});

test("drift recovery is gradual after steering release", () => {
  preparePlayerMotion({ speed: 235, right: true });
  for (let i = 0; i < 16; i++) {
    updateRace(0.016);
  }
  const engagedDrift = physicsRuntime.driftAmount;

  keys.right = false;
  updateRace(0.016);
  const immediateRecovery = physicsRuntime.driftAmount;

  for (let i = 0; i < 10; i++) {
    updateRace(0.016);
  }

  assert.ok(engagedDrift > 0.18);
  assert.ok(immediateRecovery > 0.04);
  assert.ok(immediateRecovery < engagedDrift);
  assert.ok(physicsRuntime.driftAmount < immediateRecovery);
});

test("straight-line driving stays stable and does not build drift state", () => {
  preparePlayerMotion({ speed: 220 });
  const initialAngle = car.angle;

  for (let i = 0; i < 30; i++) {
    updateRace(0.016);
  }

  assert.ok(physicsRuntime.driftAmount < 0.03);
  assert.ok(Math.abs(physicsRuntime.debug.vLateral) < 6);
  assert.ok(absoluteAngleDelta(Math.atan2(car.vy, car.vx), car.angle) < 0.03);
  assert.ok(Math.abs(car.angle - initialAngle) < 0.01);
});

test("oil surface keeps straight travel but resists steering bite", () => {
  preparePlayerMotion({ speed: 190, right: true });
  for (let i = 0; i < 14; i++) {
    updateRace(0.016);
  }
  const asphaltBodyTurn = absoluteAngleDelta(car.angle, Math.PI);
  const asphaltTravelTurn = absoluteAngleDelta(Math.atan2(car.vy, car.vx), Math.PI);
  const asphaltSlip = absoluteAngleDelta(Math.atan2(car.vy, car.vx), car.angle);

  preparePlayerMotion({ speed: 190, right: true });
  worldObjects.push({
    type: "oil",
    x: car.x,
    y: car.y,
    rx: 140,
    ry: 92,
    angle: car.angle,
    seed: 0.15,
  });
  assert.equal(surfaceAt(car.x, car.y), "oil");

  for (let i = 0; i < 14; i++) {
    updateRace(0.016);
  }

  const oilBodyTurn = absoluteAngleDelta(car.angle, Math.PI);
  const oilTravelTurn = absoluteAngleDelta(Math.atan2(car.vy, car.vx), Math.PI);
  const oilSlip = absoluteAngleDelta(Math.atan2(car.vy, car.vx), car.angle);

  assert.ok(oilBodyTurn > 0.08);
  assert.ok(oilSlip > asphaltSlip + 0.14);
  assert.ok(oilTravelTurn < asphaltTravelTurn - 0.04);
});

test("oil carry persists off the patch, decays over time, and leaves black marks", () => {
  preparePlayerMotion({ speed: 175 });
  worldObjects.push({
    type: "oil",
    x: car.x,
    y: car.y,
    rx: 96,
    ry: 72,
    angle: 0,
    seed: -0.2,
  });

  updateRace(0.016);
  assert.ok(physicsRuntime.oilCarry > 0.99);

  worldObjects.length = 0;
  const marksBeforeExit = skidMarks.length;
  updateRace(0.016);

  assert.ok(physicsRuntime.oilCarry < 1);
  assert.ok(physicsRuntime.oilCarry > 0.95);
  assert.ok(skidMarks.slice(marksBeforeExit).some((mark) => mark.color === "rgba(6, 6, 6, 0.92)"));

  for (let i = 0; i < 190; i++) {
    updateRace(0.016);
  }

  assert.ok(physicsRuntime.oilCarry < 0.02);
});

test("water and grass clear oily wheels immediately", () => {
  preparePlayerMotion({ speed: 160 });
  worldObjects.push({
    type: "oil",
    x: car.x,
    y: car.y,
    rx: 88,
    ry: 68,
    angle: 0,
    seed: 0.12,
  });

  updateRace(0.016);
  assert.ok(physicsRuntime.oilCarry > 0.99);

  worldObjects.length = 0;
  worldObjects.push({
    type: "pond",
    x: car.x,
    y: car.y,
    rx: 90,
    ry: 70,
    angle: 0,
    seed: -0.1,
  });
  updateRace(0.016);
  assert.equal(surfaceAt(car.x, car.y), "water");
  assert.equal(physicsRuntime.oilCarry, 0);
  assert.equal(physicsRuntime.oilCarryTime, 0);

  worldObjects.length = 0;
  preparePlayerMotion({ speed: 160 });
  worldObjects.push({
    type: "oil",
    x: car.x,
    y: car.y,
    rx: 88,
    ry: 68,
    angle: 0,
    seed: 0.18,
  });
  updateRace(0.016);
  assert.ok(physicsRuntime.oilCarry > 0.99);

  worldObjects.length = 0;
  const frame = trackFrameAtAngle(Math.PI * 0.2);
  const grassOffset = frame.roadWidth * 0.72;
  car.x = frame.point.x + frame.normal.x * grassOffset;
  car.y = frame.point.y + frame.normal.y * grassOffset;
  updateRace(0.016);
  assert.equal(surfaceAt(car.x, car.y), "grass");
  assert.equal(physicsRuntime.oilCarry, 0);
  assert.equal(physicsRuntime.oilCarryTime, 0);
});

test("ai does not reverse-recover just for touching shortcut grass near its planned path", () => {
  enableAiOpponents();
  resetRace();
  state.startSequence.active = false;
  worldObjects.length = 0;
  const frame = trackFrameAtAngle(Math.PI * 0.2);
  const grassOffset = frame.roadWidth * 0.62;
  aiCar.x = frame.point.x + frame.normal.x * grassOffset;
  aiCar.y = frame.point.y + frame.normal.y * grassOffset;
  aiCar.angle = Math.atan2(frame.tangent.y, frame.tangent.x);
  aiCar.vx = frame.tangent.x * 120;
  aiCar.vy = frame.tangent.y * 120;
  aiCar.speed = 120;
  aiPhysicsRuntime.mode = "race";
  assert.equal(surfaceAt(aiCar.x, aiCar.y), "grass");

  for (let i = 0; i < 40; i++) {
    updateRace(0.016);
  }

  assert.equal(aiPhysicsRuntime.mode, "race");
  assert.ok(aiPhysicsRuntime.input.brake < 0.9);
});

test("race clock keeps running after the player finishes if ai racers are still active", () => {
  enableAiOpponents();
  resetRace();
  state.startSequence.active = false;
  state.finished = true;
  lapData.finished = true;
  lapData.finalPosition = 1;
  state.raceStandings.playerFinishOrder = 1;
  state.raceStandings.finishOrders.player = 1;
  aiLapDataList[0].finished = false;
  const before = state.raceTime;

  updateRace(0.016);

  assert.ok(state.raceTime > before);
});

test("spring launches stay within the tuned apex and airborne frames do not draw skid bridges", () => {
  disableAiOpponents();
  resetRace();
  state.startSequence.active = false;
  worldObjects.length = 0;
  skidMarks.length = 0;
  worldObjects.push({
    type: "spring",
    x: car.x,
    y: car.y,
    r: 20,
    angle: 0,
    height: 0.4,
  });
  car.vx = Math.cos(car.angle) * 220;
  car.vy = Math.sin(car.angle) * 220;
  car.speed = 220;

  updateRace(0.016);
  assert.equal(car.airborne, true);
  assert.ok(car.vz > 0);
  assert.equal(skidMarks.length, 0);
  assert.ok(car.vz <= Math.sqrt(2 * physicsConfig.air.gravity * physicsConfig.air.maxJumpHeight));

  updateRace(0.016);
  assert.equal(skidMarks.length, 0);
  assert.equal(physicsRuntime.wheelLastPoints, null);
});

test("landing bounce happens once before final settle", () => {
  resetRace();
  state.startSequence.active = false;
  worldObjects.length = 0;
  skidMarks.length = 0;
  car.airborne = true;
  car.z = 0.05;
  car.vz = -3.2;
  car.visualScale = 1.05;
  physicsRuntime.landingBouncePending = true;

  updateRace(0.016);
  assert.equal(car.airborne, true);
  assert.ok(car.vz > 0);
  assert.equal(physicsRuntime.landingBouncePending, false);
  assert.ok(skidMarks.length > 0);
  assert.equal(physicsRuntime.wheelLastPoints, null);

  car.z = 0.02;
  car.vz = -2.2;
  updateRace(0.016);
  assert.equal(car.airborne, false);
  assert.equal(car.z, 0);
  assert.equal(car.vz, 0);
  assert.equal(car.visualScale, 1);
  assert.ok(physicsRuntime.wheelLastPoints);
});

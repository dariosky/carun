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
  getExternalHumanRivalCount,
  getRacePosition,
  getRaceStandings,
  planTrackNavPath,
  resetRace,
  resolveCarToCarCollision,
  updateRace,
} = await import("../js/physics.js");
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
    ],
    centerlineStrokes: [],
    editStack: [],
  });

  const preset = getTrackPresetById(imported.id);
  const tree = getObjectByType(preset.worldObjects, "tree");
  const barrel = getObjectByType(preset.worldObjects, "barrel");
  const spring = getObjectByType(preset.worldObjects, "spring");
  const wall = getObjectByType(preset.worldObjects, "wall");

  assert.ok(tree);
  assert.ok(barrel);
  assert.ok(spring);
  assert.ok(wall);

  assert.ok(Number.isFinite(tree.height) && tree.height > 0);
  assert.ok(Number.isFinite(barrel.height) && barrel.height > 0);
  assert.ok(Number.isFinite(spring.height) && spring.height > 0);
  assert.ok(Number.isFinite(wall.height) && wall.height > 0);
  assert.equal(wall.width, 18);
  assert.equal(wall.length, 90);

  removeTrackPresetById(imported.id);
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
      (checkpoint) =>
        Number.isFinite(checkpoint.progress) &&
        !Object.hasOwn(checkpoint, "angle"),
    ),
  );

  const trackIndex = trackOptions.findIndex(
    (option) => option.id === imported.id,
  );
  applyTrackPreset(trackIndex);
  assert.equal(checkpoints.length, 4);
  assert.equal(checkpoints[0].isStart, true);
  assert.ok(
    checkpoints.slice(1).every((checkpoint) => checkpoint.isStart === false),
  );

  removeTrackPresetById(imported.id);
  const restoreIndex = trackOptions.findIndex(
    (option) => option.id === originalTrackId,
  );
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
    const goalIndex = runtime.plannedNodeIds.findIndex((nodeId) =>
      goalNodeIds.includes(nodeId),
    );

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
  const roster = assignRandomAiRoster();
  const preciseDrivers = roster.filter((entry) => entry.style === "precise");
  const bumpDrivers = roster.filter((entry) => entry.style === "bump");
  const longDrivers = roster.filter((entry) => entry.style === "long");

  assert.equal(roster.length, aiCars.length);
  assert.equal(new Set(roster.map((entry) => entry.name)).size, aiCars.length);
  assert.ok(
    roster.every((entry) => AI_OPPONENT_NAME_POOL.includes(entry.name)),
  );
  assert.equal(preciseDrivers.length, 1);
  assert.ok(bumpDrivers.length >= 2);
  assert.equal(
    longDrivers.length + bumpDrivers.length + preciseDrivers.length,
    aiCars.length,
  );
  assert.equal(preciseDrivers[0].topSpeedMul, 1);
  assert.ok(
    preciseDrivers.every((entry) => AI_PRECISE_NAME_POOL.includes(entry.name)),
  );
  assert.ok(
    bumpDrivers.every((entry) => AI_BUMP_NAME_POOL.includes(entry.name)),
  );
  assert.ok(
    longDrivers.every((entry) => AI_LONG_NAME_POOL.includes(entry.name)),
  );
  assert.ok(
    roster
      .filter((entry) => entry.style !== "precise")
      .every((entry) => entry.topSpeedMul >= 0.8 && entry.topSpeedMul <= 1),
  );
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

test("planTrackNavPath prefers the shortest branch even when loop progress is tempting", () => {
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

  assert.deepEqual(planTrackNavPath(graph, 0, [3]), [0, 4, 5, 3]);
});

test("track navigation graph adds junction links for intersecting layouts", () => {
  const graph = getTrackNavigationGraph(makeIntersectionTrackData(), []);
  const junctionEdges = graph.edges
    .flat()
    .filter((edge) => edge.kind === "junction");

  assert.ok(graph.nodes.length > 0);
  assert.ok(junctionEdges.length > 0);
  assert.ok(
    junctionEdges.some(
      (edge) => edge.step >= physicsConfig.ai.navIntersectionMinSliceGap,
    ),
  );
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
    return Math.min(
      best,
      Math.hypot(node.x - obstaclePoint.x, node.y - obstaclePoint.y),
    );
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

test("race standings rank completed laps ahead of local checkpoint position", () => {
  enableAiOpponents();
  resetRace();
  lapData.lap = 2;
  aiLapData.lap = 1;
  car.x = 120;
  car.y = 120;
  aiCar.x = 640;
  aiCar.y = 360;

  assert.equal(getRacePosition("player"), 1);
  assert.ok(getRacePosition("ai") > 1);
});

test("finish order stays locked once a racer completes the race", () => {
  enableAiOpponents();
  resetRace();
  lapData.finished = true;
  lapData.finishTime = 92;
  lapData.finalPosition = 1;
  state.finished = true;
  state.raceStandings.playerFinishOrder = 1;
  state.raceStandings.finishOrders.player = 1;
  state.raceStandings.finishOrders["ai-1"] = 0;
  state.raceStandings.nextFinishOrder = 2;
  aiLapData.finished = false;
  aiLapData.lap = 3;
  aiCar.x = 900;
  aiCar.y = 220;

  assert.equal(getRacePosition("player"), 1);
  assert.ok(getRacePosition("ai") > 1);

  aiLapData.finished = true;
  aiLapData.finishTime = 97;
  aiLapData.finalPosition = 2;
  state.raceStandings.finishOrders["ai-1"] = 2;

  const standings = getRaceStandings();
  assert.equal(standings[0].id, "player");
  assert.ok(standings.some((entry) => entry.id === "ai-1"));
  assert.equal(getRacePosition("player"), 1);
});

test("finished racers keep their final position while others continue racing", () => {
  enableAiOpponents();
  resetRace();

  lapData.finished = true;
  lapData.finishTime = 90;
  lapData.finalPosition = 2;
  state.raceStandings.playerFinishOrder = 2;
  state.raceStandings.finishOrders.player = 2;

  aiLapDataList[1].finished = true;
  aiLapDataList[1].finishTime = 84;
  aiLapDataList[1].finalPosition = 1;
  state.raceStandings.finishOrders["ai-2"] = 1;
  state.raceStandings.nextFinishOrder = 3;

  aiCars[0].x = 1000;
  aiCars[0].y = 200;
  aiCars[2].x = 1040;
  aiCars[2].y = 220;
  aiCars[3].x = 1080;
  aiCars[3].y = 240;
  aiCars[4].x = 1120;
  aiCars[4].y = 260;

  assert.equal(getRacePosition("ai-2"), 1);
  assert.equal(getRacePosition("player"), 2);

  aiCars[0].x = 400;
  aiCars[0].y = 650;
  aiCars[2].x = 1180;
  aiCars[2].y = 80;
  aiCars[3].x = 640;
  aiCars[3].y = 120;
  aiCars[4].x = 220;
  aiCars[4].y = 620;

  assert.equal(getRacePosition("ai-2"), 1);
  assert.equal(getRacePosition("player"), 2);
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

test("race standings include the full five-ai field", () => {
  enableAiOpponents();
  resetRace();

  const standings = getRaceStandings();

  assert.equal(standings.length, 6);
  assert.deepEqual(standings.map((entry) => entry.id).sort(), [
    "ai-1",
    "ai-2",
    "ai-3",
    "ai-4",
    "ai-5",
    "player",
  ]);
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
  assert.ok(
    car.vz <=
      Math.sqrt(
        2 * physicsConfig.air.gravity * physicsConfig.air.maxJumpHeight,
      ),
  );

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

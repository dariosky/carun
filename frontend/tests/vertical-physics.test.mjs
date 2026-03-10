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
  getTrackPresetById,
  importTrackPresetData,
  physicsConfig,
  removeTrackPresetById,
  worldObjects,
} = await import("../js/parameters.js");
const {
  aiCar,
  aiLapData,
  aiPhysicsRuntime,
  car,
  keys,
  lapData,
  physicsRuntime,
  skidMarks,
  state,
} = await import("../js/state.js");
const {
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

test("resetRace spawns an AI rival with matching heading and lap state", () => {
  enableAiOpponents();
  resetRace();
  const graph = getTrackNavigationGraph();
  const nextCheckpointIndex = aiLapData.nextCheckpointIndex;
  const goalNodeIds = graph.checkpointGoalNodeIds[nextCheckpointIndex]?.length
    ? graph.checkpointGoalNodeIds[nextCheckpointIndex]
    : graph.checkpointNodeIds[nextCheckpointIndex];
  const goalIndex = aiPhysicsRuntime.plannedNodeIds.findIndex((nodeId) =>
    goalNodeIds.includes(nodeId),
  );

  assert.equal(aiLapData.lap, 1);
  assert.equal(aiLapData.finished, false);
  assert.equal(aiCar.angle, car.angle);
  assert.ok(Math.hypot(aiCar.x - car.x, aiCar.y - car.y) > 20);
  assert.ok(aiPhysicsRuntime.plannedNodeIds.length > 3);
  assert.notEqual(aiPhysicsRuntime.targetNodeId, -1);
  assert.ok(goalIndex >= 0);
  assert.ok(goalIndex < aiPhysicsRuntime.plannedNodeIds.length - 1);
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
  aiCar.vx = 180;
  aiCar.vy = 95;
  aiCar.speed = Math.hypot(aiCar.vx, aiCar.vy);

  const initialSpeed = aiCar.speed;
  for (let i = 0; i < 8; i++) {
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
  assert.equal(getRacePosition("ai"), 2);
});

test("finish order stays locked once a racer completes the race", () => {
  enableAiOpponents();
  resetRace();
  lapData.finished = true;
  lapData.finishTime = 92;
  state.finished = true;
  state.raceStandings.playerFinishOrder = 1;
  state.raceStandings.aiFinishOrder = 0;
  state.raceStandings.nextFinishOrder = 2;
  aiLapData.finished = false;
  aiLapData.lap = 3;
  aiCar.x = 900;
  aiCar.y = 220;

  assert.equal(getRacePosition("player"), 1);
  assert.equal(getRacePosition("ai"), 2);

  aiLapData.finished = true;
  aiLapData.finishTime = 97;
  state.raceStandings.aiFinishOrder = 2;

  const standings = getRaceStandings();
  assert.deepEqual(
    standings.map((entry) => entry.id),
    ["player", "ai"],
  );
  assert.equal(getRacePosition("player"), 1);
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

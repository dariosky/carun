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
const { car, keys, physicsRuntime, skidMarks, state } =
  await import("../js/state.js");
const { resetRace, updateRace } = await import("../js/physics.js");
const { findSpringTrigger, pointInsideWallFootprint, resolveObjectCollisions } =
  await import("../js/track.js");

function getObjectByType(objects, type) {
  return objects.find((object) => object.type === type);
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

test("spring launches stay within the tuned apex and airborne frames do not draw skid bridges", () => {
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

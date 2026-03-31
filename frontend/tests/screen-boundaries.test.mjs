import test from "node:test";
import assert from "node:assert/strict";
import { setupFrontendTestEnv } from "./helpers/frontend-test-env.mjs";

setupFrontendTestEnv();

const { HEIGHT, WIDTH, physicsConfig } = await import("../js/parameters.js");
const { aiCars, assignAiRoster, car, keys, state } = await import("../js/state.js");
const { resetRace, updateRace } = await import("../js/physics.js");

function setRaceInputsInactive() {
  keys.accel = false;
  keys.brake = false;
  keys.left = false;
  keys.right = false;
  keys.handbrake = false;
}

function prepareRace({ aiOpponents = false } = {}) {
  physicsConfig.flags.AI_OPPONENTS_ENABLED = aiOpponents;
  physicsConfig.flags.AI_OPPONENT_COUNT = aiCars.length;
  if (aiOpponents && state.aiRoster.length !== aiCars.length) assignAiRoster();
  resetRace();
  state.startSequence.active = false;
  state.finished = false;
  setRaceInputsInactive();
}

function getVehicleScreenExtents(vehicle) {
  const cfg = physicsConfig.carToCar;
  const halfLength = Math.max(1, vehicle.width * cfg.bodyLengthMul * 0.5);
  const halfWidth = Math.max(1, vehicle.height * cfg.bodyWidthMul * 0.5);
  const forwardX = Math.cos(vehicle.angle);
  const forwardY = Math.sin(vehicle.angle);
  const rightX = -forwardY;
  const rightY = forwardX;
  const xRadius = Math.abs(forwardX) * halfLength + Math.abs(rightX) * halfWidth;
  const yRadius = Math.abs(forwardY) * halfLength + Math.abs(rightY) * halfWidth;
  return {
    minX: vehicle.x - xRadius,
    maxX: vehicle.x + xRadius,
    minY: vehicle.y - yRadius,
    maxY: vehicle.y + yRadius,
  };
}

function assertVehicleInsideScreen(vehicle) {
  const extents = getVehicleScreenExtents(vehicle);
  const epsilon = 1e-6;
  assert.ok(extents.minX >= -epsilon, `expected left edge ${extents.minX} to stay on-screen`);
  assert.ok(
    extents.maxX <= WIDTH + epsilon,
    `expected right edge ${extents.maxX} to stay on-screen`,
  );
  assert.ok(extents.minY >= -epsilon, `expected top edge ${extents.minY} to stay on-screen`);
  assert.ok(
    extents.maxY <= HEIGHT + epsilon,
    `expected bottom edge ${extents.maxY} to stay on-screen`,
  );
}

test("player car is clamped against the left screen boundary", () => {
  prepareRace();
  car.angle = Math.PI * 0.31;
  const { minX } = getVehicleScreenExtents(car);
  car.x -= minX - 10;
  car.y = HEIGHT * 0.5;
  car.vx = -260;
  car.vy = -20;
  car.speed = Math.hypot(car.vx, car.vy);

  updateRace(0.1);

  assertVehicleInsideScreen(car);
});

test("airborne player car is clamped against the right screen boundary", () => {
  prepareRace();
  car.angle = Math.PI * 0.12;
  const { maxX } = getVehicleScreenExtents(car);
  car.x += WIDTH - maxX + 14;
  car.y = HEIGHT * 0.45;
  car.vx = 240;
  car.vy = 12;
  car.speed = Math.hypot(car.vx, car.vy);
  car.z = 18;
  car.vz = 0;
  car.airborne = true;
  car.airTime = 0.2;

  updateRace(0.1);

  assertVehicleInsideScreen(car);
  assert.ok(car.vx <= 1e-6, `expected right-wall clamp to cancel outward vx, got ${car.vx}`);
});

test("ai rivals are clamped against the bottom screen boundary", () => {
  prepareRace({ aiOpponents: true });
  const aiCar = aiCars[0];
  aiCar.angle = Math.PI * 0.5;
  const { maxY } = getVehicleScreenExtents(aiCar);
  aiCar.x = WIDTH * 0.5;
  aiCar.y += HEIGHT - maxY + 18;
  aiCar.vx = 0;
  aiCar.vy = 220;
  aiCar.speed = Math.hypot(aiCar.vx, aiCar.vy);

  updateRace(0.1);

  assertVehicleInsideScreen(aiCar);
  assert.ok(aiCar.vy <= 1e-6, `expected bottom-wall clamp to cancel outward vy, got ${aiCar.vy}`);
});

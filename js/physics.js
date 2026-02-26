import { CHECKPOINT_WIDTH_MULTIPLIER, physicsConfig, checkpoints, track } from "./parameters.js";
import { car, keys, lapData, physicsRuntime, skidMarks, state } from "./state.js";
import { clamp, moveTowards } from "./utils.js";
import { pointOnCenterLine, resolveObjectCollisions, surfaceAt, trackFrameAtAngle } from "./track.js";

function smoothInputValue(current, target, dt) {
  const smoothing = physicsConfig.car.inputSmoothing;
  const response = clamp((1 - smoothing) * dt * 60, 0, 1);
  return current + (target - current) * response;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const abLenSq = Math.max(abx * abx + aby * aby, 1e-8);
  const apx = px - ax;
  const apy = py - ay;
  const t = clamp((apx * abx + apy * aby) / abLenSq, 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function angularDistance(a, b) {
  let d = Math.abs(a - b);
  while (d > Math.PI * 2) d -= Math.PI * 2;
  return Math.min(d, Math.PI * 2 - d);
}

function getStartCheckpointIndex() {
  const startAngle = Math.PI * 0.5;
  let bestIdx = 0;
  let bestDiff = Infinity;
  checkpoints.forEach((cp, idx) => {
    const diff = angularDistance(cp.angle, startAngle);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

function wheelWorldPoints() {
  const forwardX = Math.cos(car.angle);
  const forwardY = Math.sin(car.angle);
  const rightX = -forwardY;
  const rightY = forwardX;
  const frontOffset = car.width * 0.36;
  const rearOffset = -car.width * 0.34;
  const sideOffset = car.height * 0.43;
  const localOffsets = [
    { x: frontOffset, y: -sideOffset },
    { x: frontOffset, y: sideOffset },
    { x: rearOffset, y: -sideOffset },
    { x: rearOffset, y: sideOffset },
  ];

  return localOffsets.map((o) => ({
    x: car.x + forwardX * o.x + rightX * o.y,
    y: car.y + forwardY * o.x + rightY * o.y,
  }));
}

function recordSkids(surfaceName, forwardSpeed, lateralSpeed, longAccel) {
  const points = wheelWorldPoints();
  const lastPoints = physicsRuntime.wheelLastPoints;
  physicsRuntime.wheelLastPoints = points;
  if (!lastPoints) return;

  const isGrass = surfaceName === "grass";
  const isWater = surfaceName === "water";
  const isRoad = surfaceName === "asphalt" || surfaceName === "curb";
  const speedAbs = Math.abs(forwardSpeed);
  if (!isGrass && !isWater && speedAbs < 8 && Math.abs(lateralSpeed) < 8) return;
  const strongAccel = longAccel > 480;
  const strongBrake = longAccel < -520;
  const skidding = Math.abs(lateralSpeed) > 95;
  const handbrakeSkid = physicsRuntime.input.handbrake > 0.08 && speedAbs > 24;
  const shouldDrawRoadSkids = isRoad && (strongAccel || strongBrake || skidding || handbrakeSkid);
  if (!isGrass && !isWater && !shouldDrawRoadSkids) return;

  const color = isGrass
    ? "rgba(112, 74, 44, 0.40)"
    : isWater
      ? "rgba(245, 250, 255, 0.42)"
      : "rgba(20, 20, 20, 0.37)";
  const width = isGrass || isWater ? 2.7 : 2.2;

  for (let i = 0; i < points.length; i++) {
    skidMarks.push({
      x1: lastPoints[i].x,
      y1: lastPoints[i].y,
      x2: points[i].x,
      y2: points[i].y,
      color,
      width,
    });
  }
}

export function resetRace() {
  const spawnAngle = Math.PI * 0.5;
  const spawnPoint = pointOnCenterLine(spawnAngle, track);
  const aheadPoint = pointOnCenterLine(spawnAngle + 0.02, track);
  car.x = spawnPoint.x;
  car.y = spawnPoint.y;
  car.vx = 0;
  car.vy = 0;
  car.angle = Math.atan2(aheadPoint.y - spawnPoint.y, aheadPoint.x - spawnPoint.x);
  car.speed = 0;
  state.raceTime = 0;
  state.finished = false;
  state.paused = false;
  state.pauseMenuIndex = 0;
  const startCheckpointIndex = getStartCheckpointIndex();
  lapData.currentLapStart = 0;
  lapData.lapTimes = [];
  lapData.passed = new Set([startCheckpointIndex]);
  lapData.nextCheckpointIndex = checkpoints.length > 0 ? (startCheckpointIndex + 1) % checkpoints.length : 0;
  lapData.lap = 1;
  state.startSequence.active = true;
  state.startSequence.elapsed = 0;
  state.startSequence.goTime = 3 + Math.random() * 2;
  state.startSequence.goFlash = 0;
  state.checkpointBlink.time = 0;
  physicsRuntime.input.throttle = 0;
  physicsRuntime.input.brake = 0;
  physicsRuntime.input.steer = 0;
  physicsRuntime.input.handbrake = 0;
  physicsRuntime.steeringRate = 0;
  physicsRuntime.recoveryTimer = 0;
  physicsRuntime.collisionGripTimer = 0;
  physicsRuntime.prevSteerAbs = 0;
  physicsRuntime.surface = { lateralGripMul: 1, longDragMul: 1, engineMul: 1, coastDecelMul: 1 };
  physicsRuntime.debug.pivotX = car.x;
  physicsRuntime.debug.pivotY = car.y;
  physicsRuntime.wheelLastPoints = null;
  physicsRuntime.prevForwardSpeed = null;
  skidMarks.length = 0;
}

export function clearRaceInputs() {
  keys.accel = false;
  keys.brake = false;
  keys.left = false;
  keys.right = false;
  keys.handbrake = false;
}

export function updateRace(dt) {
  const carCfg = physicsConfig.car;
  const assistCfg = physicsConfig.assists;
  const flags = physicsConfig.flags;
  const constants = physicsConfig.constants;
  dt = Math.min(dt, carCfg.dtClamp);

  if (state.startSequence.goFlash > 0) {
    state.startSequence.goFlash = Math.max(0, state.startSequence.goFlash - dt);
  }

  if (state.startSequence.active) {
    state.startSequence.elapsed += dt;
    if (state.startSequence.elapsed >= state.startSequence.goTime) {
      state.startSequence.active = false;
      state.startSequence.goFlash = 0.85;
      state.raceTime = 0;
      lapData.currentLapStart = 0;
    }
    return;
  }

  if (!state.finished) {
    state.raceTime += dt;
  }
  if (state.checkpointBlink.time > 0) {
    state.checkpointBlink.time = Math.max(0, state.checkpointBlink.time - dt);
  }

  const surfaceName = surfaceAt(car.x, car.y);
  const targetSurface = physicsConfig.surfaces[surfaceName] || physicsConfig.surfaces.asphalt;
  const blendAlpha = flags.SURFACE_BLENDING
    ? clamp(dt / Math.max(constants.surfaceBlendTime, 0.001), 0, 1)
    : 1;
  physicsRuntime.surface.lateralGripMul +=
    (targetSurface.lateralGripMul - physicsRuntime.surface.lateralGripMul) * blendAlpha;
  physicsRuntime.surface.longDragMul +=
    (targetSurface.longDragMul - physicsRuntime.surface.longDragMul) * blendAlpha;
  physicsRuntime.surface.engineMul += (targetSurface.engineMul - physicsRuntime.surface.engineMul) * blendAlpha;
  physicsRuntime.surface.coastDecelMul +=
    (targetSurface.coastDecelMul - physicsRuntime.surface.coastDecelMul) * blendAlpha;

  const throttleTarget = keys.accel ? 1 : 0;
  const brakeTarget = keys.brake ? 1 : 0;
  const steerTarget = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
  const handbrakeTarget = keys.handbrake ? 1 : 0;

  physicsRuntime.input.throttle = smoothInputValue(physicsRuntime.input.throttle, throttleTarget, dt);
  physicsRuntime.input.brake = smoothInputValue(physicsRuntime.input.brake, brakeTarget, dt);
  physicsRuntime.input.steer = smoothInputValue(physicsRuntime.input.steer, steerTarget, dt);
  physicsRuntime.input.handbrake = smoothInputValue(physicsRuntime.input.handbrake, handbrakeTarget, dt);

  const forwardX = Math.cos(car.angle);
  const forwardY = Math.sin(car.angle);
  const rightX = -forwardY;
  const rightY = forwardX;
  let forwardSpeed = car.vx * forwardX + car.vy * forwardY;
  let lateralSpeed = car.vx * rightX + car.vy * rightY;

  if (physicsRuntime.input.throttle > 0.01) {
    forwardSpeed +=
      carCfg.engineAccel * physicsRuntime.surface.engineMul * physicsRuntime.input.throttle * dt;
  }
  if (physicsRuntime.input.brake > 0.01) {
    forwardSpeed -= carCfg.brakeDecel * physicsRuntime.input.brake * dt;
  }
  if (physicsRuntime.input.throttle <= 0.01 && physicsRuntime.input.brake <= 0.01) {
    forwardSpeed = moveTowards(
      forwardSpeed,
      0,
      carCfg.coastDecel * physicsRuntime.surface.coastDecelMul * dt,
    );
  }
  if (flags.HANDBRAKE_MODE && physicsRuntime.input.handbrake > 0.05) {
    forwardSpeed = moveTowards(
      forwardSpeed,
      0,
      assistCfg.handbrakeLongDecel * physicsRuntime.input.handbrake * dt,
    );
    // Handbrake should induce slide, not unintended reverse creep.
    if (forwardSpeed < 0) forwardSpeed = 0;
  }
  forwardSpeed *= Math.exp(-carCfg.longDrag * physicsRuntime.surface.longDragMul * dt);

  const maxForwardSpeed = carCfg.maxSpeed;
  const maxReverseSpeed = -carCfg.maxSpeed * carCfg.reverseMaxSpeedMul;
  forwardSpeed = clamp(forwardSpeed, maxReverseSpeed, maxForwardSpeed);

  const speedAbs = Math.abs(forwardSpeed);
  const lowSpeedSteerMul =
    carCfg.steerAtLowSpeedMul +
    (1 - carCfg.steerAtLowSpeedMul) * clamp(speedAbs / constants.lowSpeedSteerAt, 0, 1);
  const speedSteerMul = flags.SPEED_SENSITIVE_STEERING
    ? 1 - assistCfg.speedSensitiveSteer * clamp(speedAbs / carCfg.maxSpeed, 0, 1)
    : 1;
  let targetYawRate = physicsRuntime.input.steer * carCfg.steerRate * lowSpeedSteerMul * speedSteerMul;
  if (flags.HANDBRAKE_MODE && physicsRuntime.input.handbrake > 0.05) {
    targetYawRate += assistCfg.handbrakeYawBoost * physicsRuntime.input.handbrake * physicsRuntime.input.steer;
  }
  physicsRuntime.steeringRate += (targetYawRate - physicsRuntime.steeringRate) * clamp(carCfg.yawDamping * dt, 0, 1);
  const oldAngle = car.angle;
  car.angle += physicsRuntime.steeringRate * dt;

  let effectiveLateralGrip = carCfg.lateralGrip * physicsRuntime.surface.lateralGripMul;
  const allowAutoDrift = surfaceName !== "grass";
  if (
    flags.AUTO_DRIFT_ON_STEER &&
    allowAutoDrift &&
    Math.abs(physicsRuntime.input.steer) > constants.driftSteerThreshold
  ) {
    effectiveLateralGrip *= 1 - assistCfg.autoDriftGripCut * Math.abs(physicsRuntime.input.steer);
  }
  if (flags.DRIFT_ASSIST_RECOVERY) {
    const steerAbs = Math.abs(physicsRuntime.input.steer);
    if (
      physicsRuntime.prevSteerAbs > constants.driftSteerThreshold &&
      steerAbs <= constants.driftSteerThreshold
    ) {
      physicsRuntime.recoveryTimer = assistCfg.driftAssistRecoveryTime;
    }
    physicsRuntime.prevSteerAbs = steerAbs;
    if (physicsRuntime.recoveryTimer > 0) {
      effectiveLateralGrip *= 1 + assistCfg.driftAssistRecoveryBoost;
      physicsRuntime.recoveryTimer = Math.max(0, physicsRuntime.recoveryTimer - dt);
    }
  }
  if (flags.HANDBRAKE_MODE && physicsRuntime.input.handbrake > 0.05) {
    const gripMul = 1 + (assistCfg.handbrakeGrip - 1) * physicsRuntime.input.handbrake;
    effectiveLateralGrip *= gripMul;
  }
  if (physicsRuntime.collisionGripTimer > 0) {
    effectiveLateralGrip *= 0.7;
    physicsRuntime.collisionGripTimer = Math.max(0, physicsRuntime.collisionGripTimer - dt);
  }

  const lateralCorrection = clamp(effectiveLateralGrip * dt, 0, 1);
  lateralSpeed *= 1 - lateralCorrection;

  car.vx = forwardX * forwardSpeed + rightX * lateralSpeed;
  car.vy = forwardY * forwardSpeed + rightY * lateralSpeed;

  const headingForwardX = Math.cos(car.angle);
  const headingForwardY = Math.sin(car.angle);
  const pivotBlend = clamp(Math.abs(forwardSpeed) / Math.max(constants.pivotBlendSpeed, 1), 0, 1);
  let pivotRatio =
    constants.pivotAtLowSpeedRatio +
    (constants.pivotFromRearRatio - constants.pivotAtLowSpeedRatio) * pivotBlend;
  if (flags.HANDBRAKE_MODE && physicsRuntime.input.handbrake > 0.05) {
    pivotRatio +=
      (constants.pivotAtLowSpeedRatio - pivotRatio) * clamp(physicsRuntime.input.handbrake, 0, 1);
  }
  const pivotOffset = car.width * (pivotRatio - 0.5);
  const pivotShiftX = Math.cos(oldAngle) * pivotOffset - headingForwardX * pivotOffset;
  const pivotShiftY = Math.sin(oldAngle) * pivotOffset - headingForwardY * pivotOffset;
  const nx = car.x + car.vx * dt + pivotShiftX;
  const ny = car.y + car.vy * dt + pivotShiftY;

  const collision = resolveObjectCollisions(nx, ny);
  car.x = collision.x;
  car.y = collision.y;
  if (collision.hit) {
    const inwardSpeed = car.vx * collision.normalX + car.vy * collision.normalY;
    if (inwardSpeed < 0) {
      car.vx -= inwardSpeed * collision.normalX;
      car.vy -= inwardSpeed * collision.normalY;
    }
    if (flags.ARCADE_COLLISION_PUSH) {
      car.vx *= 0.72;
      car.vy *= 0.72;
      car.vx += collision.normalX * 18;
      car.vy += collision.normalY * 18;
      physicsRuntime.collisionGripTimer = 0.08;
    } else {
      car.vx *= 0.55;
      car.vy *= 0.55;
    }
  }

  const headingRightX = -headingForwardY;
  const headingRightY = headingForwardX;
  let rawHeadingForwardSpeed = car.vx * headingForwardX + car.vy * headingForwardY;
  if (flags.HANDBRAKE_MODE && physicsRuntime.input.handbrake > 0.05 && rawHeadingForwardSpeed < 0) {
    // Remove only the backward longitudinal component, preserve lateral velocity for drift.
    car.vx -= rawHeadingForwardSpeed * headingForwardX;
    car.vy -= rawHeadingForwardSpeed * headingForwardY;
    rawHeadingForwardSpeed = 0;
  }
  const maxVectorSpeed =
    rawHeadingForwardSpeed >= 0 ? carCfg.maxSpeed : carCfg.maxSpeed * carCfg.reverseMaxSpeedMul;
  const vectorSpeed = Math.hypot(car.vx, car.vy);
  if (vectorSpeed > maxVectorSpeed && vectorSpeed > 0) {
    const s = maxVectorSpeed / vectorSpeed;
    car.vx *= s;
    car.vy *= s;
  }

  car.speed = Math.hypot(car.vx, car.vy);
  const headingForwardSpeed = car.vx * headingForwardX + car.vy * headingForwardY;
  const headingLateralSpeed = car.vx * headingRightX + car.vy * headingRightY;
  physicsRuntime.debug.surface = surfaceName;
  physicsRuntime.debug.vForward = headingForwardSpeed;
  physicsRuntime.debug.vLateral = headingLateralSpeed;
  physicsRuntime.debug.pivotX = car.x + headingForwardX * pivotOffset;
  physicsRuntime.debug.pivotY = car.y + headingForwardY * pivotOffset;
  physicsRuntime.debug.slipAngle = Math.atan2(
    Math.abs(headingLateralSpeed),
    Math.abs(headingForwardSpeed) + 0.0001,
  );
  const prevForward = physicsRuntime.prevForwardSpeed;
  const longAccel = prevForward === null || dt <= 0 ? 0 : (headingForwardSpeed - prevForward) / dt;
  physicsRuntime.prevForwardSpeed = headingForwardSpeed;
  const skidSurface = surfaceAt(car.x, car.y);
  recordSkids(skidSurface, headingForwardSpeed, headingLateralSpeed, longAccel);

  if (!state.finished) {
    checkCheckpoints();
  }
}

function checkCheckpoints() {
  if (!checkpoints.length) return;
  const startCheckpointIndex = getStartCheckpointIndex();
  const targetIndex = lapData.nextCheckpointIndex % checkpoints.length;
  const cp = checkpoints[targetIndex];
  const frame = trackFrameAtAngle(cp.angle, track);
  const checkpointSpan = frame.roadWidth * CHECKPOINT_WIDTH_MULTIPLIER;
  const halfSpan = checkpointSpan * 0.5;
  const ax = frame.point.x - frame.normal.x * halfSpan;
  const ay = frame.point.y - frame.normal.y * halfSpan;
  const bx = frame.point.x + frame.normal.x * halfSpan;
  const by = frame.point.y + frame.normal.y * halfSpan;
  const triggerDistance = Math.max(15, car.width * 0.55);
  const nearCheckpoint = distanceToSegment(car.x, car.y, ax, ay, bx, by) <= triggerDistance;

  if (!nearCheckpoint) return;

  state.checkpointBlink.time = state.checkpointBlink.duration;

  if (targetIndex !== startCheckpointIndex) {
    lapData.passed.add(targetIndex);
    lapData.nextCheckpointIndex = (targetIndex + 1) % checkpoints.length;
    return;
  }

  if (lapData.passed.size !== checkpoints.length || state.finished) return;

  const lapTime = state.raceTime - lapData.currentLapStart;
  if (lapTime <= 2) return;

  lapData.lapTimes.push(lapTime);
  lapData.currentLapStart = state.raceTime;
  lapData.passed = new Set([startCheckpointIndex]);
  lapData.nextCheckpointIndex = (startCheckpointIndex + 1) % checkpoints.length;
  lapData.lap += 1;

  if (lapData.lap > lapData.maxLaps) {
    state.finished = true;
  }
}

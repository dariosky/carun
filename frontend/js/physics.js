import {
  CHECKPOINT_WIDTH_MULTIPLIER,
  physicsConfig,
  checkpoints,
  getTrackPresetById,
  setTrackPresetMetadata,
  track,
  trackOptions,
} from "./parameters.js";
import { submitLapResult, submitRaceResult } from "./api.js";
import {
  emitFinishConfetti,
  emitGrassDust,
  emitHandbrakeSmoke,
  emitWaterSpray,
  resetParticles,
} from "./particles.js";
import {
  car,
  keys,
  lapData,
  physicsRuntime,
  skidMarks,
  state,
} from "./state.js";
import { gameAudio } from "./game-audio.js";
import { clamp, moveTowards } from "./utils.js";
import {
  pointOnCenterLine,
  resolveObjectCollisions,
  surfaceAt,
  trackFrameAtAngle,
  trackStartAngle,
} from "./track.js";

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
  const startAngle = trackStartAngle(track);
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

function emitDrivingParticles({
  dt,
  wheelPoints,
  forwardX,
  forwardY,
  headingForwardSpeed,
  headingLateralSpeed,
  surfaceName,
}) {
  const emitters = physicsRuntime.particleEmitters;
  emitters.smokeCooldown = Math.max(0, emitters.smokeCooldown - dt);
  emitters.splashCooldown = Math.max(0, emitters.splashCooldown - dt);
  emitters.dustCooldown = Math.max(0, emitters.dustCooldown - dt);

  const speedAbs = Math.abs(headingForwardSpeed);
  const lateralAbs = Math.abs(headingLateralSpeed);
  const speedFactor = clamp((car.speed - 28) / 110, 0, 1);
  const handbrakeStrength =
    physicsRuntime.input.handbrake *
    speedFactor *
    clamp((speedAbs - 35) / 85, 0, 1) *
    clamp((lateralAbs - 24) / 120, 0, 1);

  if (handbrakeStrength > 0.035 && emitters.smokeCooldown <= 0) {
    const rearAngle = Math.atan2(-forwardY, -forwardX);
    emitHandbrakeSmoke({
      x: wheelPoints[2].x,
      y: wheelPoints[2].y,
      angle: rearAngle,
      strength: 0.15 + handbrakeStrength * 1.9,
    });
    emitHandbrakeSmoke({
      x: wheelPoints[3].x,
      y: wheelPoints[3].y,
      angle: rearAngle,
      strength: 0.15 + handbrakeStrength * 1.9,
    });
    emitters.smokeCooldown = 0.05 - handbrakeStrength * 0.02;
  }

  const waterStrength =
    surfaceName === "water" ? clamp((car.speed - 30) / 115, 0, 1) : 0;
  if (waterStrength > 0.03 && emitters.splashCooldown <= 0) {
    const travelAngle = Math.atan2(car.vy, car.vx);
    const sprayAngle = Number.isFinite(travelAngle)
      ? travelAngle
      : Math.atan2(forwardY, forwardX);
    for (let i = 0; i < wheelPoints.length; i++) {
      emitWaterSpray({
        x: wheelPoints[i].x,
        y: wheelPoints[i].y,
        angle: sprayAngle,
        strength: 0.2 + waterStrength * 1.4,
        inheritVx: car.vx * 0.16,
        inheritVy: car.vy * 0.16,
      });
    }
    emitters.splashCooldown = 0.045 - waterStrength * 0.02;
  }

  const grassStrength =
    surfaceName === "grass" ? clamp((car.speed - 42) / 120, 0, 1) : 0;
  if (grassStrength > 0.02 && emitters.dustCooldown <= 0) {
    const travelAngle = Math.atan2(car.vy, car.vx);
    const dustAngle = Number.isFinite(travelAngle)
      ? travelAngle + Math.PI
      : Math.atan2(-forwardY, -forwardX);
    for (let i = 0; i < wheelPoints.length; i++) {
      emitGrassDust({
        x: wheelPoints[i].x,
        y: wheelPoints[i].y,
        angle: dustAngle,
        strength: 0.2 + grassStrength * 1.35,
        inheritVx: car.vx * 0.1,
        inheritVy: car.vy * 0.1,
      });
    }
    emitters.dustCooldown = 0.05 - grassStrength * 0.022;
  }
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
  if (!isGrass && !isWater && speedAbs < 8 && Math.abs(lateralSpeed) < 8)
    return;
  const strongAccel = longAccel > 480;
  const strongBrake = longAccel < -520;
  const skidding = Math.abs(lateralSpeed) > 95;
  const handbrakeSkid = physicsRuntime.input.handbrake > 0.08 && speedAbs > 24;
  const shouldDrawRoadSkids =
    isRoad && (strongAccel || strongBrake || skidding || handbrakeSkid);
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
  const spawnAngle = trackStartAngle(track);
  const spawnPoint = pointOnCenterLine(spawnAngle, track);
  const aheadPoint = pointOnCenterLine(spawnAngle + 0.02, track);
  car.x = spawnPoint.x;
  car.y = spawnPoint.y;
  car.vx = 0;
  car.vy = 0;
  car.angle = Math.atan2(
    aheadPoint.y - spawnPoint.y,
    aheadPoint.x - spawnPoint.x,
  );
  car.speed = 0;
  state.raceTime = 0;
  state.finished = false;
  state.paused = false;
  state.pauseMenuIndex = 0;
  const startCheckpointIndex = getStartCheckpointIndex();
  lapData.currentLapStart = 0;
  lapData.lapTimes = [];
  lapData.passed = new Set([startCheckpointIndex]);
  lapData.nextCheckpointIndex =
    checkpoints.length > 0
      ? (startCheckpointIndex + 1) % checkpoints.length
      : 0;
  lapData.lap = 1;
  state.startSequence.active = true;
  state.startSequence.elapsed = 0;
  state.startSequence.goTime = 3 + Math.random() * 2;
  state.startSequence.goFlash = 0;
  state.startSequence.lastCountdownStep = 0;
  state.checkpointBlink.time = 0;
  state.raceSubmission.inFlight = false;
  state.raceSubmission.completed = false;
  physicsRuntime.input.throttle = 0;
  physicsRuntime.input.brake = 0;
  physicsRuntime.input.steer = 0;
  physicsRuntime.input.handbrake = 0;
  physicsRuntime.steeringRate = 0;
  physicsRuntime.recoveryTimer = 0;
  physicsRuntime.collisionGripTimer = 0;
  physicsRuntime.impactCooldown = 0;
  physicsRuntime.prevSteerAbs = 0;
  physicsRuntime.surface = {
    lateralGripMul: 1,
    longDragMul: 1,
    engineMul: 1,
    coastDecelMul: 1,
  };
  physicsRuntime.debug.pivotX = car.x;
  physicsRuntime.debug.pivotY = car.y;
  physicsRuntime.wheelLastPoints = null;
  physicsRuntime.prevForwardSpeed = null;
  physicsRuntime.particleEmitters.smokeCooldown = 0;
  physicsRuntime.particleEmitters.splashCooldown = 0;
  physicsRuntime.particleEmitters.dustCooldown = 0;
  skidMarks.length = 0;
  resetParticles();
  state.finishCelebration.bestLap = false;
  state.finishCelebration.bestRace = false;
  state.finishCelebration.totalTime = 0;
  state.finishCelebration.bestLapTime = 0;
  state.finishCelebration.confettiActive = false;
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

  const surfaceName = surfaceAt(car.x, car.y);

  if (state.startSequence.active) {
    state.startSequence.elapsed += dt;
    const countdownStep = Math.min(3, Math.floor(state.startSequence.elapsed));
    if (countdownStep > state.startSequence.lastCountdownStep) {
      for (
        let step = state.startSequence.lastCountdownStep + 1;
        step <= countdownStep;
        step++
      ) {
        gameAudio.playCountdownBeep(step);
      }
      state.startSequence.lastCountdownStep = countdownStep;
    }
    if (state.startSequence.elapsed >= state.startSequence.goTime) {
      state.startSequence.active = false;
      state.startSequence.goFlash = 0.85;
      state.raceTime = 0;
      lapData.currentLapStart = 0;
      gameAudio.playGo();
    }
    gameAudio.updateVehicleAudio({
      speedNormalized: 0,
      throttle: keys.accel ? 1 : 0,
      acceleration: keys.accel ? 0.35 : 0,
      skidAmount: 0,
      surface: surfaceName,
      isMoving: false,
    });
    return;
  }

  if (!state.finished) {
    state.raceTime += dt;
  }
  if (state.checkpointBlink.time > 0) {
    state.checkpointBlink.time = Math.max(0, state.checkpointBlink.time - dt);
  }

  const targetSurface =
    physicsConfig.surfaces[surfaceName] || physicsConfig.surfaces.asphalt;
  const blendAlpha = flags.SURFACE_BLENDING
    ? clamp(dt / Math.max(constants.surfaceBlendTime, 0.001), 0, 1)
    : 1;
  physicsRuntime.surface.lateralGripMul +=
    (targetSurface.lateralGripMul - physicsRuntime.surface.lateralGripMul) *
    blendAlpha;
  physicsRuntime.surface.longDragMul +=
    (targetSurface.longDragMul - physicsRuntime.surface.longDragMul) *
    blendAlpha;
  physicsRuntime.surface.engineMul +=
    (targetSurface.engineMul - physicsRuntime.surface.engineMul) * blendAlpha;
  physicsRuntime.surface.coastDecelMul +=
    (targetSurface.coastDecelMul - physicsRuntime.surface.coastDecelMul) *
    blendAlpha;

  const throttleTarget = keys.accel ? 1 : 0;
  const brakeTarget = keys.brake ? 1 : 0;
  const steerTarget = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
  const handbrakeTarget = keys.handbrake ? 1 : 0;

  physicsRuntime.input.throttle = smoothInputValue(
    physicsRuntime.input.throttle,
    throttleTarget,
    dt,
  );
  physicsRuntime.input.brake = smoothInputValue(
    physicsRuntime.input.brake,
    brakeTarget,
    dt,
  );
  physicsRuntime.input.steer = smoothInputValue(
    physicsRuntime.input.steer,
    steerTarget,
    dt,
  );
  physicsRuntime.input.handbrake = smoothInputValue(
    physicsRuntime.input.handbrake,
    handbrakeTarget,
    dt,
  );

  const forwardX = Math.cos(car.angle);
  const forwardY = Math.sin(car.angle);
  const rightX = -forwardY;
  const rightY = forwardX;
  let forwardSpeed = car.vx * forwardX + car.vy * forwardY;
  let lateralSpeed = car.vx * rightX + car.vy * rightY;

  if (physicsRuntime.input.throttle > 0.01) {
    forwardSpeed +=
      carCfg.engineAccel *
      physicsRuntime.surface.engineMul *
      physicsRuntime.input.throttle *
      dt;
  }
  if (physicsRuntime.input.brake > 0.01) {
    forwardSpeed -= carCfg.brakeDecel * physicsRuntime.input.brake * dt;
  }
  if (
    physicsRuntime.input.throttle <= 0.01 &&
    physicsRuntime.input.brake <= 0.01
  ) {
    forwardSpeed = moveTowards(
      forwardSpeed,
      0,
      carCfg.coastDecel * physicsRuntime.surface.coastDecelMul * dt,
    );
  }
  if (flags.HANDBRAKE_MODE && physicsRuntime.input.handbrake > 0.05) {
    const handbrakeDecel =
      assistCfg.handbrakeLongDecel * physicsRuntime.input.handbrake * dt;
    if (forwardSpeed > 0) {
      forwardSpeed = Math.max(0, forwardSpeed - handbrakeDecel);
    } else {
      forwardSpeed = moveTowards(
        forwardSpeed,
        0,
        assistCfg.handbrakeReverseKillDecel *
          physicsRuntime.input.handbrake *
          dt,
      );
    }
  }
  forwardSpeed *= Math.exp(
    -carCfg.longDrag * physicsRuntime.surface.longDragMul * dt,
  );

  const maxForwardSpeed = carCfg.maxSpeed;
  const maxReverseSpeed = -carCfg.maxSpeed * carCfg.reverseMaxSpeedMul;
  forwardSpeed = clamp(forwardSpeed, maxReverseSpeed, maxForwardSpeed);

  const speedAbs = Math.abs(forwardSpeed);
  const lowSpeedSteerMul =
    carCfg.steerAtLowSpeedMul +
    (1 - carCfg.steerAtLowSpeedMul) *
      clamp(speedAbs / constants.lowSpeedSteerAt, 0, 1);
  const speedSteerMul = flags.SPEED_SENSITIVE_STEERING
    ? 1 -
      assistCfg.speedSensitiveSteer * clamp(speedAbs / carCfg.maxSpeed, 0, 1)
    : 1;
  let targetYawRate =
    physicsRuntime.input.steer *
    carCfg.steerRate *
    lowSpeedSteerMul *
    speedSteerMul;
  if (flags.HANDBRAKE_MODE && physicsRuntime.input.handbrake > 0.05) {
    targetYawRate +=
      assistCfg.handbrakeYawBoost *
      physicsRuntime.input.handbrake *
      physicsRuntime.input.steer;
  }
  physicsRuntime.steeringRate +=
    (targetYawRate - physicsRuntime.steeringRate) *
    clamp(carCfg.yawDamping * dt, 0, 1);
  const oldAngle = car.angle;
  car.angle += physicsRuntime.steeringRate * dt;

  let effectiveLateralGrip =
    carCfg.lateralGrip * physicsRuntime.surface.lateralGripMul;
  const allowAutoDrift = surfaceName !== "grass";
  if (
    flags.AUTO_DRIFT_ON_STEER &&
    allowAutoDrift &&
    Math.abs(physicsRuntime.input.steer) > constants.driftSteerThreshold
  ) {
    effectiveLateralGrip *=
      1 - assistCfg.autoDriftGripCut * Math.abs(physicsRuntime.input.steer);
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
      physicsRuntime.recoveryTimer = Math.max(
        0,
        physicsRuntime.recoveryTimer - dt,
      );
    }
  }
  if (
    allowAutoDrift &&
    physicsRuntime.input.throttle < 0.08 &&
    speedAbs > assistCfg.throttleLiftMinSpeed
  ) {
    const liftBlend =
      (1 - physicsRuntime.input.throttle) *
      clamp(
        (speedAbs - assistCfg.throttleLiftMinSpeed) /
          Math.max(carCfg.maxSpeed - assistCfg.throttleLiftMinSpeed, 1),
        0,
        1,
      );
    effectiveLateralGrip *= 1 - assistCfg.throttleLiftGripCut * liftBlend;
    lateralSpeed +=
      physicsRuntime.input.steer *
      speedAbs *
      assistCfg.throttleLiftSlipBoost *
      liftBlend *
      dt;
  }
  if (flags.HANDBRAKE_MODE && physicsRuntime.input.handbrake > 0.05) {
    const gripMul =
      1 + (assistCfg.handbrakeGrip - 1) * physicsRuntime.input.handbrake;
    effectiveLateralGrip *= gripMul;
    lateralSpeed +=
      physicsRuntime.input.steer *
      Math.max(speedAbs, 0) *
      assistCfg.handbrakeSlipBoost *
      physicsRuntime.input.handbrake *
      dt;
  }
  if (physicsRuntime.collisionGripTimer > 0) {
    effectiveLateralGrip *= 0.7;
    physicsRuntime.collisionGripTimer = Math.max(
      0,
      physicsRuntime.collisionGripTimer - dt,
    );
  }
  if (physicsRuntime.impactCooldown > 0) {
    physicsRuntime.impactCooldown = Math.max(
      0,
      physicsRuntime.impactCooldown - dt,
    );
  }

  const lateralCorrection = clamp(effectiveLateralGrip * dt, 0, 1);
  lateralSpeed *= 1 - lateralCorrection;

  car.vx = forwardX * forwardSpeed + rightX * lateralSpeed;
  car.vy = forwardY * forwardSpeed + rightY * lateralSpeed;

  const headingForwardX = Math.cos(car.angle);
  const headingForwardY = Math.sin(car.angle);
  const pivotBlend = clamp(
    Math.abs(forwardSpeed) / Math.max(constants.pivotBlendSpeed, 1),
    0,
    1,
  );
  let pivotRatio =
    constants.pivotAtLowSpeedRatio +
    (constants.pivotFromRearRatio - constants.pivotAtLowSpeedRatio) *
      pivotBlend;
  if (flags.HANDBRAKE_MODE && physicsRuntime.input.handbrake > 0.05) {
    pivotRatio +=
      (constants.pivotAtLowSpeedRatio - pivotRatio) *
      clamp(physicsRuntime.input.handbrake, 0, 1);
  }
  const pivotOffset = car.width * (pivotRatio - 0.5);
  const pivotShiftX =
    Math.cos(oldAngle) * pivotOffset - headingForwardX * pivotOffset;
  const pivotShiftY =
    Math.sin(oldAngle) * pivotOffset - headingForwardY * pivotOffset;
  const nx = car.x + car.vx * dt + pivotShiftX;
  const ny = car.y + car.vy * dt + pivotShiftY;

  const collision = resolveObjectCollisions(nx, ny);
  car.x = collision.x;
  car.y = collision.y;
  if (collision.hit) {
    const inwardSpeed = car.vx * collision.normalX + car.vy * collision.normalY;
    const impactStrength = clamp(
      Math.max(Math.abs(inwardSpeed), car.speed * 0.4) / 180,
      0,
      1,
    );
    if (physicsRuntime.impactCooldown <= 0 && impactStrength > 0.08) {
      if (collision.hitType === "tree") gameAudio.playTreeBump(impactStrength);
      else if (collision.hitType === "barrel")
        gameAudio.playBarrelBump(impactStrength);
      else gameAudio.playWallBump(impactStrength);
      physicsRuntime.impactCooldown = 0.11;
    }
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
  let rawHeadingForwardSpeed =
    car.vx * headingForwardX + car.vy * headingForwardY;
  if (
    flags.HANDBRAKE_MODE &&
    physicsRuntime.input.handbrake > 0.05 &&
    rawHeadingForwardSpeed < 0
  ) {
    // Remove only the backward longitudinal component, preserve lateral velocity for drift.
    car.vx -= rawHeadingForwardSpeed * headingForwardX;
    car.vy -= rawHeadingForwardSpeed * headingForwardY;
    rawHeadingForwardSpeed = 0;
  }
  const maxVectorSpeed =
    rawHeadingForwardSpeed >= 0
      ? carCfg.maxSpeed
      : carCfg.maxSpeed * carCfg.reverseMaxSpeedMul;
  const vectorSpeed = Math.hypot(car.vx, car.vy);
  if (vectorSpeed > maxVectorSpeed && vectorSpeed > 0) {
    const s = maxVectorSpeed / vectorSpeed;
    car.vx *= s;
    car.vy *= s;
  }

  car.speed = Math.hypot(car.vx, car.vy);
  const headingForwardSpeed =
    car.vx * headingForwardX + car.vy * headingForwardY;
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
  const longAccel =
    prevForward === null || dt <= 0
      ? 0
      : (headingForwardSpeed - prevForward) / dt;
  physicsRuntime.prevForwardSpeed = headingForwardSpeed;
  const skidSurface = surfaceAt(car.x, car.y);
  const wheelPoints = wheelWorldPoints();
  recordSkids(skidSurface, headingForwardSpeed, headingLateralSpeed, longAccel);
  emitDrivingParticles({
    dt,
    wheelPoints,
    forwardX: headingForwardX,
    forwardY: headingForwardY,
    headingForwardSpeed,
    headingLateralSpeed,
    surfaceName: skidSurface,
  });
  const skidAmount =
    clamp(Math.abs(headingLateralSpeed) / 110, 0, 1) *
    clamp(Math.abs(headingForwardSpeed) / 45, 0, 1);
  gameAudio.updateVehicleAudio({
    speedNormalized: clamp(car.speed / Math.max(carCfg.maxSpeed, 1), 0, 1),
    throttle: physicsRuntime.input.throttle,
    acceleration: clamp(longAccel / Math.max(carCfg.engineAccel, 1), -1, 1),
    skidAmount,
    surface: skidSurface,
    isMoving: car.speed > 4,
  });

  if (!state.finished) {
    checkCheckpoints();
  } else if (
    !state.raceSubmission.completed &&
    !state.raceSubmission.inFlight
  ) {
    state.raceSubmission.inFlight = true;
    Promise.resolve(persistRaceResults())
      .catch(() => {
        // Ignore transient submit failures: race UI should remain responsive.
      })
      .finally(() => {
        state.raceSubmission.inFlight = false;
        state.raceSubmission.completed = true;
      });
  }
}

async function persistRaceResults() {
  if (!state.auth.authenticated) return;
  if (
    state.selectedTrackIndex < 0 ||
    state.selectedTrackIndex >= trackOptions.length
  )
    return;

  const selectedTrack = trackOptions[state.selectedTrackIndex];
  if (
    !selectedTrack ||
    !selectedTrack.fromDb ||
    typeof selectedTrack.id !== "string"
  )
    return;

  if (!lapData.lapTimes.length) return;

  const lapTimesMs = lapData.lapTimes
    .map((seconds) => Math.round(seconds * 1000))
    .filter((lapMs) => Number.isFinite(lapMs) && lapMs > 0);
  if (!lapTimesMs.length) return;

  const bestLapMs = Math.min(...lapTimesMs);
  const raceMs = lapTimesMs.reduce((sum, lapMs) => sum + lapMs, 0);
  const lapSubmit = await submitLapResult({
    track_id: selectedTrack.id,
    lap_ms: bestLapMs,
    completed: true,
    checkpoint_count: checkpoints.length,
    expected_checkpoint_count: checkpoints.length,
    lap_data_checksum: `finish:${selectedTrack.id}:${bestLapMs}:${raceMs}`,
    build_version: "dev",
  });

  await submitRaceResult({
    track_id: selectedTrack.id,
    race_ms: raceMs,
    lap_count: lapTimesMs.length,
    completed: true,
    build_version: "dev",
  });

  const nextBestLapMs = Number.isFinite(lapSubmit.best_lap_ms)
    ? Number(lapSubmit.best_lap_ms)
    : bestLapMs;
  const selectedPreset = getTrackPresetById(selectedTrack.id);
  const nextBestRaceMs =
    selectedPreset && Number.isFinite(selectedPreset.bestRaceMs)
      ? Math.min(Number(selectedPreset.bestRaceMs), raceMs)
      : raceMs;
  setTrackPresetMetadata(
    selectedTrack.id,
    {
      bestLapMs: nextBestLapMs,
      bestLapDisplayName: state.auth.displayName || null,
      bestRaceMs: nextBestRaceMs,
      bestRaceDisplayName: state.auth.displayName || null,
    },
    { currentUserId: state.auth.userId },
  );
}

function finalizeFinishCelebration() {
  const lapTimes = lapData.lapTimes;
  const totalTime = lapTimes.reduce((sum, lapSeconds) => sum + lapSeconds, 0);
  const bestLapTime = lapTimes.length ? Math.min(...lapTimes) : 0;
  const selectedTrack = trackOptions[state.selectedTrackIndex] || null;
  const previousBestLapMs =
    selectedTrack && Number.isFinite(selectedTrack.bestLapMs)
      ? Number(selectedTrack.bestLapMs)
      : null;
  const previousBestRaceMs =
    selectedTrack && Number.isFinite(selectedTrack.bestRaceMs)
      ? Number(selectedTrack.bestRaceMs)
      : null;
  const totalMs = Math.round(totalTime * 1000);
  const bestLapMs = Math.round(bestLapTime * 1000);
  const bestLap =
    lapTimes.length > 0 &&
    (previousBestLapMs === null || bestLapMs < previousBestLapMs);
  const bestRace =
    lapTimes.length > 0 &&
    (previousBestRaceMs === null || totalMs < previousBestRaceMs);

  state.finishCelebration.bestLap = bestLap;
  state.finishCelebration.bestRace = bestRace;
  state.finishCelebration.totalTime = totalTime;
  state.finishCelebration.bestLapTime = bestLapTime;
  state.finishCelebration.confettiActive = bestLap || bestRace;

  if (bestLap || bestRace) {
    emitFinishConfetti({ bestLap, bestRace });
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
  const nearCheckpoint =
    distanceToSegment(car.x, car.y, ax, ay, bx, by) <= triggerDistance;

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
    finalizeFinishCelebration();
  }
}

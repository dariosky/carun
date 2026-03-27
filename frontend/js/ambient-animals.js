import { track, worldObjects } from "./parameters.js";
import { normalizeWorldObject, resolveObjectCollisions, surfaceAtForTrack } from "./track.js";
import { pickAnimalDirection } from "./asset-sprites.js";

const ANIMAL_KIND_CONFIG = {
  rooster: {
    homeRadius: 132,
    threatDistance: 220,
    immediateThreatDistance: 54,
    wanderSpeed: 16,
    grassSeekSpeed: 24,
    fleeSpeed: 72,
    collisionRadius: 15,
    idleDurationMin: 0.6,
    idleDurationMax: 1.6,
    wanderDurationMin: 1.1,
    wanderDurationMax: 2.6,
    fleeDurationMin: 1.2,
    fleeDurationMax: 1.9,
    hitSpeedLossMin: 12,
    hitSpeedLossMax: 42,
    hitSpeedLossMul: 0.2,
    hitSlowdownTime: 0.22,
    hitSlowdownDecel: 980,
    bloodStrengthMin: 0.55,
    bloodStrengthMax: 1.2,
    bloodStrengthMul: 1,
  },
  sheep: {
    homeRadius: 170,
    threatDistance: 250,
    immediateThreatDistance: 66,
    wanderSpeed: 10,
    grassSeekSpeed: 14,
    fleeSpeed: 48,
    collisionRadius: 20,
    idleDurationMin: 0.9,
    idleDurationMax: 2.2,
    wanderDurationMin: 1.5,
    wanderDurationMax: 3.1,
    fleeDurationMin: 1.3,
    fleeDurationMax: 2.1,
    hitSpeedLossMin: 20,
    hitSpeedLossMax: 58,
    hitSpeedLossMul: 0.28,
    hitSlowdownTime: 0.34,
    hitSlowdownDecel: 1380,
    bloodStrengthMin: 0.85,
    bloodStrengthMax: 1.5,
    bloodStrengthMul: 1.35,
  },
};

export const ambientAnimals = [];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hash01(seed) {
  const raw = Math.sin(seed * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

function rangeFromHash(seed, min, max) {
  return min + (max - min) * hash01(seed);
}

function getAnimalConfig(kind = "rooster") {
  return ANIMAL_KIND_CONFIG[kind] || ANIMAL_KIND_CONFIG.rooster;
}

export function getAnimalBehaviorConfig(kind = "rooster") {
  return getAnimalConfig(kind);
}

function getSurfaceScore(surfaceName) {
  if (surfaceName === "grass") return 1.8;
  if (surfaceName === "curb") return 0.45;
  if (surfaceName === "asphalt") return -0.95;
  if (surfaceName === "oil") return -1.15;
  if (surfaceName === "water") return -2.5;
  return -0.6;
}

function chooseDirectionAngle(animal, preferredAngle, mode, objects) {
  const cfg = getAnimalConfig(animal.kind);
  let bestAngle = preferredAngle;
  let bestScore = -Infinity;
  const sampleDistance = Math.max(28, animal.r * 4.2);
  for (let i = 0; i < 12; i++) {
    const angle = preferredAngle + (i / 12) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const probeX = animal.x + dirX * sampleDistance;
    const probeY = animal.y + dirY * sampleDistance;
    const surface = surfaceAtForTrack(probeX, probeY, track, objects);
    const resolved = resolveObjectCollisions(probeX, probeY, 0, objects);
    const blocked = Math.hypot(resolved.x - probeX, resolved.y - probeY) > 0.01;
    const homeDistance = Math.hypot(probeX - animal.homeX, probeY - animal.homeY);
    const alignScore = Math.cos(angle - preferredAngle) * (mode === "flee" ? 1.8 : 1.25);
    const homePenalty =
      homeDistance > cfg.homeRadius ? (homeDistance - cfg.homeRadius) / cfg.homeRadius : 0;
    const score =
      alignScore +
      getSurfaceScore(surface) -
      homePenalty * 1.15 -
      (blocked ? 1.7 : 0) +
      (surface === "grass" && mode !== "idle" ? 0.35 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  return bestAngle;
}

function scheduleAnimalMode(animal, mode, objects, threatAngle = null) {
  const cfg = getAnimalConfig(animal.kind);
  const seed = animal.seed + animal.decisionIndex * 0.73;
  animal.decisionIndex += 1;
  animal.mode = mode;
  if (mode === "idle") {
    animal.modeTimer = rangeFromHash(seed, cfg.idleDurationMin, cfg.idleDurationMax);
    animal.targetSpeed = 0;
    return;
  }
  if (mode === "flee") {
    const baseAngle = Number.isFinite(threatAngle) ? threatAngle : animal.moveAngle;
    animal.modeTimer = rangeFromHash(seed, cfg.fleeDurationMin, cfg.fleeDurationMax);
    animal.targetSpeed = cfg.fleeSpeed;
    animal.moveAngle = chooseDirectionAngle(animal, baseAngle, mode, objects);
    return;
  }
  animal.modeTimer = rangeFromHash(seed, cfg.wanderDurationMin, cfg.wanderDurationMax);
  animal.targetSpeed = mode === "grassSeek" ? cfg.grassSeekSpeed : cfg.wanderSpeed;
  const homeAngle = Math.atan2(animal.homeY - animal.y, animal.homeX - animal.x);
  const driftAngle = rangeFromHash(seed + 2.1, -Math.PI * 0.9, Math.PI * 0.9);
  const preferredAngle =
    Math.hypot(animal.x - animal.homeX, animal.y - animal.homeY) > cfg.homeRadius * 0.75
      ? homeAngle
      : animal.moveAngle + driftAngle;
  animal.moveAngle = chooseDirectionAngle(animal, preferredAngle, mode, objects);
}

function createAmbientAnimalState(object, index) {
  const normalized = normalizeWorldObject(object);
  if (!normalized || normalized.type !== "animal") return null;
  const seed = normalized.x * 0.013 + normalized.y * 0.017 + index * 1.37;
  return {
    id: `animal-${index}-${normalized.kind}`,
    kind: normalized.kind,
    x: normalized.x,
    y: normalized.y,
    homeX: normalized.x,
    homeY: normalized.y,
    r: normalized.r,
    angle: normalized.angle || 0,
    moveAngle: normalized.angle || rangeFromHash(seed, 0, Math.PI * 2),
    speed: 0,
    targetSpeed: 0,
    mode: "idle",
    modeTimer: rangeFromHash(seed + 1.4, 0.4, 1.4),
    facing: pickAnimalDirection(Math.cos(normalized.angle), Math.sin(normalized.angle), "front"),
    animationTime: rangeFromHash(seed + 2.7, 0, 0.5),
    decisionIndex: 0,
    seed,
    active: true,
    hitTime: 0,
  };
}

function getThreat(animal, racers) {
  let best = null;
  let bestScore = Infinity;
  const cfg = getAnimalConfig(animal.kind);
  for (const racer of racers) {
    const vehicle = racer?.vehicle;
    if (!vehicle) continue;
    const speed = Math.hypot(vehicle.vx, vehicle.vy);
    const dx = animal.x - vehicle.x;
    const dy = animal.y - vehicle.y;
    const dist = Math.hypot(dx, dy);
    if (dist > cfg.threatDistance) continue;
    if (dist < cfg.immediateThreatDistance) {
      if (dist < bestScore) {
        bestScore = dist;
        best = { racer, distance: dist, awayAngle: Math.atan2(dy, dx) };
      }
      continue;
    }
    if (speed < 14) continue;
    const dirX = vehicle.vx / Math.max(speed, 0.001);
    const dirY = vehicle.vy / Math.max(speed, 0.001);
    const towardAnimal = (dirX * dx + dirY * dy) / Math.max(dist, 0.001);
    if (towardAnimal < 0.28) continue;
    const score = dist / Math.max(towardAnimal, 0.15);
    if (score < bestScore) {
      bestScore = score;
      best = { racer, distance: dist, awayAngle: Math.atan2(dy, dx) };
    }
  }
  return best;
}

function stepAnimalMotion(animal, dt, objects) {
  const speedLerp = clamp(dt * 6.5, 0, 1);
  animal.speed += (animal.targetSpeed - animal.speed) * speedLerp;
  if (animal.speed < 0.5) {
    animal.speed = 0;
    animal.animationTime += dt * 0.45;
    return;
  }

  const moveX = Math.cos(animal.moveAngle) * animal.speed * dt;
  const moveY = Math.sin(animal.moveAngle) * animal.speed * dt;
  const candidateX = animal.x + moveX;
  const candidateY = animal.y + moveY;
  const resolved = resolveObjectCollisions(candidateX, candidateY, 0, objects);
  if (resolved.hit) {
    animal.x = resolved.x;
    animal.y = resolved.y;
    animal.moveAngle += Math.PI * (hash01(animal.seed + animal.decisionIndex) > 0.5 ? 0.5 : -0.5);
    animal.modeTimer = Math.min(animal.modeTimer, 0.22);
    animal.speed *= 0.55;
  } else {
    animal.x = candidateX;
    animal.y = candidateY;
  }

  const surface = surfaceAtForTrack(animal.x, animal.y, track, objects);
  if (surface === "water") {
    animal.moveAngle += Math.PI * 0.8;
    animal.modeTimer = 0;
    animal.speed *= 0.4;
  }

  animal.facing = pickAnimalDirection(
    Math.cos(animal.moveAngle),
    Math.sin(animal.moveAngle),
    animal.facing,
  );
  animal.animationTime += dt * clamp(animal.speed / 16, 0.55, 2.8);
}

function updateAmbientAnimal(animal, dt, racers, objects) {
  if (!animal.active) {
    animal.hitTime += dt;
    return;
  }

  const surface = surfaceAtForTrack(animal.x, animal.y, track, objects);
  const threat = getThreat(animal, racers);
  if (threat) {
    scheduleAnimalMode(animal, "flee", objects, threat.awayAngle);
  } else {
    animal.modeTimer -= dt;
    if (animal.modeTimer <= 0) {
      const modeSeed = animal.seed + animal.decisionIndex * 1.13;
      if (surface !== "grass" && surface !== "curb") {
        scheduleAnimalMode(animal, "grassSeek", objects, null);
      } else if (hash01(modeSeed) < 0.34) {
        scheduleAnimalMode(animal, "idle", objects, null);
      } else {
        scheduleAnimalMode(animal, "wander", objects, null);
      }
    }
  }

  if (animal.mode === "idle") {
    animal.speed += (0 - animal.speed) * clamp(dt * 8, 0, 1);
    animal.animationTime += dt * 0.45;
    return;
  }

  if (animal.mode === "grassSeek" && surface === "grass") {
    animal.modeTimer = Math.min(animal.modeTimer, 0.18);
  }

  stepAnimalMotion(animal, dt, objects);
}

function detectAnimalHit(animal, racers) {
  if (!animal.active) return null;
  const cfg = getAnimalConfig(animal.kind);
  for (const racer of racers) {
    const vehicle = racer?.vehicle;
    if (!vehicle || vehicle.z > 0.8) continue;
    const dx = vehicle.x - animal.x;
    const dy = vehicle.y - animal.y;
    const dist = Math.hypot(dx, dy);
    const carRadius = Math.max(vehicle.width, vehicle.height) * 0.46;
    if (dist > cfg.collisionRadius + carRadius) continue;
    const speed = Math.hypot(vehicle.vx, vehicle.vy);
    if (speed < 8) continue;
    animal.active = false;
    animal.hitTime = 0;
    return {
      animal,
      racer,
      speed,
      x: animal.x,
      y: animal.y,
      config: cfg,
    };
  }
  return null;
}

export function rebuildAmbientAnimals(objects = worldObjects) {
  ambientAnimals.length = 0;
  objects.forEach((object, index) => {
    const animal = createAmbientAnimalState(object, index);
    if (!animal) return;
    ambientAnimals.push(animal);
  });
}

export function updateAmbientAnimals(dt, racers = [], objects = worldObjects) {
  const hitEvents = [];
  for (const animal of ambientAnimals) {
    updateAmbientAnimal(animal, dt, racers, objects);
    const hit = detectAnimalHit(animal, racers);
    if (hit) hitEvents.push(hit);
  }
  return hitEvents;
}

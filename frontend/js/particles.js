import { car, state } from "./state.js";

const particles = [];

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

export function resetParticles() {
  particles.length = 0;
}

export function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) {
      particles.splice(i, 1);
      continue;
    }

    p.vx *= Math.exp(-p.drag * dt);
    p.vy *= Math.exp(-p.drag * dt);
    p.vx += p.ax * dt;
    p.vy += p.ay * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rotation += p.spin * dt;
  }
}

export function emitBurst({
  x,
  y,
  count = 20,
  speedMin = 40,
  speedMax = 160,
  lifeMin = 0.7,
  lifeMax = 1.3,
  sizeMin = 4,
  sizeMax = 10,
  colors = ["#ffffff"],
  drag = 1.6,
  gravity = 0,
  inheritVx = 0,
  inheritVy = 0,
  spread = Math.PI * 2,
  angleOffset = 0,
  kind = "square",
  layer = "aboveCar",
} = {}) {
  for (let i = 0; i < count; i++) {
    const angle = angleOffset + randomRange(-spread * 0.5, spread * 0.5);
    const speed = randomRange(speedMin, speedMax);
    particles.push({
      kind,
      x,
      y,
      vx: Math.cos(angle) * speed + inheritVx,
      vy: Math.sin(angle) * speed + inheritVy,
      ax: 0,
      ay: gravity,
      life: randomRange(lifeMin, lifeMax),
      age: 0,
      size: randomRange(sizeMin, sizeMax),
      color: colors[Math.floor(Math.random() * colors.length)] || "#ffffff",
      drag,
      layer,
      rotation: randomRange(0, Math.PI * 2),
      spin: randomRange(-10, 10),
      aspect: randomRange(0.45, 1.6),
    });
  }
}

export function emitFinishConfetti({ bestLap = false, bestRace = false } = {}) {
  const burstCount = bestLap && bestRace ? 3 : 2;
  const palette =
    bestLap && bestRace
      ? ["#ffe066", "#ffb703", "#ff5d8f", "#57ccff", "#ffffff"]
      : bestRace
        ? ["#ffe066", "#ffb703", "#fff4b5", "#ffffff"]
        : ["#ffe066", "#57ccff", "#ff6b6b", "#ffffff"];

  for (let i = 0; i < burstCount; i++) {
    emitBurst({
      x: car.x,
      y: car.y,
      count: 28,
      speedMin: 50,
      speedMax: 210,
      lifeMin: 0.8,
      lifeMax: 1.7,
      sizeMin: 5,
      sizeMax: 11,
      colors: palette,
      drag: 1.1,
      gravity: 95,
      inheritVx: car.vx * 0.1,
      inheritVy: car.vy * 0.1,
      spread: Math.PI * 2,
      angleOffset: (Math.PI * 2 * i) / burstCount,
      kind: "confetti",
    });
  }

  state.finishCelebration.confettiActive = true;
}

const screenParticles = [];

export function emitScreenConfetti({ x, y } = {}) {
  const palette = ["#ffe066", "#ffb703", "#ff5d8f", "#57ccff", "#ffffff", "#6af0a8"];
  for (let i = 0; i < 3; i++) {
    const burstX = x + (i - 1) * 120;
    for (let j = 0; j < 32; j++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randomRange(60, 260);
      screenParticles.push({
        kind: "confetti",
        x: burstX,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - randomRange(40, 120),
        ax: 0,
        ay: 110,
        life: randomRange(1.2, 2.6),
        age: 0,
        size: randomRange(5, 12),
        color: palette[Math.floor(Math.random() * palette.length)],
        drag: 0.8,
        rotation: randomRange(0, Math.PI * 2),
        spin: randomRange(-10, 10),
        aspect: randomRange(0.45, 1.6),
      });
    }
  }
}

export function updateScreenParticles(dt) {
  for (let i = screenParticles.length - 1; i >= 0; i--) {
    const p = screenParticles[i];
    p.age += dt;
    if (p.age >= p.life) {
      screenParticles.splice(i, 1);
      continue;
    }
    p.vx *= Math.exp(-p.drag * dt);
    p.vy *= Math.exp(-p.drag * dt);
    p.vx += p.ax * dt;
    p.vy += p.ay * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rotation += p.spin * dt;
  }
}

export function drawScreenParticles(ctx) {
  for (let i = 0; i < screenParticles.length; i++) {
    const p = screenParticles[i];
    const lifeT = 1 - p.age / Math.max(p.life, 0.0001);
    if (lifeT <= 0) continue;
    ctx.save();
    ctx.globalAlpha = Math.min(1, lifeT * 1.15);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    if (p.kind === "confetti") {
      ctx.fillRect(-p.size * 0.5, -p.size * p.aspect * 0.5, p.size, p.size * p.aspect);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export function resetScreenParticles() {
  screenParticles.length = 0;
}

export function emitHandbrakeSmoke({ x, y, angle = 0, strength = 1 } = {}) {
  emitBurst({
    x,
    y,
    count: Math.max(2, Math.round(3 * strength)),
    speedMin: 8,
    speedMax: 42,
    lifeMin: 0.28,
    lifeMax: 0.62,
    sizeMin: 6,
    sizeMax: 14,
    colors: ["rgba(236, 241, 247, 0.72)", "rgba(208, 217, 228, 0.62)", "rgba(176, 188, 202, 0.48)"],
    drag: 2.6,
    gravity: -10,
    spread: Math.PI * 0.9,
    angleOffset: angle,
    kind: "smoke",
  });
}

export function emitWaterSpray({
  x,
  y,
  angle = 0,
  strength = 1,
  inheritVx = 0,
  inheritVy = 0,
} = {}) {
  emitBurst({
    x,
    y,
    count: Math.max(3, Math.round(4 * strength)),
    speedMin: 24,
    speedMax: 90,
    lifeMin: 0.2,
    lifeMax: 0.48,
    sizeMin: 3,
    sizeMax: 8,
    colors: ["rgba(245, 251, 255, 0.92)", "rgba(184, 224, 248, 0.78)", "rgba(130, 189, 230, 0.68)"],
    drag: 3.1,
    gravity: 42,
    inheritVx,
    inheritVy,
    spread: Math.PI * 0.95,
    angleOffset: angle,
    kind: "spray",
    layer: "belowCar",
  });
}

export function emitGrassDust({
  x,
  y,
  angle = 0,
  strength = 1,
  inheritVx = 0,
  inheritVy = 0,
} = {}) {
  emitBurst({
    x,
    y,
    count: Math.max(2, Math.round(4 * strength)),
    speedMin: 16,
    speedMax: 62,
    lifeMin: 0.3,
    lifeMax: 0.72,
    sizeMin: 8,
    sizeMax: 18,
    colors: ["rgba(142, 102, 62, 0.52)", "rgba(126, 87, 52, 0.46)", "rgba(171, 130, 82, 0.40)"],
    drag: 2.1,
    gravity: -4,
    inheritVx,
    inheritVy,
    spread: Math.PI * 1.1,
    angleOffset: angle,
    kind: "dust",
  });
}

export function drawParticles(ctx, { layer = null } = {}) {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (layer && p.layer !== layer) continue;
    const lifeT = 1 - p.age / Math.max(p.life, 0.0001);
    if (lifeT <= 0) continue;

    ctx.save();
    ctx.globalAlpha = Math.min(1, lifeT * 1.15);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    if (p.kind === "confetti") {
      ctx.fillRect(-p.size * 0.5, -p.size * p.aspect * 0.5, p.size, p.size * p.aspect);
    } else if (p.kind === "smoke") {
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === "dust") {
      ctx.fillRect(-p.size * 0.65, -p.size * 0.32, p.size * 1.3, p.size * 0.64);
    } else if (p.kind === "spray") {
      ctx.fillRect(-p.size * 0.7, -p.size * 0.45, p.size * 1.4, p.size * 0.9);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

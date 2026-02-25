const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const PLAYER_NAME_STORAGE_KEY = "carun.playerName";

function sanitizePlayerName(raw) {
  if (typeof raw !== "string") return "PLAYER";
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim().slice(0, 12);
  return cleaned || "PLAYER";
}

function loadPlayerName() {
  try {
    return sanitizePlayerName(localStorage.getItem(PLAYER_NAME_STORAGE_KEY));
  } catch {
    return "PLAYER";
  }
}

function savePlayerName(name) {
  try {
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, sanitizePlayerName(name));
  } catch {
    // Ignore storage failures (private mode, blocked storage, etc.).
  }
}

const state = {
  mode: "menu",
  menuIndex: 0,
  settingsIndex: 0,
  playerName: loadPlayerName(),
  editingName: false,
  raceTime: 0,
  finished: false,
  startSequence: {
    active: false,
    elapsed: 0,
    goTime: 0,
    goFlash: 0,
  },
};

const keys = {
  up: false,
  down: false,
  left: false,
  right: false,
  accel: false,
  brake: false,
};

const menuItems = ["START RACE", "SETTINGS"];
const settingsItems = ["PLAYER NAME", "BACK"];

const track = {
  cx: WIDTH * 0.5,
  cy: HEIGHT * 0.53,
  outerA: 500,
  outerB: 265,
  innerA: 315,
  innerB: 145,
  warpOuter: [
    { f: 2, amp: 0.055, phase: 0.45 },
    { f: 3, amp: 0.038, phase: -0.7 },
    { f: 5, amp: 0.022, phase: 1.15 },
  ],
  warpInner: [
    { f: 2, amp: 0.04, phase: 0.7 },
    { f: 3, amp: 0.025, phase: -0.5 },
    { f: 5, amp: 0.015, phase: 1.4 },
  ],
  borderSize: 22,
};

const checkpoints = [
  { angle: 0 },
  { angle: Math.PI * 0.5 },
  { angle: Math.PI },
  { angle: Math.PI * 1.5 },
];

const lapData = {
  currentLapStart: 0,
  lapTimes: [],
  maxLaps: 3,
  passed: new Set([0]),
  lap: 1,
};

const car = {
  x: track.cx,
  y: track.cy + 205,
  vx: 0,
  vy: 0,
  angle: Math.PI,
  speed: 0,
  width: 34,
  height: 20,
};

const physics = {
  accel: 420,
  brake: 440,
  rollDrag: 0.985,
  steering: 2.45,
  maxSpeed: 320,
  reverseSpeed: -120,
  lateralGrip: 6.8,
  driftGrip: 2.8,
  driftThreshold: 200,
  steerResponse: 8,
};

const worldObjects = [
  { type: "tree", x: 150, y: 150, r: 26 },
  { type: "tree", x: 1080, y: 136, r: 24 },
  { type: "tree", x: 172, y: 596, r: 23 },
  { type: "tree", x: 1110, y: 580, r: 22 },
  { type: "pond", x: 650, y: 350, rx: 95, ry: 52, seed: 0.8 },
  { type: "pond", x: 215, y: 340, rx: 60, ry: 34, seed: -0.55 },
  { type: "barrel", x: 447, y: 153, r: 13 },
  { type: "barrel", x: 847, y: 567, r: 13 },
];
const EDGE_BARRIER_WIDTH = 24;
const trackEdgeRails = [];
let curbSegments = { outer: [], inner: [] };
const CURB_MIN_WIDTH = 3;
const CURB_MAX_WIDTH = 22;
const CURB_STRIPE_LENGTH = 10;
const CURB_OUTSET = 20;

function resetRace() {
  car.x = track.cx;
  car.y = track.cy + 205;
  car.vx = 0;
  car.vy = 0;
  car.angle = Math.PI;
  car.speed = 0;
  state.raceTime = 0;
  state.finished = false;
  lapData.currentLapStart = 0;
  lapData.lapTimes = [];
  lapData.passed = new Set([0]);
  lapData.lap = 1;
  state.startSequence.active = true;
  state.startSequence.elapsed = 0;
  state.startSequence.goTime = 3 + Math.random() * 2;
  state.startSequence.goFlash = 0;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function ellipseRadiusAtAngle(angle, a, b) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return 1 / Math.sqrt((c * c) / (a * a) + (s * s) / (b * b));
}

function warpScale(angle, profile) {
  let wobble = 1;
  for (const wave of profile) {
    wobble += wave.amp * Math.sin(angle * wave.f + wave.phase);
  }
  return wobble;
}

function trackRadiiAtAngle(angle) {
  const outer = ellipseRadiusAtAngle(angle, track.outerA, track.outerB) * warpScale(angle, track.warpOuter);
  const inner = ellipseRadiusAtAngle(angle, track.innerA, track.innerB) * warpScale(angle, track.warpInner);
  return { outer, inner };
}

function pointOnTrackRadius(angle, radius) {
  return {
    x: track.cx + Math.cos(angle) * radius,
    y: track.cy + Math.sin(angle) * radius,
  };
}

function pointOnCenterLine(angle) {
  const radii = trackRadiiAtAngle(angle);
  return pointOnTrackRadius(angle, (radii.outer + radii.inner) * 0.5);
}

function sampleClosedPath(sampleFn, segments = 220) {
  const points = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(sampleFn(a));
  }
  return points;
}

function normalizeVec(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function signedAngleBetween(v1, v2) {
  return Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y);
}

function buildTrackEdgeRails() {
  const segments = 260;
  const centerLine = sampleClosedPath((a) => pointOnCenterLine(a), segments);
  const samples = [];
  const absCurvatures = [];

  for (let i = 0; i < segments; i++) {
    const prev = centerLine[(i - 1 + segments) % segments];
    const curr = centerLine[i];
    const next = centerLine[(i + 1) % segments];

    const segIn = normalizeVec(curr.x - prev.x, curr.y - prev.y);
    const segOut = normalizeVec(next.x - curr.x, next.y - curr.y);
    const signedTurn = signedAngleBetween(segIn, segOut);
    const ds = (Math.hypot(curr.x - prev.x, curr.y - prev.y) + Math.hypot(next.x - curr.x, next.y - curr.y)) * 0.5;
    const curvature = signedTurn / Math.max(ds, 1);

    const tangent = normalizeVec(next.x - prev.x, next.y - prev.y);
    const leftNormal = { x: -tangent.y, y: tangent.x };
    const angleFromCenter = Math.atan2(curr.y - track.cy, curr.x - track.cx);
    const radii = trackRadiiAtAngle(angleFromCenter);
    const halfWidth = (radii.outer - radii.inner) * 0.5;

    samples.push({ x: curr.x, y: curr.y, leftNormal, halfWidth, curvature });
    absCurvatures.push(Math.abs(curvature));
  }

  const sorted = [...absCurvatures].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * 0.62)] || 0.0022;
  const rails = [];
  let current = null;
  let currentSide = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const absK = Math.abs(s.curvature);
    const side = s.curvature >= 0 ? 1 : -1;
    const isTurning = absK >= threshold;

    if (!isTurning) {
      if (current && current.points.length >= 3) rails.push(current);
      current = null;
      currentSide = 0;
      continue;
    }

    // Outside of bend: left turn -> right side, right turn -> left side.
    const sideNormal =
      s.curvature >= 0
        ? { x: -s.leftNormal.x, y: -s.leftNormal.y }
        : { x: s.leftNormal.x, y: s.leftNormal.y };
    const offset = s.halfWidth + 3;
    const p = {
      x: s.x + sideNormal.x * offset,
      y: s.y + sideNormal.y * offset,
    };

    if (!current || currentSide !== side) {
      if (current && current.points.length >= 3) rails.push(current);
      current = { points: [p], width: EDGE_BARRIER_WIDTH };
      currentSide = side;
    } else {
      current.points.push(p);
    }
  }
  if (current && current.points.length >= 3) rails.push(current);

  return rails;
}

function pointToSegmentDistanceSq(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  const t = abLenSq > 0 ? clamp((apx * abx + apy * aby) / abLenSq, 0, 1) : 0;
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

function drawPath(points) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

function drawPolyline(points) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
}

function drawStripedCurb(
  pathPoints,
  sideSign,
  minWidth = CURB_MIN_WIDTH,
  maxWidth = CURB_MAX_WIDTH,
  stripeLen = CURB_STRIPE_LENGTH,
) {
  if (pathPoints.length < 2) return;

  const cumulative = [0];
  for (let i = 1; i < pathPoints.length; i++) {
    const a = pathPoints[i - 1];
    const b = pathPoints[i];
    cumulative.push(cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const totalLen = cumulative[cumulative.length - 1];
  if (totalLen <= 0) return;

  const pointAtDistance = (distance, startIndex = 0) => {
    let segIndex = startIndex;
    while (segIndex < cumulative.length - 2 && cumulative[segIndex + 1] < distance) segIndex++;

    const segStart = cumulative[segIndex];
    const segEnd = cumulative[segIndex + 1];
    const span = Math.max(segEnd - segStart, 1e-6);
    const t = clamp((distance - segStart) / span, 0, 1);
    const a = pathPoints[segIndex];
    const b = pathPoints[segIndex + 1];
    return {
      point: {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      },
      segIndex,
    };
  };

  const buildSlice = (startDist, endDist, startSegHint = 0) => {
    const startInfo = pointAtDistance(startDist, startSegHint);
    const points = [startInfo.point];
    let seg = startInfo.segIndex;

    while (seg < cumulative.length - 1 && cumulative[seg + 1] < endDist) {
      points.push(pathPoints[seg + 1]);
      seg++;
    }

    const endInfo = pointAtDistance(endDist, seg);
    points.push(endInfo.point);
    return { points, segIndex: endInfo.segIndex };
  };

  const drawExtrudedSlice = (points, width, color) => {
    if (points.length < 2) return;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len <= 1e-6) continue;

      const tx = dx / len;
      const ty = dy / len;
      const nx = -ty * sideSign;
      const ny = tx * sideSign;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x + nx * width, b.y + ny * width);
      ctx.lineTo(a.x + nx * width, a.y + ny * width);
      ctx.closePath();
      ctx.fill();
    }
  };

  ctx.save();

  let stripeIndex = 0;
  let segHint = 0;
  for (let start = 0; start < totalLen; start += stripeLen) {
    const end = Math.min(totalLen, start + stripeLen);
    const mid = (start + end) * 0.5;
    const progress = clamp(mid / totalLen, 0, 1);
    const taper = Math.sin(progress * Math.PI);
    const width = minWidth + (maxWidth - minWidth) * taper;
    const slice = buildSlice(start, end, segHint);
    segHint = slice.segIndex;
    if (slice.points.length < 2) continue;

    const color = stripeIndex % 2 === 0 ? "#d22e2e" : "#ddd4be";
    drawExtrudedSlice(slice.points, width, color);
    stripeIndex++;
  }

  ctx.restore();
}

function buildCurbSegments() {
  const segmentCount = 280;
  const center = sampleClosedPath((a) => pointOnCenterLine(a), segmentCount);
  const outer = sampleClosedPath((a) => {
    const radii = trackRadiiAtAngle(a);
    return pointOnTrackRadius(a, radii.outer - track.borderSize + CURB_OUTSET);
  }, segmentCount);
  const inner = sampleClosedPath((a) => {
    const radii = trackRadiiAtAngle(a);
    return pointOnTrackRadius(a, radii.inner + track.borderSize - CURB_OUTSET);
  }, segmentCount);

  const absCurvatures = [];
  const turning = new Array(segmentCount).fill(false);

  for (let i = 0; i < segmentCount; i++) {
    const prev = center[(i - 1 + segmentCount) % segmentCount];
    const curr = center[i];
    const next = center[(i + 1) % segmentCount];

    const segIn = normalizeVec(curr.x - prev.x, curr.y - prev.y);
    const segOut = normalizeVec(next.x - curr.x, next.y - curr.y);
    const signedTurn = signedAngleBetween(segIn, segOut);
    const ds = (Math.hypot(curr.x - prev.x, curr.y - prev.y) + Math.hypot(next.x - curr.x, next.y - curr.y)) * 0.5;
    absCurvatures.push(Math.abs(signedTurn / Math.max(ds, 1)));
  }

  const sorted = [...absCurvatures].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * 0.62)] || 0.0022;
  for (let i = 0; i < segmentCount; i++) {
    turning[i] = absCurvatures[i] >= threshold;
  }

  // Expand each turning zone slightly so curbs start before the apex and end after it.
  const expanded = new Array(segmentCount).fill(false);
  const expandBy = 2;
  for (let i = 0; i < segmentCount; i++) {
    if (!turning[i]) continue;
    for (let j = -expandBy; j <= expandBy; j++) {
      expanded[(i + j + segmentCount) % segmentCount] = true;
    }
  }

  const collectRuns = (points) => {
    const runs = [];
    const allTrue = expanded.every(Boolean);
    if (allTrue) return [[...points, points[0]]];

    let current = null;
    for (let i = 0; i < segmentCount; i++) {
      if (expanded[i]) {
        if (!current) current = [];
        current.push(points[i]);
      } else if (current) {
        current.push(points[i]);
        if (current.length >= 4) runs.push(current);
        current = null;
      }
    }

    if (current) {
      current.push(points[0]);
      if (runs.length && expanded[0]) {
        const first = runs.shift();
        runs.unshift([...current, ...first]);
      } else if (current.length >= 4) {
        runs.push(current);
      }
    }

    return runs;
  };

  return {
    outer: collectRuns(outer),
    inner: collectRuns(inner),
  };
}

function buildFullCurbSegments() {
  return {
    outer: [
      sampleClosedPath((a) => {
        const radii = trackRadiiAtAngle(a);
        return pointOnTrackRadius(a, radii.outer - track.borderSize + CURB_OUTSET);
      }),
    ],
    inner: [
      sampleClosedPath((a) => {
        const radii = trackRadiiAtAngle(a);
        return pointOnTrackRadius(a, radii.inner + track.borderSize - CURB_OUTSET);
      }),
    ],
  };
}

function initCurbSegments() {
  try {
    curbSegments = buildCurbSegments();
  } catch (err) {
    console.error("Curb segment generation failed, falling back to full curbs.", err);
    curbSegments = buildFullCurbSegments();
  }
}

function blobRadius(ellipseX, ellipseY, angle, seed = 0) {
  const base = ellipseRadiusAtAngle(angle, ellipseX, ellipseY);
  const wobble =
    1 +
    0.16 * Math.sin(angle * 2 + seed) +
    0.09 * Math.sin(angle * 4 - seed * 1.7) +
    0.06 * Math.cos(angle * 7 + seed * 0.6);
  return base * wobble;
}

function getSurface(x, y) {
  const dx = x - track.cx;
  const dy = y - track.cy;
  const angle = Math.atan2(dy, dx);
  const dist = Math.hypot(dx, dy);
  const radii = trackRadiiAtAngle(angle);

  if (dist > radii.outer) return "grass";
  if (dist < radii.inner) return "innerGrass";

  if (dist > radii.outer - track.borderSize || dist < radii.inner + track.borderSize) return "curb";

  return "asphalt";
}

function objectCollisionAt(x, y) {
  for (const obj of worldObjects) {
    if (obj.type === "tree" || obj.type === "barrel") {
      const r = obj.r + 8;
      const dx = x - obj.x;
      const dy = y - obj.y;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

function pondSlowdownAt(x, y) {
  for (const obj of worldObjects) {
    if (obj.type !== "pond") continue;
    const dx = x - obj.x;
    const dy = y - obj.y;
    const angle = Math.atan2(dy, dx);
    const dist = Math.hypot(dx, dy);
    if (dist < blobRadius(obj.rx, obj.ry, angle, obj.seed || 0)) return true;
  }
  return false;
}

function updateRace(dt) {
  if (state.startSequence.goFlash > 0) {
    state.startSequence.goFlash = Math.max(0, state.startSequence.goFlash - dt);
  }

  if (state.finished) return;

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

  state.raceTime += dt;

  const forwardX = Math.cos(car.angle);
  const forwardY = Math.sin(car.angle);
  const rightX = -forwardY;
  const rightY = forwardX;

  let forwardSpeed = car.vx * forwardX + car.vy * forwardY;
  let lateralSpeed = car.vx * rightX + car.vy * rightY;

  if (keys.accel) forwardSpeed += physics.accel * dt;
  if (keys.brake) forwardSpeed -= physics.brake * dt;
  forwardSpeed *= Math.pow(physics.rollDrag, dt * 60);

  const surface = getSurface(car.x, car.y);
  let grip = 1;
  let topSpeed = physics.maxSpeed;

  if (surface === "grass" || surface === "innerGrass") {
    topSpeed = 145;
    grip = 0.55;
    forwardSpeed *= 0.975;
  }
  if (surface === "curb") {
    topSpeed = physics.maxSpeed * 0.95;
    grip = 0.9;
  }
  if (pondSlowdownAt(car.x, car.y)) {
    topSpeed = Math.min(topSpeed, 70);
    forwardSpeed *= 0.9;
    lateralSpeed *= 0.9;
  }

  forwardSpeed = clamp(forwardSpeed, physics.reverseSpeed, topSpeed);

  const steerInput = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
  const steerSpeedFactor = clamp(Math.abs(forwardSpeed) / 70, 0, 1.8);
  const driftFactor = clamp((Math.abs(lateralSpeed) + Math.abs(forwardSpeed) - physics.driftThreshold) / 180, 0, 1);
  const effectiveGrip = physics.lateralGrip * (1 - driftFactor) + physics.driftGrip * driftFactor;

  car.angle += steerInput * physics.steering * dt * (forwardSpeed / physics.maxSpeed) * grip * steerSpeedFactor;

  const lateralCorrection = clamp(effectiveGrip * dt * grip, 0, 1);
  lateralSpeed *= 1 - lateralCorrection;

  const targetLateral = steerInput * Math.abs(forwardSpeed) * 0.09;
  lateralSpeed += (targetLateral - lateralSpeed) * clamp(physics.steerResponse * dt, 0, 1);

  car.vx = forwardX * forwardSpeed + rightX * lateralSpeed;
  car.vy = forwardY * forwardSpeed + rightY * lateralSpeed;

  const nx = car.x + car.vx * dt;
  const ny = car.y + car.vy * dt;

  if (!objectCollisionAt(nx, ny)) {
    car.x = nx;
    car.y = ny;
  } else {
    car.vx *= -0.15;
    car.vy *= -0.15;
  }

  checkCheckpoints();
}

function checkCheckpoints() {
  const dx = car.x - track.cx;
  const dy = car.y - track.cy;
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += Math.PI * 2;

  checkpoints.forEach((cp, idx) => {
    let diff = Math.abs(angle - cp.angle);
    diff = Math.min(diff, Math.PI * 2 - diff);
    if (diff < 0.2) {
      lapData.passed.add(idx);
    }
  });

  const startPoint = pointOnCenterLine(Math.PI * 0.5);
  const nearStart = Math.hypot(car.x - startPoint.x, car.y - startPoint.y) < 38;

  if (nearStart && lapData.passed.size === checkpoints.length && !state.finished) {
    const lapTime = state.raceTime - lapData.currentLapStart;
    if (lapTime > 2) {
      lapData.lapTimes.push(lapTime);
      lapData.currentLapStart = state.raceTime;
      lapData.passed = new Set([0]);
      lapData.lap += 1;

      if (lapData.lap > lapData.maxLaps) {
        state.finished = true;
      }
    }
  }
}

function drawPixelNoise() {
  for (let i = 0; i < 250; i++) {
    const x = Math.floor(Math.random() * WIDTH);
    const y = Math.floor(Math.random() * HEIGHT);
    ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.03)";
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawTrack() {
  ctx.fillStyle = "#2e8c42";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawPixelNoise();

  const outerPath = sampleClosedPath((a) => {
    const radii = trackRadiiAtAngle(a);
    return pointOnTrackRadius(a, radii.outer);
  });
  const innerPath = sampleClosedPath((a) => {
    const radii = trackRadiiAtAngle(a);
    return pointOnTrackRadius(a, radii.inner);
  });

  ctx.fillStyle = "#7f8c8d";
  ctx.beginPath();
  drawPath(outerPath);
  drawPath([...innerPath].reverse());
  ctx.fill("evenodd");

  curbSegments.outer.forEach((segment) =>
    drawStripedCurb(segment, -1, CURB_MIN_WIDTH, CURB_MAX_WIDTH, CURB_STRIPE_LENGTH),
  );
  curbSegments.inner.forEach((segment) =>
    drawStripedCurb(segment, 1, CURB_MIN_WIDTH, CURB_MAX_WIDTH, CURB_STRIPE_LENGTH),
  );

  ctx.fillStyle = "#247637";
  ctx.beginPath();
  drawPath(innerPath);
  ctx.fill();

  drawDecor();
  drawRoadDetails();
  drawStartLine();
}

function drawDecor() {
  for (const obj of worldObjects) {
    if (obj.type === "tree") {
      ctx.fillStyle = "#4a2f1e";
      ctx.fillRect(obj.x - 4, obj.y + 8, 8, 16);
      ctx.fillStyle = "#2f9c4a";
      const canopy = sampleClosedPath((a) => {
        const radius =
          obj.r *
          (1 + 0.2 * Math.sin(a * 3 + obj.x * 0.02) + 0.12 * Math.sin(a * 5 + obj.y * 0.02));
        return {
          x: obj.x + Math.cos(a) * radius,
          y: obj.y + Math.sin(a) * radius,
        };
      }, 40);
      ctx.beginPath();
      drawPath(canopy);
      ctx.fill();
      ctx.fillStyle = "#3dcf60";
      const highlight = sampleClosedPath((a) => {
        const radius = obj.r * 0.4 * (1 + 0.12 * Math.sin(a * 4 + obj.x * 0.08));
        return {
          x: obj.x - 8 + Math.cos(a) * radius,
          y: obj.y - 6 + Math.sin(a) * radius,
        };
      }, 24);
      ctx.beginPath();
      drawPath(highlight);
      ctx.fill();
    }

    if (obj.type === "pond") {
      ctx.fillStyle = "#1f6ca8";
      const waterPath = sampleClosedPath((a) => {
        const radius = blobRadius(obj.rx, obj.ry, a, obj.seed || 0);
        return {
          x: obj.x + Math.cos(a) * radius,
          y: obj.y + Math.sin(a) * radius,
        };
      }, 64);
      ctx.beginPath();
      drawPath(waterPath);
      ctx.fill();
      ctx.strokeStyle = "#8de2ff";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (obj.type === "barrel") {
      ctx.fillStyle = "#d16f0d";
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, obj.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#3a2a12";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function drawRoadDetails() {
  ctx.strokeStyle = "rgba(235, 235, 235, 0.45)";
  ctx.lineWidth = 4;
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    const p = pointOnCenterLine(t);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawTrackEdges() {
  for (const rail of trackEdgeRails) {
    if (rail.points.length < 2) continue;

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
    ctx.lineWidth = rail.width + 3;
    ctx.beginPath();
    ctx.moveTo(rail.points[0].x + 1, rail.points[0].y + 1);
    for (let i = 1; i < rail.points.length; i++) {
      ctx.lineTo(rail.points[i].x + 1, rail.points[i].y + 1);
    }
    ctx.stroke();

    ctx.strokeStyle = "#d4dadc";
    ctx.lineWidth = rail.width;
    ctx.beginPath();
    ctx.moveTo(rail.points[0].x, rail.points[0].y);
    for (let i = 1; i < rail.points.length; i++) {
      ctx.lineTo(rail.points[i].x, rail.points[i].y);
    }
    ctx.stroke();

    ctx.strokeStyle = "#c63c2e";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(rail.points[0].x, rail.points[0].y);
    for (let i = 1; i < rail.points.length; i++) {
      ctx.lineTo(rail.points[i].x, rail.points[i].y);
    }
    ctx.stroke();
  }
}

function drawStartLine() {
  const startAngle = Math.PI * 0.5;
  const radii = trackRadiiAtAngle(startAngle);
  const center = pointOnTrackRadius(startAngle, (radii.outer + radii.inner) * 0.5);
  const span = radii.outer - radii.inner;
  const thickness = 20;
  const cols = Math.max(8, Math.floor(span / 18));
  const rows = 2;
  const cellW = span / cols;
  const cellH = thickness / rows;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(startAngle);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      ctx.fillStyle = (c + r) % 2 ? "#ffffff" : "#111111";
      ctx.fillRect(-span * 0.5 + c * cellW, -thickness * 0.5 + r * cellH, cellW, cellH);
    }
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-span * 0.5, -thickness * 0.5, span, thickness);
  ctx.restore();
}

function drawCar() {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  ctx.fillStyle = "#d22525";
  ctx.fillRect(-car.width / 2, -car.height / 2, car.width, car.height);
  ctx.fillStyle = "#ffd34d";
  ctx.fillRect(-8, -6, 16, 12);
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(-car.width / 2 - 4, -car.height / 2 - 2, 6, 8);
  ctx.fillRect(-car.width / 2 - 4, car.height / 2 - 6, 6, 8);
  ctx.fillRect(car.width / 2 - 2, -car.height / 2 - 2, 6, 8);
  ctx.fillRect(car.width / 2 - 2, car.height / 2 - 6, 6, 8);

  ctx.restore();
}

function drawStartSequenceOverlay() {
  const seq = state.startSequence;
  if (!seq.active && seq.goFlash <= 0) return;

  const cx = track.cx;
  const cy = track.cy;

  if (seq.active) {
    const readyHold = 0.95;
    const readyFadeEnd = 1.8;
    let readyAlpha = 0;
    if (seq.elapsed < readyHold) readyAlpha = 1;
    else readyAlpha = clamp(1 - (seq.elapsed - readyHold) / (readyFadeEnd - readyHold), 0, 1);

    if (readyAlpha > 0) {
      const pulse = 1 + Math.sin(seq.elapsed * 9) * 0.06;
      ctx.save();
      ctx.translate(cx, cy - 82);
      ctx.scale(pulse, pulse);
      ctx.globalAlpha = readyAlpha;
      ctx.fillStyle = "rgba(11, 19, 28, 0.78)";
      ctx.fillRect(-165, -54, 330, 82);
      ctx.fillStyle = "#fff2a6";
      ctx.font = "bold 56px Verdana";
      ctx.fillText("READY?", -145, 4);
      ctx.restore();
    }

    const redCount = Math.min(3, Math.floor(seq.elapsed));
    const plateX = cx - 146;
    const plateY = cy - 18;
    const plateW = 292;
    const plateH = 112;

    ctx.save();
    const plateGradient = ctx.createLinearGradient(plateX, plateY, plateX, plateY + plateH);
    plateGradient.addColorStop(0, "#707985");
    plateGradient.addColorStop(1, "#2b3138");
    ctx.fillStyle = plateGradient;
    ctx.fillRect(plateX, plateY, plateW, plateH);
    ctx.strokeStyle = "#181d21";
    ctx.lineWidth = 4;
    ctx.strokeRect(plateX, plateY, plateW, plateH);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillRect(plateX + 8, plateY + 8, plateW - 16, 18);

    for (let i = 0; i < 3; i++) {
      const x = cx - 92 + i * 92;
      const y = cy + 38;
      const lit = i < redCount;
      const glow = lit ? "rgba(255, 72, 72, 0.5)" : "rgba(0, 0, 0, 0.35)";
      const lamp = ctx.createRadialGradient(x - 6, y - 8, 5, x, y, 29);
      if (lit) {
        lamp.addColorStop(0, "#ffd8d8");
        lamp.addColorStop(0.45, "#fa4747");
        lamp.addColorStop(1, "#640f0f");
      } else {
        lamp.addColorStop(0, "#797f89");
        lamp.addColorStop(0.55, "#444a54");
        lamp.addColorStop(1, "#1e232a");
      }

      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.fillStyle = lamp;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - 7, y - 8, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.fill();
    }
    ctx.restore();
  }

  if (!seq.active && seq.goFlash > 0) {
    const a = clamp(seq.goFlash / 0.85, 0, 1);
    const pop = 1 + (1 - a) * 0.12;
    ctx.save();
    const plateX = cx - 146;
    const plateY = cy - 18;
    const plateW = 292;
    const plateH = 112;
    const plateGradient = ctx.createLinearGradient(plateX, plateY, plateX, plateY + plateH);
    plateGradient.addColorStop(0, "#707985");
    plateGradient.addColorStop(1, "#2b3138");
    ctx.globalAlpha = Math.min(1, a + 0.2);
    ctx.fillStyle = plateGradient;
    ctx.fillRect(plateX, plateY, plateW, plateH);
    ctx.strokeStyle = "#181d21";
    ctx.lineWidth = 4;
    ctx.strokeRect(plateX, plateY, plateW, plateH);

    for (let i = 0; i < 3; i++) {
      const x = cx - 92 + i * 92;
      const y = cy + 38;
      const lamp = ctx.createRadialGradient(x - 6, y - 8, 5, x, y, 29);
      lamp.addColorStop(0, "#d5ffe3");
      lamp.addColorStop(0.45, "#57e58a");
      lamp.addColorStop(1, "#0f5228");
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(96, 255, 162, 0.45)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.fillStyle = lamp;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - 7, y - 8, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.fill();
    }

    ctx.translate(cx, cy - 18);
    ctx.scale(pop, pop);
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(9, 19, 16, 0.8)";
    ctx.fillRect(-125, -58, 250, 92);
    ctx.fillStyle = "#6af0a8";
    ctx.font = "bold 64px Verdana";
    ctx.fillText("GO!", -85, 12);
    ctx.restore();
  }
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, "0");
  const ms = Math.floor((t % 1) * 1000)
    .toString()
    .padStart(3, "0");
  return `${m}:${s}.${ms}`;
}

function drawHUD() {
  ctx.fillStyle = "rgba(5, 8, 18, 0.78)";
  ctx.fillRect(20, 16, 350, 160);

  ctx.fillStyle = "#ffe167";
  ctx.font = "bold 24px Verdana";
  ctx.fillText(`DRIVER: ${state.playerName}`, 34, 46);

  ctx.fillStyle = "#f0f0f0";
  ctx.font = "18px Verdana";
  const liveLap = state.finished
    ? lapData.lapTimes[lapData.lapTimes.length - 1] || 0
    : state.raceTime - lapData.currentLapStart;
  ctx.fillText(`LAP ${Math.min(lapData.lap, lapData.maxLaps)}/${lapData.maxLaps}`, 34, 75);
  ctx.fillText(`CURRENT: ${formatTime(liveLap)}`, 34, 102);

  ctx.font = "16px Verdana";
  for (let i = 0; i < lapData.maxLaps; i++) {
    const t = lapData.lapTimes[i];
    ctx.fillStyle = t ? "#ffffff" : "#8ea4aa";
    ctx.fillText(`L${i + 1}: ${t ? formatTime(t) : "--:--.---"}`, 34, 128 + i * 20);
  }

  if (state.finished) {
    ctx.fillStyle = "rgba(12, 22, 18, 0.86)";
    ctx.fillRect(WIDTH / 2 - 210, HEIGHT / 2 - 90, 420, 180);
    ctx.fillStyle = "#6af0a8";
    ctx.font = "bold 42px Verdana";
    ctx.fillText("FINISH!", WIDTH / 2 - 95, HEIGHT / 2 - 18);
    ctx.font = "20px Verdana";
    ctx.fillStyle = "#ffffff";
    const total = lapData.lapTimes.reduce((a, b) => a + b, 0);
    ctx.fillText(`TOTAL: ${formatTime(total)}`, WIDTH / 2 - 104, HEIGHT / 2 + 20);
    ctx.fillText("ENTER TO RETURN MENU", WIDTH / 2 - 144, HEIGHT / 2 + 52);
  }
}

function drawMenu() {
  ctx.fillStyle = "#0f2640";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 118px Verdana";
  ctx.fillText("CARUN", WIDTH / 2 - 245, 210);

  ctx.font = "bold 42px Verdana";
  menuItems.forEach((item, idx) => {
    const y = 360 + idx * 74;
    ctx.fillStyle = idx === state.menuIndex ? "#ffffff" : "#8aa4b8";
    if (idx === state.menuIndex) {
      ctx.fillStyle = "#ec4f4f";
      ctx.fillRect(WIDTH / 2 - 230, y - 43, 460, 56);
      ctx.fillStyle = "#ffffff";
    }
    ctx.fillText(item, WIDTH / 2 - 145, y);
  });

  ctx.font = "22px Verdana";
  ctx.fillStyle = "#bfd8f7";
  ctx.fillText("Use ↑ ↓ and Enter", WIDTH / 2 - 108, HEIGHT - 80);
}

function drawSettings() {
  ctx.fillStyle = "#142a36";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 76px Verdana";
  ctx.fillText("SETTINGS", WIDTH / 2 - 210, 180);

  ctx.font = "bold 35px Verdana";
  settingsItems.forEach((item, idx) => {
    const y = 305 + idx * 90;
    if (idx === state.settingsIndex) {
      ctx.fillStyle = "#3d7ec7";
      ctx.fillRect(WIDTH / 2 - 280, y - 42, 560, 56);
      ctx.fillStyle = "#ffffff";
    } else {
      ctx.fillStyle = "#9db6c7";
    }

    if (item === "PLAYER NAME") {
      const suffix = state.editingName ? "_" : "";
      ctx.fillText(`${item}: ${state.playerName}${suffix}`, WIDTH / 2 - 250, y);
    } else {
      ctx.fillText(item, WIDTH / 2 - 250, y);
    }
  });

  ctx.font = "20px Verdana";
  ctx.fillStyle = "#d7e9f4";
  ctx.fillText("Enter edits/chooses. Esc exits name edit.", WIDTH / 2 - 205, HEIGHT - 80);
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  if (state.mode === "menu") drawMenu();
  else if (state.mode === "settings") drawSettings();
  else {
    drawTrack();
    drawCar();
    drawStartSequenceOverlay();
    drawHUD();
  }
}

function activateSelection() {
  if (state.mode === "menu") {
    if (state.menuIndex === 0) {
      state.mode = "racing";
      resetRace();
    }
    if (state.menuIndex === 1) {
      state.mode = "settings";
      state.settingsIndex = 0;
      state.editingName = false;
    }
    return;
  }

  if (state.mode === "settings") {
    if (state.settingsIndex === 0) {
      state.editingName = !state.editingName;
    }
    if (state.settingsIndex === 1) {
      state.mode = "menu";
    }
    return;
  }

  if (state.mode === "racing" && state.finished) {
    state.mode = "menu";
  }
}

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();

  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
    e.preventDefault();
  }

  if (state.mode === "settings" && state.editingName) {
    if (key === "escape") {
      state.editingName = false;
      return;
    }
    if (key === "enter") {
      if (state.playerName.trim().length > 0) {
        state.playerName = sanitizePlayerName(state.playerName);
        savePlayerName(state.playerName);
        state.editingName = false;
      }
      return;
    }
    if (key === "backspace") {
      state.playerName = state.playerName.slice(0, -1);
      return;
    }
    if (/^[a-z0-9 ]$/.test(key) && state.playerName.length < 12) {
      state.playerName += key.toUpperCase();
      return;
    }
  }

  if (key === "arrowup") {
    if (state.mode === "menu") state.menuIndex = (state.menuIndex + menuItems.length - 1) % menuItems.length;
    if (state.mode === "settings") state.settingsIndex = (state.settingsIndex + settingsItems.length - 1) % settingsItems.length;
    keys.up = true;
  }
  if (key === "arrowdown") {
    if (state.mode === "menu") state.menuIndex = (state.menuIndex + 1) % menuItems.length;
    if (state.mode === "settings") state.settingsIndex = (state.settingsIndex + 1) % settingsItems.length;
    keys.down = true;
  }
  if (key === "enter") activateSelection();

  if (state.mode === "racing") {
    if (key === "w" || key === "arrowup") keys.accel = true;
    if (key === "s" || key === "arrowdown") keys.brake = true;
    if (key === "a" || key === "arrowleft") keys.left = true;
    if (key === "d" || key === "arrowright") keys.right = true;
    if (key === "escape") state.mode = "menu";
  }
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  if (key === "w" || key === "arrowup") {
    keys.accel = false;
    keys.up = false;
  }
  if (key === "s" || key === "arrowdown") {
    keys.brake = false;
    keys.down = false;
  }
  if (key === "a" || key === "arrowleft") keys.left = false;
  if (key === "d" || key === "arrowright") keys.right = false;
});

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  if (state.mode === "racing") {
    updateRace(dt);
  }

  render();
  requestAnimationFrame(loop);
}

initCurbSegments();
render();
requestAnimationFrame(loop);

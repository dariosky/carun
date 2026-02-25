import {
  track,
  worldObjects,
  CURB_MIN_WIDTH,
  CURB_MAX_WIDTH,
  CURB_STRIPE_LENGTH,
  CURB_OUTSET,
  ctx,
} from "./parameters.js";
import { clamp, normalizeVec, signedAngleBetween } from "./utils.js";

export function ellipseRadiusAtAngle(angle, a, b) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return 1 / Math.sqrt((c * c) / (a * a) + (s * s) / (b * b));
}

export function warpScale(angle, profile) {
  let wobble = 1;
  for (const wave of profile) {
    wobble += wave.amp * Math.sin(angle * wave.f + wave.phase);
  }
  return wobble;
}

export function trackRadiiAtAngle(angle) {
  const outer = ellipseRadiusAtAngle(angle, track.outerA, track.outerB) * warpScale(angle, track.warpOuter);
  const inner = ellipseRadiusAtAngle(angle, track.innerA, track.innerB) * warpScale(angle, track.warpInner);
  return { outer, inner };
}

export function pointOnTrackRadius(angle, radius) {
  return {
    x: track.cx + Math.cos(angle) * radius,
    y: track.cy + Math.sin(angle) * radius,
  };
}

export function pointOnCenterLine(angle) {
  const radii = trackRadiiAtAngle(angle);
  return pointOnTrackRadius(angle, (radii.outer + radii.inner) * 0.5);
}

export function sampleClosedPath(sampleFn, segments = 220) {
  const points = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(sampleFn(a));
  }
  return points;
}

export function drawPath(points) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

export function blobRadius(ellipseX, ellipseY, angle, seed = 0) {
  const base = ellipseRadiusAtAngle(angle, ellipseX, ellipseY);
  const wobble =
    1 +
    0.16 * Math.sin(angle * 2 + seed) +
    0.09 * Math.sin(angle * 4 - seed * 1.7) +
    0.06 * Math.cos(angle * 7 + seed * 0.6);
  return base * wobble;
}

export function drawStripedCurb(
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

export function initCurbSegments() {
  try {
    return buildCurbSegments();
  } catch (err) {
    console.error("Curb segment generation failed, falling back to full curbs.", err);
    return buildFullCurbSegments();
  }
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

export function pondSlowdownAt(x, y) {
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

export function surfaceAt(x, y) {
  if (pondSlowdownAt(x, y)) return "water";
  const surface = getSurface(x, y);
  if (surface === "grass" || surface === "innerGrass") return "grass";
  if (surface === "curb") return "curb";
  return "asphalt";
}

export function resolveObjectCollisions(x, y) {
  let rx = x;
  let ry = y;
  let hit = false;
  let normalX = 0;
  let normalY = 0;
  const carRadius = 8;

  for (let pass = 0; pass < 3; pass++) {
    let pushed = false;

    for (const obj of worldObjects) {
      if (obj.type !== "tree" && obj.type !== "barrel") continue;
      const minDist = obj.r + carRadius;
      const dx = rx - obj.x;
      const dy = ry - obj.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDist * minDist) continue;

      hit = true;
      pushed = true;
      const dist = Math.sqrt(Math.max(distSq, 1e-8));
      const nx = dx / dist;
      const ny = dy / dist;
      const penetration = minDist - dist;
      rx += nx * (penetration + 0.25);
      ry += ny * (penetration + 0.25);
      normalX = nx;
      normalY = ny;
    }

    if (!pushed) break;
  }

  return { x: rx, y: ry, hit, normalX, normalY };
}

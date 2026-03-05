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
import {
  cleanOffsetLoop,
  decimateClusteredVertices,
  hasSelfIntersections,
  intersectLines,
  signedLoopArea,
} from "./polygon-clean.js";

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

function normalizeAngle(angle) {
  let a = angle % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a;
}

function getCenterlineLoop(trackDef = track) {
  if (
    !Array.isArray(trackDef.centerlineLoop) ||
    trackDef.centerlineLoop.length < 3
  )
    return null;
  return trackDef.centerlineLoop;
}

export function isCenterlineTrack(trackDef = track) {
  return !!getCenterlineLoop(trackDef);
}

export function trackStartAngle(trackDef = track) {
  if (Number.isFinite(trackDef.startAngle)) return trackDef.startAngle;
  return isCenterlineTrack(trackDef) ? 0 : Math.PI * 0.5;
}

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function catmullRomTangent(p0, p1, p2, p3, t) {
  const t2 = t * t;
  return normalizeVec(
    0.5 *
      (-p0.x +
        p2.x +
        2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t +
        3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t2),
    0.5 *
      (-p0.y +
        p2.y +
        2 * (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t +
        3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t2),
  );
}

function pointOnLoopProgress(loop, progress) {
  const n = loop.length;
  if (!n) return { x: 0, y: 0 };
  const wrapped = ((progress % 1) + 1) % 1;
  const f = wrapped * n;
  const i = Math.floor(f) % n;
  const t = f - Math.floor(f);
  if (n < 4) {
    const j = (i + 1) % n;
    const a = loop[i];
    const b = loop[j];
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
  }
  const p0 = loop[(i - 1 + n) % n];
  const p1 = loop[i];
  const p2 = loop[(i + 1) % n];
  const p3 = loop[(i + 2) % n];
  return catmullRomPoint(p0, p1, p2, p3, t);
}

function tangentOnLoopProgress(loop, progress) {
  const n = loop.length;
  if (!n) return { x: 1, y: 0 };
  const wrapped = ((progress % 1) + 1) % 1;
  const f = wrapped * n;
  const i = Math.floor(f) % n;
  const t = f - Math.floor(f);
  if (n < 4) {
    const prev = loop[(i - 1 + n) % n];
    const next = loop[(i + 1) % n];
    return normalizeVec(next.x - prev.x, next.y - prev.y);
  }
  const p0 = loop[(i - 1 + n) % n];
  const p1 = loop[i];
  const p2 = loop[(i + 1) % n];
  const p3 = loop[(i + 2) % n];
  return catmullRomTangent(p0, p1, p2, p3, t);
}

function sampleLoop(loop, segments = 220) {
  const count = Math.max(3, Math.floor(segments));
  const points = new Array(count);
  for (let i = 0; i < count; i++) {
    points[i] = pointOnLoopProgress(loop, i / count);
  }
  return points;
}

// intersectLines and signedLoopArea are imported from polygon-clean.js

function offsetLoop(loop, offset, miterLimit = 2.6) {
  const n = loop.length;
  if (!n) return [];
  const orientation = signedLoopArea(loop) < 0 ? 1 : -1;
  const signedOffset = offset * orientation;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const curr = loop[i];
    const next = loop[(i + 1) % n];
    const inDir = normalizeVec(curr.x - prev.x, curr.y - prev.y);
    const outDir = normalizeVec(next.x - curr.x, next.y - curr.y);
    const inNormal = { x: -inDir.y, y: inDir.x };
    const outNormal = { x: -outDir.y, y: outDir.x };

    const inPoint = {
      x: curr.x + inNormal.x * signedOffset,
      y: curr.y + inNormal.y * signedOffset,
    };
    const outPoint = {
      x: curr.x + outNormal.x * signedOffset,
      y: curr.y + outNormal.y * signedOffset,
    };

    const candidate = intersectLines(inPoint, inDir, outPoint, outDir);
    if (candidate) {
      const miterLen = Math.hypot(candidate.x - curr.x, candidate.y - curr.y);
      if (miterLen <= Math.abs(signedOffset) * miterLimit + 1e-6) {
        out[i] = candidate;
        continue;
      }
    }

    // Bevel fallback on very sharp/degenerate corners avoids offset spikes and self-overlaps.
    const avg = normalizeVec(
      inNormal.x + outNormal.x,
      inNormal.y + outNormal.y,
    );
    const fallbackNormal =
      Math.hypot(avg.x, avg.y) > 1e-4
        ? avg
        : normalizeVec(-(inDir.y + outDir.y), inDir.x + outDir.x);
    out[i] = {
      x: curr.x + fallbackNormal.x * signedOffset,
      y: curr.y + fallbackNormal.y * signedOffset,
    };
  }
  return out;
}

function shouldCullLoopVertex(prev, curr, next, minEdgeLen, collinearTol) {
  const prevLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  const nextLen = Math.hypot(next.x - curr.x, next.y - curr.y);
  if (prevLen < minEdgeLen || nextLen < minEdgeLen) return true;

  const segX = next.x - prev.x;
  const segY = next.y - prev.y;
  const segLenSq = segX * segX + segY * segY;
  if (segLenSq < 1e-8) return true;

  // Only remove points that project inside the local hull span [prev, next].
  const t = clamp(
    ((curr.x - prev.x) * segX + (curr.y - prev.y) * segY) / segLenSq,
    0,
    1,
  );
  if (t <= 1e-3 || t >= 1 - 1e-3) return false;

  const projX = prev.x + segX * t;
  const projY = prev.y + segY * t;
  const dist = Math.hypot(curr.x - projX, curr.y - projY);
  return dist <= collinearTol;
}

function simplifyOpenPathRdp(points, epsilon) {
  if (!Array.isArray(points) || points.length <= 2)
    return Array.isArray(points) ? [...points] : [];
  const first = points[0];
  const last = points[points.length - 1];
  const segX = last.x - first.x;
  const segY = last.y - first.y;
  const segLen = Math.hypot(segX, segY);

  let maxDist = -1;
  let splitIndex = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    let dist = 0;
    if (segLen < 1e-8) {
      dist = Math.hypot(p.x - first.x, p.y - first.y);
    } else {
      dist = Math.abs((p.x - first.x) * segY - (p.y - first.y) * segX) / segLen;
    }
    if (dist > maxDist) {
      maxDist = dist;
      splitIndex = i;
    }
  }

  if (maxDist <= epsilon || splitIndex < 0) {
    return [first, last];
  }

  const left = simplifyOpenPathRdp(points.slice(0, splitIndex + 1), epsilon);
  const right = simplifyOpenPathRdp(points.slice(splitIndex), epsilon);
  return left.slice(0, -1).concat(right);
}

function simplifyClosedLoopRdp(loop, epsilon, minVertices) {
  if (!Array.isArray(loop) || loop.length < 4)
    return Array.isArray(loop) ? [...loop] : [];

  let tol = epsilon;
  let simplified = [...loop];
  for (let attempt = 0; attempt < 6; attempt++) {
    const openLoop = loop.concat([loop[0]]);
    const openSimplified = simplifyOpenPathRdp(openLoop, tol);
    simplified = openSimplified.slice(0, -1);
    if (simplified.length >= minVertices) break;
    tol *= 0.68;
  }
  return simplified.length >= 3 ? simplified : [...loop];
}

function simplifyClosedLoop(
  loop,
  {
    minEdgeLen = 1.2,
    collinearTol = 1.6,
    rdpTolerance = 2.2,
    maxPasses = 6,
    minVertices = 14,
  } = {},
) {
  if (!Array.isArray(loop) || loop.length < 4)
    return Array.isArray(loop) ? [...loop] : [];
  let points = loop.map((p) => ({ x: p.x, y: p.y }));

  for (let pass = 0; pass < maxPasses; pass++) {
    const n = points.length;
    if (n <= minVertices) break;

    const keep = new Array(n).fill(true);
    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const curr = points[i];
      const next = points[(i + 1) % n];
      if (shouldCullLoopVertex(prev, curr, next, minEdgeLen, collinearTol)) {
        keep[i] = false;
      }
    }

    const keptCount = keep.reduce((acc, v) => acc + (v ? 1 : 0), 0);
    if (keptCount < minVertices || keptCount === n) break;

    points = points.filter((_, i) => keep[i]);
  }

  return simplifyClosedLoopRdp(
    points,
    rdpTolerance,
    Math.min(minVertices, Math.max(points.length - 1, 3)),
  );
}

function simplifyOpenRunPath(points, tolerance = 1.8, minPoints = 4) {
  if (!Array.isArray(points) || points.length <= minPoints)
    return Array.isArray(points) ? [...points] : [];
  const simplified = simplifyOpenPathRdp(points, tolerance);
  return simplified.length >= minPoints ? simplified : [...points];
}

/**
 * Clean and simplify an offset polygon:
 *   1. Remove self-intersections from the raw offset (extracts outermost contour).
 *   2. Simplify the clean polygon (vertex reduction via collinearity culling + RDP).
 *   3. Clean again — simplification can reintroduce crossings on tight corners.
 *   4. Final cluster decimation — collapse any remaining groups of nearby vertices.
 *
 * This replaces the old projectInteriorVerticesToBorder heuristic with a
 * geometrically correct contour-extraction algorithm.
 */
function simplifyOffsetClosedLoop(loop, simplifyParams) {
  // Phase 1: clean raw offset self-intersections + decimate clusters.
  const cleaned = cleanOffsetLoop(loop);

  // Phase 2: simplify vertex count.
  let result = simplifyClosedLoop(cleaned, simplifyParams);

  // Phase 3: if simplification introduced new crossings, clean again.
  if (hasSelfIntersections(result)) {
    result = cleanOffsetLoop(result);
  }

  // Phase 4: final cluster decimation — catches any tight vertex groups
  // that survived collinearity culling and RDP (e.g. near sharp bends
  // where the t-projection guard in shouldCullLoopVertex skips them).
  return decimateClusteredVertices(result, simplifyParams.clusterRadius || 4);
}

function nearestDistanceAndProgressToLoop(x, y, loop) {
  let bestDistSq = Infinity;
  let bestProgress = 0;
  const n = loop.length;

  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = Math.max(dx * dx + dy * dy, 1e-8);
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / lenSq, 0, 1);
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const distSq = (x - px) * (x - px) + (y - py) * (y - py);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestProgress = (i + t) / n;
    }
  }

  return { distance: Math.sqrt(bestDistSq), progress: bestProgress };
}

export function trackRadiiAtAngle(angle, trackDef = track) {
  const loop = getCenterlineLoop(trackDef);
  if (loop) {
    const progress = normalizeAngle(angle) / (Math.PI * 2);
    const centerPoint = pointOnLoopProgress(loop, progress);
    const centerRadius = Math.hypot(
      centerPoint.x - trackDef.cx,
      centerPoint.y - trackDef.cy,
    );
    const halfWidth = Math.max(24, trackDef.centerlineHalfWidth || 90);
    return {
      outer: centerRadius + halfWidth,
      inner: Math.max(8, centerRadius - halfWidth),
    };
  }

  const outer =
    ellipseRadiusAtAngle(angle, trackDef.outerA, trackDef.outerB) *
    warpScale(angle, trackDef.warpOuter);
  const inner =
    ellipseRadiusAtAngle(angle, trackDef.innerA, trackDef.innerB) *
    warpScale(angle, trackDef.warpInner);
  return { outer, inner };
}

export function pointOnTrackRadius(angle, radius, trackDef = track) {
  return {
    x: trackDef.cx + Math.cos(angle) * radius,
    y: trackDef.cy + Math.sin(angle) * radius,
  };
}

export function pointOnCenterLine(angle, trackDef = track) {
  const loop = getCenterlineLoop(trackDef);
  if (loop) {
    const progress = normalizeAngle(angle) / (Math.PI * 2);
    return pointOnLoopProgress(loop, progress);
  }
  const radii = trackRadiiAtAngle(angle, trackDef);
  return pointOnTrackRadius(angle, (radii.outer + radii.inner) * 0.5, trackDef);
}

export function trackProgressAtPoint(x, y, trackDef = track) {
  const loop = getCenterlineLoop(trackDef);
  if (loop) {
    return nearestDistanceAndProgressToLoop(x, y, loop).progress;
  }

  const angle = normalizeAngle(Math.atan2(y - trackDef.cy, x - trackDef.cx));
  return angle / (Math.PI * 2);
}

export function trackFrameAtAngle(angle, trackDef = track) {
  const loop = getCenterlineLoop(trackDef);
  if (loop) {
    const progress = normalizeAngle(angle) / (Math.PI * 2);
    const point = pointOnLoopProgress(loop, progress);
    const tangent = tangentOnLoopProgress(loop, progress);
    const normal = { x: -tangent.y, y: tangent.x };
    const roadWidth = (trackDef.centerlineHalfWidth || 90) * 2;
    return { point, tangent, normal, roadWidth };
  }

  const radii = trackRadiiAtAngle(angle, trackDef);
  const point = pointOnTrackRadius(
    angle,
    (radii.outer + radii.inner) * 0.5,
    trackDef,
  );
  const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
  const normal = { x: Math.cos(angle), y: Math.sin(angle) };
  return { point, tangent, normal, roadWidth: radii.outer - radii.inner };
}

export function trackBoundaryPaths(trackDef = track, segments = 220) {
  const loop = getCenterlineLoop(trackDef);
  if (loop) {
    const halfWidth = Math.max(24, trackDef.centerlineHalfWidth || 90);
    const sampledCenter = sampleLoop(loop, Math.max(segments, loop.length));
    const simplifyParams = {
      minEdgeLen: Math.max(1.2, halfWidth * 0.04),
      collinearTol: Math.max(1.6, halfWidth * 0.05),
      rdpTolerance: Math.max(2.2, halfWidth * 0.08),
      clusterRadius: Math.max(4, halfWidth * 0.06),
      maxPasses: 6,
      minVertices: Math.max(14, Math.floor(sampledCenter.length * 0.08)),
    };
    const outer = simplifyOffsetClosedLoop(
      offsetLoop(sampledCenter, halfWidth),
      simplifyParams,
    );
    const inner = simplifyOffsetClosedLoop(
      offsetLoop(sampledCenter, -halfWidth),
      simplifyParams,
    );
    return {
      center: sampledCenter,
      outer,
      inner,
    };
  }

  return {
    center: sampleClosedPath((a) => pointOnCenterLine(a, trackDef), segments),
    outer: sampleClosedPath((a) => {
      const radii = trackRadiiAtAngle(a, trackDef);
      return pointOnTrackRadius(a, radii.outer, trackDef);
    }, segments),
    inner: sampleClosedPath((a) => {
      const radii = trackRadiiAtAngle(a, trackDef);
      return pointOnTrackRadius(a, radii.inner, trackDef);
    }, segments),
  };
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

  // ── Arc-length parameterisation ────────────────────────────────────
  const nPts = pathPoints.length;
  const cumulative = new Float64Array(nPts);
  for (let i = 1; i < nPts; i++) {
    const dx = pathPoints[i].x - pathPoints[i - 1].x;
    const dy = pathPoints[i].y - pathPoints[i - 1].y;
    cumulative[i] = cumulative[i - 1] + Math.hypot(dx, dy);
  }
  const totalLen = cumulative[nPts - 1];
  if (totalLen <= 0) return;

  // ── Width envelope ─────────────────────────────────────────────────
  const fadeLen = Math.min(totalLen * 0.18, stripeLen * 4);
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const widthAt = (d) => {
    if (totalLen <= fadeLen * 2) {
      return (
        minWidth +
        (maxWidth - minWidth) * Math.sin(clamp(d / totalLen, 0, 1) * Math.PI)
      );
    }
    if (d < fadeLen)
      return minWidth + (maxWidth - minWidth) * smoothstep(d / fadeLen);
    if (d > totalLen - fadeLen)
      return (
        minWidth + (maxWidth - minWidth) * smoothstep((totalLen - d) / fadeLen)
      );
    return maxWidth;
  };

  // ── Per-vertex miter normals + outer edge ──────────────────────────
  // Compute the outward normal at every path vertex by averaging the
  // normals of the two adjacent edges (miter join).  Then offset by
  // the width envelope at that vertex's arc-length position.
  const outerPts = new Array(nPts); // offset point per vertex

  for (let i = 0; i < nPts; i++) {
    let nx = 0,
      ny = 0;
    if (i > 0) {
      const dx = pathPoints[i].x - pathPoints[i - 1].x;
      const dy = pathPoints[i].y - pathPoints[i - 1].y;
      const len = Math.hypot(dx, dy) || 1;
      nx -= dy / len;
      ny += dx / len;
    }
    if (i < nPts - 1) {
      const dx = pathPoints[i + 1].x - pathPoints[i].x;
      const dy = pathPoints[i + 1].y - pathPoints[i].y;
      const len = Math.hypot(dx, dy) || 1;
      nx -= dy / len;
      ny += dx / len;
    }
    const nlen = Math.hypot(nx, ny) || 1;
    nx = (nx / nlen) * sideSign;
    ny = (ny / nlen) * sideSign;

    const w = widthAt(cumulative[i]);
    outerPts[i] = {
      x: pathPoints[i].x + nx * w,
      y: pathPoints[i].y + ny * w,
    };
  }

  // ── Helper: interpolate inner + outer points at a given arc distance
  const pointAtDist = (d) => {
    // Find the segment containing distance d.
    let seg = 0;
    while (seg < nPts - 2 && cumulative[seg + 1] < d) seg++;
    const segStart = cumulative[seg];
    const segEnd = cumulative[seg + 1];
    const t = clamp((d - segStart) / Math.max(segEnd - segStart, 1e-6), 0, 1);

    const pA = pathPoints[seg];
    const pB = pathPoints[seg + 1];
    const oA = outerPts[seg];
    const oB = outerPts[seg + 1];

    return {
      inner: { x: pA.x + (pB.x - pA.x) * t, y: pA.y + (pB.y - pA.y) * t },
      outer: { x: oA.x + (oB.x - oA.x) * t, y: oA.y + (oB.y - oA.y) * t },
      seg,
    };
  };

  // ── Draw stripes as polygons between inner and outer edges ─────────
  ctx.save();

  let stripeIndex = 0;
  for (let start = 0; start < totalLen; start += stripeLen) {
    const end = Math.min(totalLen, start + stripeLen);

    // Collect inner-edge and outer-edge vertices for this stripe span.
    const startPt = pointAtDist(start);
    const innerVerts = [startPt.inner];
    const outerVerts = [startPt.outer];
    let seg = startPt.seg;

    // Include all path vertices whose arc-length falls within (start, end).
    while (seg < nPts - 1 && cumulative[seg + 1] < end) {
      seg++;
      innerVerts.push({ x: pathPoints[seg].x, y: pathPoints[seg].y });
      outerVerts.push({ x: outerPts[seg].x, y: outerPts[seg].y });
    }

    const endPt = pointAtDist(end);
    innerVerts.push(endPt.inner);
    outerVerts.push(endPt.outer);

    if (innerVerts.length < 2) {
      stripeIndex++;
      continue;
    }

    // Draw as a single polygon: inner edge forward, outer edge reversed.
    const color = stripeIndex % 2 === 0 ? "#d22e2e" : "#ddd4be";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(innerVerts[0].x, innerVerts[0].y);
    for (let i = 1; i < innerVerts.length; i++) {
      ctx.lineTo(innerVerts[i].x, innerVerts[i].y);
    }
    for (let i = outerVerts.length - 1; i >= 0; i--) {
      ctx.lineTo(outerVerts[i].x, outerVerts[i].y);
    }
    ctx.closePath();
    ctx.fill();

    stripeIndex++;
  }

  ctx.restore();
}

function buildCurbSegments(trackDef = track) {
  const base = trackBoundaryPaths(trackDef, 280);
  const center = base.center;
  const segmentCount = center.length;
  if (segmentCount < 6) {
    throw new Error("Insufficient centerline samples for curb generation.");
  }

  let outer;
  let inner;
  if (isCenterlineTrack(trackDef)) {
    const halfWidth = Math.max(24, trackDef.centerlineHalfWidth || 90);
    const curbOffset = halfWidth - trackDef.borderSize + CURB_OUTSET;
    outer = offsetLoop(center, curbOffset);
    inner = offsetLoop(center, -curbOffset);
  } else {
    outer = sampleClosedPath((a) => {
      const radii = trackRadiiAtAngle(a, trackDef);
      return pointOnTrackRadius(
        a,
        radii.outer - trackDef.borderSize + CURB_OUTSET,
        trackDef,
      );
    }, segmentCount);
    inner = sampleClosedPath((a) => {
      const radii = trackRadiiAtAngle(a, trackDef);
      return pointOnTrackRadius(
        a,
        radii.inner + trackDef.borderSize - CURB_OUTSET,
        trackDef,
      );
    }, segmentCount);
  }

  // ── Per-sample curvature analysis ──────────────────────────────────
  // Compute signed curvature at each centerline sample.  Positive =
  // turning left (outer side is convex, has more room for curbs), negative
  // = turning right (inner side has more room).
  const signedCurvatures = new Float64Array(segmentCount);
  const absCurvatures = new Float64Array(segmentCount);

  for (let i = 0; i < segmentCount; i++) {
    const prev = center[(i - 1 + segmentCount) % segmentCount];
    const curr = center[i];
    const next = center[(i + 1) % segmentCount];

    const segIn = normalizeVec(curr.x - prev.x, curr.y - prev.y);
    const segOut = normalizeVec(next.x - curr.x, next.y - curr.y);
    const signedTurn = signedAngleBetween(segIn, segOut);
    const ds =
      (Math.hypot(curr.x - prev.x, curr.y - prev.y) +
        Math.hypot(next.x - curr.x, next.y - curr.y)) *
      0.5;
    const kappa = signedTurn / Math.max(ds, 1);
    signedCurvatures[i] = kappa;
    absCurvatures[i] = Math.abs(kappa);
  }

  // ── Adaptive curvature threshold ───────────────────────────────────
  const sortedAbs = Array.from(absCurvatures).sort((a, b) => a - b);
  const curvatureThreshold =
    sortedAbs[Math.floor(sortedAbs.length * 0.62)] || 0.0022;

  // ── Per-sample available-space estimation ──────────────────────────
  // For each centerline sample, measure the distance from the curb path
  // (outer/inner) to the center.  On the inside of a tight turn, the
  // curb path compresses toward the center → small distance → little
  // room for a visible curb.
  const outerSpace = new Float64Array(segmentCount);
  const innerSpace = new Float64Array(segmentCount);
  for (let i = 0; i < segmentCount; i++) {
    const c = center[i];
    outerSpace[i] = Math.hypot(outer[i].x - c.x, outer[i].y - c.y);
    innerSpace[i] = Math.hypot(inner[i].x - c.x, inner[i].y - c.y);
  }

  // Minimum space required for a curb to look good (must fit at least
  // a few stripe widths without looking cramped).
  const minCurbSpace = CURB_MAX_WIDTH * 1.5;

  // ── Per-sample curb eligibility (separate per side) ────────────────
  // A sample is eligible for a curb on a given side when:
  //   1. The absolute curvature exceeds the threshold, AND
  //   2. The available space on that side is large enough, AND
  //   3. The curvature sign means this side is the OUTSIDE of the turn
  //      (where curbs naturally sit and have room), OR the curvature is
  //      very high (hairpin) where both sides get curbs if space allows.
  const outerEligible = new Uint8Array(segmentCount);
  const innerEligible = new Uint8Array(segmentCount);

  // Higher threshold for "inside-of-turn" curbs (need stronger curvature
  // to justify a curb on the compressed side).
  const insideCurvatureBoost = 1.8;

  for (let i = 0; i < segmentCount; i++) {
    if (absCurvatures[i] < curvatureThreshold) continue;

    // Positive signed curvature → turning left → outer side is convex
    // (outside of turn), inner is concave (inside of turn).
    const outerIsOutside = signedCurvatures[i] > 0;

    // Outer side eligibility
    if (outerSpace[i] >= minCurbSpace) {
      if (
        outerIsOutside ||
        absCurvatures[i] >= curvatureThreshold * insideCurvatureBoost
      ) {
        outerEligible[i] = 1;
      }
    }

    // Inner side eligibility
    if (innerSpace[i] >= minCurbSpace) {
      if (
        !outerIsOutside ||
        absCurvatures[i] >= curvatureThreshold * insideCurvatureBoost
      ) {
        innerEligible[i] = 1;
      }
    }
  }

  // ── Expand eligible regions slightly (smooth short gaps) ───────────
  const expandBy = 2;
  const expandMask = (mask) => {
    const expanded = new Uint8Array(segmentCount);
    for (let i = 0; i < segmentCount; i++) {
      if (!mask[i]) continue;
      for (let j = -expandBy; j <= expandBy; j++) {
        expanded[(i + j + segmentCount) % segmentCount] = 1;
      }
    }
    return expanded;
  };

  const outerExpanded = expandMask(outerEligible);
  const innerExpanded = expandMask(innerEligible);

  // Re-check space constraint after expansion (don't let expansion push
  // curbs into cramped areas).
  for (let i = 0; i < segmentCount; i++) {
    if (outerExpanded[i] && outerSpace[i] < minCurbSpace) outerExpanded[i] = 0;
    if (innerExpanded[i] && innerSpace[i] < minCurbSpace) innerExpanded[i] = 0;
  }

  // ── Collect contiguous runs and filter by minimum arc length ───────
  const minRunArcLength = CURB_STRIPE_LENGTH * 3; // at least 3 stripes

  // Compute the centroid of the centerline — used to determine the
  // outward extrusion direction for each curb run.
  let centroidX = 0,
    centroidY = 0;
  for (let i = 0; i < segmentCount; i++) {
    centroidX += center[i].x;
    centroidY += center[i].y;
  }
  centroidX /= segmentCount;
  centroidY /= segmentCount;

  const collectRuns = (points, mask, isOuter) => {
    const runs = [];
    const allTrue = mask.every((v) => v);
    if (allTrue) {
      const simplified = simplifyOpenRunPath([...points, points[0]], 1.8, 4);
      runs.push(simplified);
    } else {
      let current = null;
      for (let i = 0; i < segmentCount; i++) {
        if (mask[i]) {
          if (!current) current = [];
          current.push(points[i]);
        } else if (current) {
          current.push(points[i]); // closing point
          runs.push(current);
          current = null;
        }
      }

      // Handle wrap-around.
      if (current) {
        current.push(points[0]);
        if (runs.length && mask[0]) {
          const first = runs.shift();
          runs.unshift([...current, ...first]);
        } else {
          runs.push(current);
        }
      }
    }

    // Filter by minimum arc length, simplify, and compute outward sign.
    return runs
      .filter((run) => {
        if (run.length < 4) return false;
        let arcLen = 0;
        for (let i = 1; i < run.length; i++) {
          arcLen += Math.hypot(
            run[i].x - run[i - 1].x,
            run[i].y - run[i - 1].y,
          );
        }
        return arcLen >= minRunArcLength;
      })
      .map((run) => {
        const simplified = simplifyOpenRunPath(run, 1.8, 4);

        // Determine outward sign: the curb must extrude AWAY from the
        // track surface.
        //   - Outer curbs: away from centroid (outward from the track ring).
        //   - Inner curbs: toward centroid (into the hole, away from road).
        const midIdx = Math.floor(simplified.length / 2);
        const pA = simplified[Math.max(0, midIdx - 1)];
        const pB = simplified[Math.min(simplified.length - 1, midIdx)];
        const tdx = pB.x - pA.x;
        const tdy = pB.y - pA.y;
        const tlen = Math.hypot(tdx, tdy) || 1;
        const tx = tdx / tlen;
        const ty = tdy / tlen;
        // Normal for sideSign=+1: (-ty, tx)
        const nxPos = -ty;
        const nyPos = tx;
        // Midpoint of this segment
        const mx = (pA.x + pB.x) * 0.5;
        const my = (pA.y + pB.y) * 0.5;
        // Dot with vector from midpoint to centroid
        const toCenterX = centroidX - mx;
        const toCenterY = centroidY - my;
        const dot = nxPos * toCenterX + nyPos * toCenterY;

        // For outer curbs: extrude away from centroid.
        //   dot > 0 means sideSign=+1 normal points toward centroid → need -1.
        // For inner curbs: extrude toward centroid.
        //   dot > 0 means sideSign=+1 normal points toward centroid → need +1.
        const outwardSign = isOuter ? (dot > 0 ? -1 : 1) : dot > 0 ? 1 : -1;

        return { points: simplified, outwardSign };
      });
  };

  return {
    outer: collectRuns(outer, outerExpanded, true),
    inner: collectRuns(inner, innerExpanded, false),
  };
}

function buildFullCurbSegments(trackDef = track) {
  if (isCenterlineTrack(trackDef)) {
    const center = trackBoundaryPaths(trackDef, 420).center;
    const halfWidth = Math.max(24, trackDef.centerlineHalfWidth || 90);
    const curbOffset = halfWidth - trackDef.borderSize + CURB_OUTSET;
    const simplifyParams = {
      minEdgeLen: Math.max(1.2, halfWidth * 0.035),
      collinearTol: Math.max(1.4, halfWidth * 0.045),
      rdpTolerance: Math.max(1.8, halfWidth * 0.07),
      clusterRadius: Math.max(4, halfWidth * 0.06),
      maxPasses: 6,
      minVertices: Math.max(14, Math.floor(center.length * 0.08)),
    };
    const outerLoop = simplifyOffsetClosedLoop(
      offsetLoop(center, curbOffset),
      simplifyParams,
    );
    const innerLoop = simplifyOffsetClosedLoop(
      offsetLoop(center, -curbOffset),
      simplifyParams,
    );

    // Compute outward signs using the centerline centroid.
    // isOuter=true → extrude away from centroid; false → toward centroid.
    const computeOutwardSign = (loop, isOuter) => {
      const n = loop.length;
      let cx = 0,
        cy = 0;
      for (let i = 0; i < center.length; i++) {
        cx += center[i].x;
        cy += center[i].y;
      }
      cx /= center.length;
      cy /= center.length;
      const midIdx = Math.floor(n / 2);
      const pA = loop[midIdx];
      const pB = loop[(midIdx + 1) % n];
      const dx = pB.x - pA.x,
        dy = pB.y - pA.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -(dy / len),
        ny = dx / len; // sideSign=+1 normal
      const dot = nx * (cx - pA.x) + ny * (cy - pA.y);
      return isOuter ? (dot > 0 ? -1 : 1) : dot > 0 ? 1 : -1;
    };

    return {
      outer: [
        { points: outerLoop, outwardSign: computeOutwardSign(outerLoop, true) },
      ],
      inner: [
        {
          points: innerLoop,
          outwardSign: computeOutwardSign(innerLoop, false),
        },
      ],
    };
  }

  // Elliptical track: outer curbs extrude outward (-1), inner extrude inward (+1).
  return {
    outer: [
      {
        points: sampleClosedPath((a) => {
          const radii = trackRadiiAtAngle(a, trackDef);
          return pointOnTrackRadius(
            a,
            radii.outer - trackDef.borderSize + CURB_OUTSET,
            trackDef,
          );
        }),
        outwardSign: -1,
      },
    ],
    inner: [
      {
        points: sampleClosedPath((a) => {
          const radii = trackRadiiAtAngle(a, trackDef);
          return pointOnTrackRadius(
            a,
            radii.inner + trackDef.borderSize - CURB_OUTSET,
            trackDef,
          );
        }),
        outwardSign: 1,
      },
    ],
  };
}

export function initCurbSegments(trackDef = track) {
  try {
    return buildCurbSegments(trackDef);
  } catch (err) {
    console.error(
      "Curb segment generation failed, falling back to full curbs.",
      err,
    );
    return buildFullCurbSegments(trackDef);
  }
}

function getSurface(x, y) {
  const loop = getCenterlineLoop(track);
  if (loop) {
    const { distance } = nearestDistanceAndProgressToLoop(x, y, loop);
    const halfWidth = Math.max(24, track.centerlineHalfWidth || 90);
    if (distance > halfWidth) return "grass";
    if (distance > halfWidth - track.borderSize) return "curb";
    return "asphalt";
  }

  const dx = x - track.cx;
  const dy = y - track.cy;
  const angle = Math.atan2(dy, dx);
  const dist = Math.hypot(dx, dy);
  const radii = trackRadiiAtAngle(angle);

  if (dist > radii.outer) return "grass";
  if (dist < radii.inner) return "innerGrass";

  if (
    dist > radii.outer - track.borderSize ||
    dist < radii.inner + track.borderSize
  )
    return "curb";

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

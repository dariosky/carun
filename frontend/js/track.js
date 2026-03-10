import {
  track,
  worldObjects,
  CURB_MIN_WIDTH,
  CURB_MAX_WIDTH,
  CURB_STRIPE_LENGTH,
  CURB_OUTSET,
  CHECKPOINT_WIDTH_MULTIPLIER,
  ctx,
  checkpoints,
  physicsConfig,
} from "./parameters.js";
import { clamp, normalizeVec, signedAngleBetween } from "./utils.js";
import {
  cleanOffsetLoop,
  decimateClusteredVertices,
  hasSelfIntersections,
  intersectLines,
  signedLoopArea,
} from "./polygon-clean.js";

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

function getCenterlineWidthProfile(trackDef = track) {
  if (
    Array.isArray(trackDef.centerlineWidthProfile) &&
    trackDef.centerlineWidthProfile.length >= 3
  ) {
    return trackDef.centerlineWidthProfile;
  }
  return null;
}

export function getTrackWorldScale(trackDef = track) {
  const raw = Number(trackDef?.worldScale);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0.5, Math.min(1.75, raw));
}

export function trackStartAngle(trackDef = track) {
  if (Number.isFinite(trackDef.startAngle)) return trackDef.startAngle;
  return 0;
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

export function pointOnCenterLine(angle, trackDef = track) {
  const loop = getCenterlineLoop(trackDef);
  if (!loop) return { x: trackDef.cx, y: trackDef.cy };
  const progress = normalizeAngle(angle) / (Math.PI * 2);
  return pointOnLoopProgress(loop, progress);
}

export function trackProgressAtPoint(x, y, trackDef = track) {
  const loop = getCenterlineLoop(trackDef);
  if (!loop) return 0;
  return nearestDistanceAndProgressToLoop(x, y, loop).progress;
}

export function trackFrameAtAngle(angle, trackDef = track) {
  const loop = getCenterlineLoop(trackDef);
  if (!loop) {
    const roadWidth = Math.max(24, trackDef.centerlineHalfWidth || 60) * 2;
    return {
      point: { x: trackDef.cx, y: trackDef.cy },
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
      roadWidth,
    };
  }
  const progress = normalizeAngle(angle) / (Math.PI * 2);
  const point = pointOnLoopProgress(loop, progress);
  const tangent = tangentOnLoopProgress(loop, progress);
  const normal = { x: -tangent.y, y: tangent.x };
  const roadWidth = sampleCenterlineHalfWidth(progress, trackDef) * 2;
  return { point, tangent, normal, roadWidth };
}

export function sampleCenterlineHalfWidth(progress, trackDef = track) {
  const profile = getCenterlineWidthProfile(trackDef);
  const fallback = Math.max(24, trackDef.centerlineHalfWidth || 90);
  if (!profile || !profile.length) return fallback;
  const wrapped = ((progress % 1) + 1) % 1;
  const f = wrapped * profile.length;
  const baseIndex = Math.floor(f) % profile.length;
  const t = f - Math.floor(f);
  const a = Number.isFinite(profile[baseIndex]) ? profile[baseIndex] : fallback;
  const b = Number.isFinite(profile[(baseIndex + 1) % profile.length])
    ? profile[(baseIndex + 1) % profile.length]
    : a;
  return Math.max(24, a + (b - a) * t);
}

function sampleCenterlineWidthSeries(trackDef, count) {
  const widths = new Array(count);
  for (let i = 0; i < count; i++) {
    widths[i] = sampleCenterlineHalfWidth(i / count, trackDef);
  }
  return widths;
}

function offsetLoopVariable(loop, offsets, miterLimit = 2.6) {
  const n = loop.length;
  if (!n) return [];
  const orientation = signedLoopArea(loop) < 0 ? 1 : -1;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const curr = loop[i];
    const next = loop[(i + 1) % n];
    const inDir = normalizeVec(curr.x - prev.x, curr.y - prev.y);
    const outDir = normalizeVec(next.x - curr.x, next.y - curr.y);
    const inNormal = { x: -inDir.y, y: inDir.x };
    const outNormal = { x: -outDir.y, y: outDir.x };
    const signedOffset = (offsets[i] || 0) * orientation;

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

export function trackBoundaryPaths(trackDef = track, segments = 220) {
  const loop = getCenterlineLoop(trackDef);
  if (!loop) return { center: [], outer: [], inner: [] };
  const sampledCenter = sampleLoop(loop, Math.max(segments, loop.length));
  const widthSamples = sampleCenterlineWidthSeries(
    trackDef,
    sampledCenter.length,
  );
  const outer = offsetLoopVariable(sampledCenter, widthSamples);
  const inner = offsetLoopVariable(
    sampledCenter,
    widthSamples.map((value) => -value),
  );
  return {
    center: sampledCenter,
    outer,
    inner,
  };
}

let cachedTrackNavGraph = null;
let cachedTrackNavSignature = "";

function trackNavSignature(trackDef = track, objects = worldObjects) {
  const loop = Array.isArray(trackDef.centerlineLoop)
    ? trackDef.centerlineLoop
    : [];
  const widths = Array.isArray(trackDef.centerlineWidthProfile)
    ? trackDef.centerlineWidthProfile
    : [];
  const checkpointSig = checkpoints
    .map((checkpoint) => Number(checkpoint?.angle || 0).toFixed(4))
    .join(",");
  const objectSig = (objects || [])
    .map((obj) => {
      const normalized = normalizeWorldObject(obj);
      if (!normalized) return "x";
      return [
        normalized.type,
        Number(normalized.x || 0).toFixed(1),
        Number(normalized.y || 0).toFixed(1),
        Number(normalized.r || 0).toFixed(1),
        Number(normalized.rx || 0).toFixed(1),
        Number(normalized.ry || 0).toFixed(1),
        Number(normalized.width || 0).toFixed(1),
        Number(normalized.length || 0).toFixed(1),
        Number(normalized.angle || 0).toFixed(3),
      ].join(":");
    })
    .join("|");
  return [
    Number(trackDef.cx || 0).toFixed(1),
    Number(trackDef.cy || 0).toFixed(1),
    Number(trackDef.borderSize || 0).toFixed(1),
    Number(trackDef.centerlineHalfWidth || 0).toFixed(1),
    Number(trackDef.worldScale || 1).toFixed(2),
    loop
      .map(
        (point) =>
          `${Number(point.x || 0).toFixed(1)},${Number(point.y || 0).toFixed(1)}`,
      )
      .join(";"),
    widths.map((value) => Number(value || 0).toFixed(1)).join(","),
    checkpointSig,
    objectSig,
  ].join("#");
}

function addNavEdge(edges, fromNode, toNode, cost, step, kind = "progress") {
  if (!fromNode || !toNode || toNode.id === fromNode.id) return;
  const edgeList = edges[fromNode.id];
  if (!edgeList) return;
  const existing = edgeList.find((edge) => edge.to === toNode.id);
  if (existing) {
    if (cost < existing.cost) {
      existing.cost = cost;
      existing.step = step;
      existing.kind = kind;
    }
    return;
  }
  edgeList.push({ to: toNode.id, cost, step, kind });
}

function nodeSurfacePenalty(surfaceName) {
  const aiCfg = physicsConfig.ai;
  if (surfaceName === "curb") return aiCfg.edgeCurbPenalty;
  if (surfaceName === "grass") return aiCfg.edgeGrassPenalty;
  if (surfaceName === "water") return aiCfg.edgeWaterPenalty;
  return 0;
}

function computeBaseTargetSpeed(curvature) {
  const aiCfg = physicsConfig.ai;
  const excessCurvature = Math.max(0, curvature - aiCfg.fullThrottleCurvature);
  return clamp(
    aiCfg.targetSpeedMax -
      excessCurvature * aiCfg.curvatureSpeedScale +
      aiCfg.curvatureSpeedBias,
    aiCfg.cornerSpeedMin,
    aiCfg.targetSpeedMax,
  );
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function clearNavSegment(
  ax,
  ay,
  bx,
  by,
  trackDef = track,
  objects = worldObjects,
) {
  const samples = 6;
  for (let step = 0; step <= samples; step++) {
    const t = step / samples;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const surface = surfaceAtForTrack(x, y, trackDef, objects);
    if (surface === "water") return false;
    if (resolveObjectCollisions(x, y, 0, objects).hit) return false;
  }
  return true;
}

function distanceToSolidObject(x, y, obj) {
  if (!obj) return Infinity;
  if (obj.type === "wall") {
    const dx = x - obj.x;
    const dy = y - obj.y;
    const cos = Math.cos(obj.angle);
    const sin = Math.sin(obj.angle);
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    const halfLength = obj.length * 0.5;
    const halfWidth = obj.width * 0.5;
    const deltaX = Math.abs(localX) - halfLength;
    const deltaY = Math.abs(localY) - halfWidth;
    if (deltaX <= 0 && deltaY <= 0) {
      return -Math.min(-deltaX, -deltaY);
    }
    const outsideX = Math.max(deltaX, 0);
    const outsideY = Math.max(deltaY, 0);
    return Math.hypot(outsideX, outsideY);
  }
  if (obj.type === "tree" || obj.type === "barrel") {
    return Math.hypot(x - obj.x, y - obj.y) - obj.r;
  }
  return Infinity;
}

function obstaclePenaltyAtPoint(x, y, objects = worldObjects) {
  const aiCfg = physicsConfig.ai;
  let penalty = 0;
  let minClearance = Infinity;
  for (const obj of getSolidObjects(objects)) {
    const clearance = distanceToSolidObject(x, y, obj);
    minClearance = Math.min(minClearance, clearance);
    if (clearance <= aiCfg.obstacleHardClearance) {
      return { penalty: aiCfg.obstaclePenalty * 4, blocked: true, clearance };
    }
    if (clearance < aiCfg.obstacleAvoidanceRadius) {
      const t =
        1 -
        clearance /
          Math.max(
            aiCfg.obstacleAvoidanceRadius,
            aiCfg.obstacleHardClearance + 1,
          );
      penalty += aiCfg.obstaclePenalty * t * t;
    }
  }
  return { penalty, blocked: false, clearance: minClearance };
}

function obstaclePenaltyAlongSegment(ax, ay, bx, by, objects = worldObjects) {
  const samples = 6;
  let penalty = 0;
  let minClearance = Infinity;
  for (let step = 0; step <= samples; step++) {
    const t = step / samples;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const info = obstaclePenaltyAtPoint(x, y, objects);
    if (info.blocked) {
      return {
        penalty: physicsConfig.ai.obstaclePenalty * 4,
        blocked: true,
        clearance: info.clearance,
      };
    }
    penalty = Math.max(penalty, info.penalty);
    minClearance = Math.min(minClearance, info.clearance);
  }
  return { penalty, blocked: false, clearance: minClearance };
}

function buildCheckpointGoalNodeIds(nodes, trackDef = track) {
  const aiCfg = physicsConfig.ai;
  return checkpoints.map((checkpoint) => {
    const frame = trackFrameAtAngle(checkpoint.angle, trackDef);
    const halfSpan =
      frame.roadWidth * CHECKPOINT_WIDTH_MULTIPLIER * 0.5 +
      aiCfg.checkpointGoalLateralMargin;
    const approachDepth = Math.max(
      aiCfg.checkpointGoalDepth,
      frame.roadWidth * 0.22,
    );
    const exitDepth = Math.max(
      aiCfg.checkpointGoalExitDepth,
      frame.roadWidth * 0.34,
    );
    const candidates = [];
    for (const node of nodes) {
      const dx = node.x - frame.point.x;
      const dy = node.y - frame.point.y;
      const approach = dx * frame.tangent.x + dy * frame.tangent.y;
      if (approach < -approachDepth || approach > exitDepth) continue;
      const lateral = Math.abs(dx * frame.normal.x + dy * frame.normal.y);
      if (lateral > halfSpan) continue;
      const headingAlignment =
        node.tangentX * frame.tangent.x + node.tangentY * frame.tangent.y;
      if (headingAlignment < aiCfg.checkpointGoalHeadingAlignment) continue;
      candidates.push({
        id: node.id,
        score:
          Math.abs(approach - Math.min(exitDepth * 0.35, 18)) * 1.4 +
          lateral * 0.9 +
          Math.max(0, 1 - headingAlignment) * 42 +
          nodeSurfacePenalty(node.surface) * 0.15 +
          node.obstaclePenalty * 0.05,
      });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates
      .slice(0, aiCfg.checkpointGoalNodeLimit)
      .map((candidate) => candidate.id);
  });
}

function positiveProgressDelta(from, to) {
  const delta = to - from;
  return delta >= 0 ? delta : delta + 1;
}

function pickRouteStartNodeId(trackDef, graph) {
  const startAngle = trackStartAngle(trackDef);
  const startFrame = trackFrameAtAngle(startAngle, trackDef);
  const startSlice =
    Math.round(
      (normalizeAngle(startAngle) / (Math.PI * 2)) * graph.progressCount,
    ) % graph.progressCount;
  const sliceNodeIds = graph.nodesBySlice[startSlice].filter(
    (nodeId) => nodeId >= 0,
  );
  if (sliceNodeIds.length) {
    let bestNodeId = sliceNodeIds[0];
    let bestDistance = Infinity;
    for (const nodeId of sliceNodeIds) {
      const node = graph.nodes[nodeId];
      const distance = Math.hypot(
        node.x - startFrame.point.x,
        node.y - startFrame.point.y,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestNodeId = nodeId;
      }
    }
    return bestNodeId;
  }
  return graph.nodes[0]?.id ?? -1;
}

function chooseBestLapEdge(node, graph) {
  const aiCfg = physicsConfig.ai;
  let bestEdge = null;
  let bestScore = Infinity;
  for (const edge of graph.edges[node.id]) {
    const nextNode = graph.nodes[edge.to];
    if (!nextNode) continue;
    let futureCost = 0;
    let followNode = null;
    if (graph.edges[nextNode.id].length) {
      let bestFollowScore = Infinity;
      for (const candidate of graph.edges[nextNode.id]) {
        const candidateNode = graph.nodes[candidate.to];
        if (!candidateNode) continue;
        const score = candidate.cost + candidateNode.curvature * 65;
        if (score < bestFollowScore) {
          bestFollowScore = score;
          futureCost = score;
          followNode = candidateNode;
        }
      }
    }
    const futureTurn =
      nextNode.signedCurvature + (followNode?.signedCurvature ?? 0) * 0.9;
    const turnDir = Math.sign(futureTurn);
    const turnStrength = clamp01(Math.abs(futureTurn) * 5.5);
    const apexStrength = clamp01(Math.abs(nextNode.signedCurvature) * 7.5);
    const entryTarget =
      -turnDir * nextNode.roadHalfWidth * (0.5 + turnStrength * 0.22);
    const apexTarget =
      turnDir * nextNode.roadHalfWidth * (0.22 + turnStrength * 0.38);
    const desiredOffset =
      turnDir === 0 ? 0 : apexStrength > 0.52 ? apexTarget : entryTarget;
    const linePenalty =
      turnDir === 0
        ? Math.abs(nextNode.laneOffset) * 0.04
        : Math.abs(nextNode.laneOffset - desiredOffset) *
          (apexStrength > 0.52
            ? aiCfg.apexCommitWeight
            : aiCfg.apexApproachWeight);
    const transitionPenalty =
      turnDir === 0
        ? Math.abs(nextNode.laneOffset - node.laneOffset) * 0.04
        : Math.abs(
            nextNode.laneOffset -
              node.laneOffset -
              (desiredOffset - node.laneOffset),
          ) * aiCfg.apexTransitionWeight;
    const score =
      edge.cost * 0.86 +
      futureCost * 0.52 +
      nextNode.curvature * 72 -
      nextNode.baseTargetSpeed * 0.045 +
      nextNode.obstaclePenalty * 0.9 +
      linePenalty +
      transitionPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestEdge = edge;
    }
  }
  return bestEdge;
}

function buildBestLapRoute(graph, trackDef) {
  if (!graph.nodes.length) {
    return {
      bestLapRouteNodeIds: [],
      routeIndexByNodeId: new Int32Array(0),
      routeTargetSpeeds: [],
    };
  }

  const startNodeId = pickRouteStartNodeId(trackDef, graph);
  const routeNodeIds = [];
  const routeSlices = new Set();
  let currentNodeId = startNodeId;
  let guard = 0;
  while (currentNodeId >= 0 && guard < graph.progressCount + 24) {
    const currentNode = graph.nodes[currentNodeId];
    if (!currentNode) break;
    routeNodeIds.push(currentNodeId);
    routeSlices.add(currentNode.sliceIndex);
    const bestEdge = chooseBestLapEdge(currentNode, graph);
    if (!bestEdge) break;
    currentNodeId = bestEdge.to;
    if (
      routeSlices.size >= graph.progressCount &&
      graph.nodes[currentNodeId]?.sliceIndex ===
        graph.nodes[startNodeId]?.sliceIndex
    ) {
      break;
    }
    guard += 1;
  }

  if (!routeNodeIds.length) {
    routeNodeIds.push(startNodeId);
  }

  const routeTargetSpeeds = routeNodeIds.map(
    (nodeId) => graph.nodes[nodeId].baseTargetSpeed,
  );
  for (let i = routeTargetSpeeds.length - 2; i >= 0; i--) {
    const node = graph.nodes[routeNodeIds[i]];
    const nextNode = graph.nodes[routeNodeIds[i + 1]];
    const segmentDistance = Math.hypot(
      nextNode.x - node.x,
      nextNode.y - node.y,
    );
    const carrySpeed =
      routeTargetSpeeds[i + 1] +
      segmentDistance * physicsConfig.ai.brakeCarryPerUnit;
    routeTargetSpeeds[i] = Math.min(routeTargetSpeeds[i], carrySpeed);
  }
  if (routeTargetSpeeds.length > 1) {
    const tailDistance = Math.hypot(
      graph.nodes[routeNodeIds[0]].x -
        graph.nodes[routeNodeIds[routeNodeIds.length - 1]].x,
      graph.nodes[routeNodeIds[0]].y -
        graph.nodes[routeNodeIds[routeNodeIds.length - 1]].y,
    );
    routeTargetSpeeds[routeTargetSpeeds.length - 1] = Math.min(
      routeTargetSpeeds[routeTargetSpeeds.length - 1],
      routeTargetSpeeds[0] + tailDistance * physicsConfig.ai.brakeCarryPerUnit,
    );
  }

  const routeIndexByNodeId = new Int32Array(graph.nodes.length);
  routeIndexByNodeId.fill(-1);
  routeNodeIds.forEach((nodeId, routeIndex) => {
    if (routeIndexByNodeId[nodeId] < 0) routeIndexByNodeId[nodeId] = routeIndex;
    graph.nodes[nodeId].targetSpeed = routeTargetSpeeds[routeIndex];
  });

  return {
    bestLapRouteNodeIds: routeNodeIds,
    routeIndexByNodeId,
    routeTargetSpeeds,
  };
}

export function getTrackNavigationGraph(
  trackDef = track,
  objects = worldObjects,
) {
  const signature = trackNavSignature(trackDef, objects);
  if (cachedTrackNavGraph && cachedTrackNavSignature === signature) {
    return cachedTrackNavGraph;
  }

  const aiCfg = physicsConfig.ai;
  const progressCount = Math.max(
    24,
    Math.floor(aiCfg.navProgressSamples || 96),
  );
  const laneFactors =
    Array.isArray(aiCfg.navLaneSamples) && aiCfg.navLaneSamples.length
      ? [...aiCfg.navLaneSamples]
      : [-1.35, -1.1, -0.84, -0.56, -0.28, 0, 0.28, 0.56, 0.84, 1.1, 1.35];
  const sliceFrames = new Array(progressCount);
  const sliceCurvatures = new Array(progressCount).fill(0);
  const sliceSignedCurvatures = new Array(progressCount).fill(0);
  const nodes = [];
  const nodesBySlice = Array.from({ length: progressCount }, () =>
    new Array(laneFactors.length).fill(-1),
  );

  for (let i = 0; i < progressCount; i++) {
    const progress = i / progressCount;
    sliceFrames[i] = trackFrameAtAngle(progress * Math.PI * 2, trackDef);
  }
  for (let i = 0; i < progressCount; i++) {
    const prev = sliceFrames[(i - 1 + progressCount) % progressCount].tangent;
    const next = sliceFrames[(i + 1) % progressCount].tangent;
    const signedCurvature = signedAngleBetween(prev, next);
    sliceSignedCurvatures[i] = signedCurvature;
    sliceCurvatures[i] = Math.abs(signedCurvature);
  }

  for (let sliceIndex = 0; sliceIndex < progressCount; sliceIndex++) {
    const progress = sliceIndex / progressCount;
    const frame = sliceFrames[sliceIndex];
    const roadHalfWidth = frame.roadWidth * 0.5;
    const curvature = sliceCurvatures[sliceIndex];
    for (let laneIndex = 0; laneIndex < laneFactors.length; laneIndex++) {
      const laneFactor = laneFactors[laneIndex];
      const laneOffset = roadHalfWidth * laneFactor * 0.92;
      const x = frame.point.x + frame.normal.x * laneOffset;
      const y = frame.point.y + frame.normal.y * laneOffset;
      const surface = surfaceAtForTrack(x, y, trackDef, objects);
      if (surface === "water") continue;
      if (resolveObjectCollisions(x, y, 0, objects).hit) continue;
      const obstacleInfo = obstaclePenaltyAtPoint(x, y, objects);
      if (obstacleInfo.blocked) continue;
      const baseTargetSpeed = computeBaseTargetSpeed(curvature);
      const nodeId = nodes.length;
      nodes.push({
        id: nodeId,
        sliceIndex,
        laneIndex,
        progress,
        x,
        y,
        surface,
        laneOffset,
        roadHalfWidth,
        tangentX: frame.tangent.x,
        tangentY: frame.tangent.y,
        normalX: frame.normal.x,
        normalY: frame.normal.y,
        curvature,
        signedCurvature: sliceSignedCurvatures[sliceIndex],
        obstaclePenalty: obstacleInfo.penalty,
        obstacleClearance: obstacleInfo.clearance,
        baseTargetSpeed,
        targetSpeed: baseTargetSpeed,
      });
      nodesBySlice[sliceIndex][laneIndex] = nodeId;
    }
  }

  const edges = Array.from({ length: nodes.length }, () => []);
  for (const node of nodes) {
    for (const step of [1, 2]) {
      const nextSliceIndex = (node.sliceIndex + step) % progressCount;
      for (
        let nextLaneIndex = Math.max(0, node.laneIndex - 1);
        nextLaneIndex <= Math.min(laneFactors.length - 1, node.laneIndex + 1);
        nextLaneIndex++
      ) {
        const nextNodeId = nodesBySlice[nextSliceIndex][nextLaneIndex];
        if (nextNodeId < 0) continue;
        const nextNode = nodes[nextNodeId];
        if (
          !clearNavSegment(
            node.x,
            node.y,
            nextNode.x,
            nextNode.y,
            trackDef,
            objects,
          )
        ) {
          continue;
        }
        const segmentObstacleInfo = obstaclePenaltyAlongSegment(
          node.x,
          node.y,
          nextNode.x,
          nextNode.y,
          objects,
        );
        if (segmentObstacleInfo.blocked) continue;
        const distance = Math.hypot(nextNode.x - node.x, nextNode.y - node.y);
        const laneChangePenalty =
          Math.abs(nextNode.laneIndex - node.laneIndex) *
          aiCfg.laneChangePenalty;
        const surfacePenalty =
          nodeSurfacePenalty(node.surface) +
          nodeSurfacePenalty(nextNode.surface);
        const curvaturePenalty = nextNode.curvature * 42;
        const cost =
          distance +
          laneChangePenalty +
          surfacePenalty +
          curvaturePenalty +
          (node.obstaclePenalty + nextNode.obstaclePenalty) * 0.35 +
          segmentObstacleInfo.penalty * 0.8 +
          (step - 1) * 4;
        addNavEdge(edges, node, nextNode, cost, step, "progress");
      }
    }
  }

  for (const node of nodes) {
    const shortcutEdges = [];
    for (const candidate of nodes) {
      if (candidate.id === node.id) continue;
      const sliceGapRaw = Math.abs(candidate.sliceIndex - node.sliceIndex);
      const sliceGap = Math.min(sliceGapRaw, progressCount - sliceGapRaw);
      if (sliceGap < aiCfg.navIntersectionMinSliceGap) continue;
      const dx = candidate.x - node.x;
      const dy = candidate.y - node.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= 1e-5 || distance > aiCfg.navIntersectionLinkRadius)
        continue;
      const dir = normalizeVec(dx, dy);
      const departureAlignment = node.tangentX * dir.x + node.tangentY * dir.y;
      const arrivalAlignment =
        candidate.tangentX * dir.x + candidate.tangentY * dir.y;
      if (
        departureAlignment < aiCfg.navIntersectionHeadingThreshold ||
        arrivalAlignment < aiCfg.navIntersectionHeadingThreshold
      ) {
        continue;
      }
      if (
        !clearNavSegment(
          node.x,
          node.y,
          candidate.x,
          candidate.y,
          trackDef,
          objects,
        )
      ) {
        continue;
      }
      const segmentObstacleInfo = obstaclePenaltyAlongSegment(
        node.x,
        node.y,
        candidate.x,
        candidate.y,
        objects,
      );
      if (segmentObstacleInfo.blocked) continue;
      const surfacePenalty =
        nodeSurfacePenalty(node.surface) +
        nodeSurfacePenalty(candidate.surface);
      const cost =
        distance +
        surfacePenalty +
        candidate.curvature * 24 +
        (node.obstaclePenalty + candidate.obstaclePenalty) * 0.2 +
        segmentObstacleInfo.penalty * 0.85 +
        aiCfg.navIntersectionPenalty;
      shortcutEdges.push({
        toNode: candidate,
        cost,
        step: sliceGap,
      });
    }
    shortcutEdges.sort((a, b) => a.cost - b.cost);
    for (const edge of shortcutEdges.slice(0, aiCfg.navIntersectionMaxLinks)) {
      addNavEdge(edges, node, edge.toNode, edge.cost, edge.step, "junction");
    }
  }

  const checkpointNodeIds = checkpoints.map((checkpoint) => {
    const checkpointProgress = normalizeAngle(checkpoint.angle) / (Math.PI * 2);
    const centerSlice =
      Math.round(checkpointProgress * progressCount) % progressCount;
    const nodeIds = [];
    for (let offset = -1; offset <= 1; offset++) {
      const sliceIndex = (centerSlice + offset + progressCount) % progressCount;
      for (const nodeId of nodesBySlice[sliceIndex]) {
        if (nodeId >= 0) nodeIds.push(nodeId);
      }
    }
    return [...new Set(nodeIds)];
  });
  const checkpointGoalNodeIds = buildCheckpointGoalNodeIds(nodes, trackDef).map(
    (nodeIds, index) =>
      nodeIds.length ? nodeIds : checkpointNodeIds[index] || [],
  );

  cachedTrackNavSignature = signature;
  const lapRoute = buildBestLapRoute(
    {
      progressCount,
      laneFactors,
      nodes,
      edges,
      nodesBySlice,
      checkpointNodeIds,
      checkpointGoalNodeIds,
      averageSegmentLength:
        nodes.length > 1
          ? nodes.reduce((sum, node) => {
              const nextSlice = (node.sliceIndex + 1) % progressCount;
              const nextNodeId = nodesBySlice[nextSlice][node.laneIndex];
              if (nextNodeId < 0) return sum;
              return (
                sum +
                Math.hypot(
                  nodes[nextNodeId].x - node.x,
                  nodes[nextNodeId].y - node.y,
                )
              );
            }, 0) / Math.max(nodes.length, 1)
          : 1,
    },
    trackDef,
  );
  cachedTrackNavGraph = {
    progressCount,
    laneFactors,
    nodes,
    edges,
    nodesBySlice,
    checkpointNodeIds,
    checkpointGoalNodeIds,
    bestLapRouteNodeIds: lapRoute.bestLapRouteNodeIds,
    routeIndexByNodeId: lapRoute.routeIndexByNodeId,
    routeTargetSpeeds: lapRoute.routeTargetSpeeds,
    averageSegmentLength:
      nodes.length > 1
        ? nodes.reduce((sum, node) => {
            const nextSlice = (node.sliceIndex + 1) % progressCount;
            const nextNodeId = nodesBySlice[nextSlice][node.laneIndex];
            if (nextNodeId < 0) return sum;
            return (
              sum +
              Math.hypot(
                nodes[nextNodeId].x - node.x,
                nodes[nextNodeId].y - node.y,
              )
            );
          }, 0) / Math.max(nodes.length, 1)
        : 1,
  };
  return cachedTrackNavGraph;
}

export function findNearestTrackNavNode(
  x,
  y,
  {
    trackDef = track,
    objects = worldObjects,
    maxDistance = Infinity,
    progressHint = null,
    preferForwardProgress = null,
  } = {},
) {
  const graph = getTrackNavigationGraph(trackDef, objects);
  let bestNode = null;
  let bestScore = Infinity;
  for (const node of graph.nodes) {
    const distance = Math.hypot(node.x - x, node.y - y);
    if (distance > maxDistance) continue;
    let score = distance;
    if (progressHint !== null) {
      const progressDelta = Math.abs(
        positiveProgressDelta(progressHint, node.progress),
      );
      score += Math.min(progressDelta, 1 - progressDelta) * 90;
    }
    if (preferForwardProgress !== null) {
      score += positiveProgressDelta(preferForwardProgress, node.progress) * 40;
    }
    if (score < bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }
  return bestNode;
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
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const base =
    1 /
    Math.sqrt(
      (c * c) / (ellipseX * ellipseX) + (s * s) / (ellipseY * ellipseY),
    );
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
  widthCaps = null,
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
      return maxWidth * Math.sin(clamp(d / totalLen, 0, 1) * Math.PI);
    }
    if (d < fadeLen) return maxWidth * smoothstep(d / fadeLen);
    if (d > totalLen - fadeLen)
      return maxWidth * smoothstep((totalLen - d) / fadeLen);
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

    const cap = Array.isArray(widthCaps)
      ? Math.max(0, widthCaps[i] ?? maxWidth)
      : maxWidth;
    const w = Math.min(widthAt(cumulative[i]), cap);
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

  const roadHalfWidths = sampleCenterlineWidthSeries(trackDef, segmentCount);
  const curbOffsets = roadHalfWidths.map(
    (halfWidth) => halfWidth - trackDef.borderSize + CURB_OUTSET,
  );
  const outer = offsetLoopVariable(center, curbOffsets);
  const inner = offsetLoopVariable(
    center,
    curbOffsets.map((value) => -value),
  );

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
  const primaryCurbThreshold = curvatureThreshold * 0.78;

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

  // Scale curb size by local road width and by turn intensity so narrow roads
  // can still show smaller curbs while stronger turns keep more visual weight.
  const minCurbSpaces = new Float64Array(segmentCount);
  const curvatureRange = Math.max(curvatureThreshold * 2.1, 1e-6);
  for (let i = 0; i < segmentCount; i++) {
    const curvatureT = clamp(
      (absCurvatures[i] - primaryCurbThreshold) / curvatureRange,
      0,
      1,
    );
    const widthByRoad = roadHalfWidths[i] * (0.24 + curvatureT * 0.28);
    const targetWidth = clamp(widthByRoad, CURB_MIN_WIDTH, CURB_MAX_WIDTH);
    minCurbSpaces[i] = targetWidth * (0.95 + (1 - curvatureT) * 0.35);
  }

  // ── Per-sample curb eligibility (separate per side) ────────────────
  // A sample is eligible for a curb on a given side when:
  //   1. The absolute curvature exceeds the threshold, AND
  //   2. The available space on that side is large enough, AND
  //   3. The curvature sign means this side is the OUTSIDE of the turn
  //      (where curbs naturally sit and have room), OR the curvature is
  //      very high (hairpin) where both sides get curbs if space allows.
  const outerPrimary = new Uint8Array(segmentCount);
  const innerPrimary = new Uint8Array(segmentCount);
  const outerSecondary = new Uint8Array(segmentCount);
  const innerSecondary = new Uint8Array(segmentCount);

  // Higher threshold for "inside-of-turn" curbs (need stronger curvature
  // to justify a curb on the compressed side).
  const insideCurvatureBoost = 1.65;

  for (let i = 0; i < segmentCount; i++) {
    if (absCurvatures[i] < primaryCurbThreshold) continue;

    // Positive signed curvature → turning left → outer side is convex
    // (outside of turn), inner is concave (inside of turn).
    const outerIsOutside = signedCurvatures[i] > 0;

    // Outer side eligibility
    if (outerSpace[i] >= minCurbSpaces[i]) {
      if (outerIsOutside) outerPrimary[i] = 1;
      else if (absCurvatures[i] >= curvatureThreshold * insideCurvatureBoost)
        outerSecondary[i] = 1;
    }

    // Inner side eligibility
    if (innerSpace[i] >= minCurbSpaces[i]) {
      if (!outerIsOutside) innerPrimary[i] = 1;
      else if (absCurvatures[i] >= curvatureThreshold * insideCurvatureBoost)
        innerSecondary[i] = 1;
    }
  }

  // ── Expand eligible regions slightly (smooth short gaps) ───────────
  const expandBy = 4;
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

  const outerPrimaryExpanded = expandMask(outerPrimary);
  const innerPrimaryExpanded = expandMask(innerPrimary);
  const outerSecondaryExpanded = expandMask(outerSecondary);
  const innerSecondaryExpanded = expandMask(innerSecondary);

  // Re-check space constraint after expansion (don't let expansion push
  // curbs into cramped areas).
  for (let i = 0; i < segmentCount; i++) {
    if (outerPrimaryExpanded[i] && outerSpace[i] < minCurbSpaces[i])
      outerPrimaryExpanded[i] = 0;
    if (innerPrimaryExpanded[i] && innerSpace[i] < minCurbSpaces[i])
      innerPrimaryExpanded[i] = 0;
    if (outerSecondaryExpanded[i] && outerSpace[i] < minCurbSpaces[i])
      outerSecondaryExpanded[i] = 0;
    if (innerSecondaryExpanded[i] && innerSpace[i] < minCurbSpaces[i])
      innerSecondaryExpanded[i] = 0;
  }

  // ── Collect contiguous runs and filter by minimum arc length ───────
  const minRunArcLength = CURB_STRIPE_LENGTH * 1.2;

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

  const collectRuns = (points, mask, isOuter, renderStyle, stripeScale = 1) => {
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

        return { points: simplified, outwardSign, renderStyle, stripeScale };
      });
  };

  return {
    outer: [
      ...collectRuns(outer, outerPrimaryExpanded, true, "striped", 1.15),
      ...collectRuns(outer, outerSecondaryExpanded, true, "dotted", 1),
    ],
    inner: [
      ...collectRuns(inner, innerPrimaryExpanded, false, "striped", 1.15),
      ...collectRuns(inner, innerSecondaryExpanded, false, "dotted", 1),
    ],
  };
}

function buildFullCurbSegments(trackDef = track) {
  const center = trackBoundaryPaths(trackDef, 420).center;
  if (!center.length) return { outer: [], inner: [] };
  const curbOffsets = sampleCenterlineWidthSeries(trackDef, center.length).map(
    (halfWidth) => halfWidth - trackDef.borderSize + CURB_OUTSET,
  );
  const maxHalfWidth = Math.max(...curbOffsets, 24);
  const simplifyParams = {
    minEdgeLen: Math.max(1.2, maxHalfWidth * 0.035),
    collinearTol: Math.max(1.4, maxHalfWidth * 0.045),
    rdpTolerance: Math.max(1.8, maxHalfWidth * 0.07),
    clusterRadius: Math.max(4, maxHalfWidth * 0.06),
    maxPasses: 6,
    minVertices: Math.max(14, Math.floor(center.length * 0.08)),
  };
  const outerLoop = simplifyOffsetClosedLoop(
    offsetLoopVariable(center, curbOffsets),
    simplifyParams,
  );
  const innerLoop = simplifyOffsetClosedLoop(
    offsetLoopVariable(
      center,
      curbOffsets.map((value) => -value),
    ),
    simplifyParams,
  );

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
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -(dy / len);
    const ny = dx / len;
    const dot = nx * (cx - pA.x) + ny * (cy - pA.y);
    return isOuter ? (dot > 0 ? -1 : 1) : dot > 0 ? 1 : -1;
  };

  return {
    outer: [
      {
        points: outerLoop,
        outwardSign: computeOutwardSign(outerLoop, true),
      },
    ],
    inner: [
      {
        points: innerLoop,
        outwardSign: computeOutwardSign(innerLoop, false),
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

function getSurface(x, y, trackDef = track) {
  const loop = getCenterlineLoop(trackDef);
  if (!loop) return "grass";
  const { distance, progress } = nearestDistanceAndProgressToLoop(x, y, loop);
  const halfWidth = sampleCenterlineHalfWidth(progress, trackDef);
  if (distance > halfWidth) return "grass";
  if (distance > halfWidth - trackDef.borderSize) return "curb";
  return "asphalt";
}

export function pondSlowdownAt(x, y, objects = worldObjects) {
  for (const obj of objects) {
    if (obj.type !== "pond") continue;
    const dx = x - obj.x;
    const dy = y - obj.y;
    const rotation = obj.angle || 0;
    const localX = dx * Math.cos(rotation) + dy * Math.sin(rotation);
    const localY = -dx * Math.sin(rotation) + dy * Math.cos(rotation);
    const angle = Math.atan2(localY, localX);
    const dist = Math.hypot(localX, localY);
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

export function surfaceAtForTrack(
  x,
  y,
  trackDef = track,
  objects = worldObjects,
) {
  if (pondSlowdownAt(x, y, objects)) return "water";
  const surface = getSurface(x, y, trackDef);
  if (surface === "grass" || surface === "innerGrass") return "grass";
  if (surface === "curb") return "curb";
  return "asphalt";
}

export function normalizeWorldObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const angle = Number.isFinite(obj.angle) ? Number(obj.angle) : 0;
  switch (obj.type) {
    case "tree":
      return {
        ...obj,
        type: "tree",
        angle,
        r: Number.isFinite(obj.r) ? Number(obj.r) : 24,
        height: Number.isFinite(obj.height) ? Number(obj.height) : 3,
      };
    case "barrel":
      return {
        ...obj,
        type: "barrel",
        angle,
        r: Number.isFinite(obj.r) ? Number(obj.r) : 12,
        height: Number.isFinite(obj.height) ? Number(obj.height) : 1,
      };
    case "spring":
      return {
        ...obj,
        type: "spring",
        angle,
        r: Number.isFinite(obj.r) ? Number(obj.r) : 16,
        height: Number.isFinite(obj.height) ? Number(obj.height) : 0.4,
      };
    case "wall":
      return {
        ...obj,
        type: "wall",
        angle,
        width: Number.isFinite(obj.width) ? Number(obj.width) : 18,
        length: Number.isFinite(obj.length) ? Number(obj.length) : 90,
        height: Number.isFinite(obj.height) ? Number(obj.height) : 2.5,
      };
    case "pond":
      return {
        ...obj,
        type: "pond",
        angle,
        rx: Number.isFinite(obj.rx) ? Number(obj.rx) : 78,
        ry: Number.isFinite(obj.ry) ? Number(obj.ry) : 44,
        seed: Number.isFinite(obj.seed) ? Number(obj.seed) : 0,
      };
    default:
      return { ...obj, angle };
  }
}

export function getObjectHeight(obj) {
  const normalized = normalizeWorldObject(obj);
  return Number.isFinite(normalized?.height) ? normalized.height : 0;
}

export function getSolidObjects(objects = worldObjects) {
  return objects
    .map(normalizeWorldObject)
    .filter(
      (obj) =>
        obj &&
        (obj.type === "tree" || obj.type === "barrel" || obj.type === "wall"),
    );
}

export function pointInsideWallFootprint(x, y, wall) {
  const normalized = normalizeWorldObject(wall);
  if (!normalized || normalized.type !== "wall") return false;
  const dx = x - normalized.x;
  const dy = y - normalized.y;
  const cos = Math.cos(normalized.angle);
  const sin = Math.sin(normalized.angle);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  return (
    Math.abs(localX) <= normalized.length * 0.5 &&
    Math.abs(localY) <= normalized.width * 0.5
  );
}

export function findSpringTrigger(x, y, objects = worldObjects) {
  for (const raw of objects) {
    const obj = normalizeWorldObject(raw);
    if (!obj || obj.type !== "spring") continue;
    if (Math.hypot(x - obj.x, y - obj.y) <= obj.r) return obj;
  }
  return null;
}

function resolveCircleCollision(rx, ry, obj, carRadius) {
  const minDist = obj.r + carRadius;
  const dx = rx - obj.x;
  const dy = ry - obj.y;
  const distSq = dx * dx + dy * dy;
  if (distSq >= minDist * minDist) return null;

  const dist = Math.sqrt(Math.max(distSq, 1e-8));
  const nx = dx / dist;
  const ny = dy / dist;
  const penetration = minDist - dist;
  return {
    x: rx + nx * (penetration + 0.25),
    y: ry + ny * (penetration + 0.25),
    normalX: nx,
    normalY: ny,
    hitType: obj.type,
  };
}

function resolveWallCollision(rx, ry, obj, carRadius) {
  const dx = rx - obj.x;
  const dy = ry - obj.y;
  const cos = Math.cos(obj.angle);
  const sin = Math.sin(obj.angle);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  const halfLength = obj.length * 0.5;
  const halfWidth = obj.width * 0.5;
  const clampedX = clamp(localX, -halfLength, halfLength);
  const clampedY = clamp(localY, -halfWidth, halfWidth);
  const deltaX = localX - clampedX;
  const deltaY = localY - clampedY;
  const distSq = deltaX * deltaX + deltaY * deltaY;

  if (distSq > carRadius * carRadius) return null;

  let normalLocalX = 0;
  let normalLocalY = 0;
  let push = 0;
  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    normalLocalX = deltaX / dist;
    normalLocalY = deltaY / dist;
    push = carRadius - dist + 0.25;
  } else {
    const distToLength = halfLength - Math.abs(localX);
    const distToWidth = halfWidth - Math.abs(localY);
    if (distToLength < distToWidth) {
      normalLocalX = localX >= 0 ? 1 : -1;
      push = distToLength + carRadius + 0.25;
    } else {
      normalLocalY = localY >= 0 ? 1 : -1;
      push = distToWidth + carRadius + 0.25;
    }
  }

  const nextLocalX = localX + normalLocalX * push;
  const nextLocalY = localY + normalLocalY * push;
  const worldPushX = nextLocalX * cos - nextLocalY * sin;
  const worldPushY = nextLocalX * sin + nextLocalY * cos;
  const normalX = normalLocalX * cos - normalLocalY * sin;
  const normalY = normalLocalX * sin + normalLocalY * cos;

  return {
    x: obj.x + worldPushX,
    y: obj.y + worldPushY,
    normalX,
    normalY,
    hitType: "wall",
  };
}

export function resolveObjectCollisions(
  x,
  y,
  carZ = 0,
  objects = worldObjects,
) {
  let rx = x;
  let ry = y;
  let hit = false;
  let normalX = 0;
  let normalY = 0;
  let hitType = "";
  const carRadius = 8;

  for (let pass = 0; pass < 3; pass++) {
    let pushed = false;

    for (const obj of getSolidObjects(objects)) {
      if (carZ >= getObjectHeight(obj)) continue;
      const resolved =
        obj.type === "wall"
          ? resolveWallCollision(rx, ry, obj, carRadius)
          : resolveCircleCollision(rx, ry, obj, carRadius);
      if (!resolved) continue;

      hit = true;
      pushed = true;
      rx = resolved.x;
      ry = resolved.y;
      normalX = resolved.normalX;
      normalY = resolved.normalY;
      hitType = resolved.hitType;
    }

    if (!pushed) break;
  }

  return { x: rx, y: ry, hit, normalX, normalY, hitType };
}

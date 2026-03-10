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
  aiCar,
  aiLapData,
  aiPhysicsRuntime,
  keys,
  lapData,
  physicsRuntime,
  skidMarks,
  state,
} from "./state.js";
import { gameAudio } from "./game-audio.js";
import { clamp, moveTowards } from "./utils.js";
import {
  findSpringTrigger,
  findNearestTrackNavNode,
  getTrackNavigationGraph,
  pointOnCenterLine,
  resolveObjectCollisions,
  surfaceAt,
  trackProgressAtPoint,
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

function wrapProgress(progress) {
  return ((progress % 1) + 1) % 1;
}

function signedAngleDelta(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function resetLapProgress(targetLapData, startCheckpointIndex) {
  targetLapData.currentLapStart = 0;
  targetLapData.lapTimes = [];
  targetLapData.passed = new Set([startCheckpointIndex]);
  targetLapData.nextCheckpointIndex =
    checkpoints.length > 0
      ? (startCheckpointIndex + 1) % checkpoints.length
      : 0;
  targetLapData.lap = 1;
  if ("finished" in targetLapData) targetLapData.finished = false;
  if ("finishTime" in targetLapData) targetLapData.finishTime = 0;
}

function aiOpponentsEnabled() {
  return physicsConfig.flags.AI_OPPONENTS_ENABLED !== false;
}

function recordRaceFinish(racerKey) {
  const orderKey = racerKey === "ai" ? "aiFinishOrder" : "playerFinishOrder";
  if (state.raceStandings[orderKey] > 0) return state.raceStandings[orderKey];
  const finishOrder = state.raceStandings.nextFinishOrder;
  state.raceStandings[orderKey] = finishOrder;
  state.raceStandings.nextFinishOrder += 1;
  return finishOrder;
}

function getRacerSnapshot(racerKey) {
  const isAi = racerKey === "ai";
  const vehicle = isAi ? aiCar : car;
  const racerLapData = isAi ? aiLapData : lapData;
  const finishOrder = isAi
    ? state.raceStandings.aiFinishOrder
    : state.raceStandings.playerFinishOrder;
  return {
    id: racerKey,
    finished: racerLapData.finished,
    finishOrder,
    finishTime: racerLapData.finishTime || 0,
    lapsCompleted: Math.max(
      0,
      Math.min(racerLapData.lap - 1, racerLapData.maxLaps),
    ),
    lapProgress: trackProgressAtPoint(vehicle.x, vehicle.y, track),
  };
}

function compareRaceSnapshots(a, b) {
  if (a.finished || b.finished) {
    if (a.finished && b.finished) {
      if (a.finishOrder !== b.finishOrder) return a.finishOrder - b.finishOrder;
      return a.finishTime - b.finishTime;
    }
    return a.finished ? -1 : 1;
  }
  if (a.lapsCompleted !== b.lapsCompleted) {
    return b.lapsCompleted - a.lapsCompleted;
  }
  if (a.lapProgress !== b.lapProgress) {
    return b.lapProgress - a.lapProgress;
  }
  return 0;
}

export function getRaceStandings() {
  const standings = [getRacerSnapshot("player")];
  if (aiOpponentsEnabled()) standings.push(getRacerSnapshot("ai"));
  standings.sort(compareRaceSnapshots);
  return standings;
}

export function getRacePosition(racerKey = "player") {
  const standings = getRaceStandings();
  const index = standings.findIndex((entry) => entry.id === racerKey);
  return index >= 0 ? index + 1 : standings.length;
}

function progressDeltaForward(from, to) {
  return wrapProgress(to - from);
}

function estimateNavHeuristic(node, goalNodeIds, graph) {
  if (!goalNodeIds.length) return 0;
  let best = Infinity;
  for (const goalNodeId of goalNodeIds) {
    const goalNode = graph.nodes[goalNodeId];
    if (!goalNode) continue;
    best = Math.min(best, Math.hypot(goalNode.x - node.x, goalNode.y - node.y));
  }
  return best === Infinity ? 0 : best;
}

export function planTrackNavPath(graph, startNodeId, goalNodeIds) {
  if (
    !graph ||
    startNodeId < 0 ||
    startNodeId >= graph.nodes.length ||
    !goalNodeIds.length
  ) {
    return [];
  }
  const aiCfg = physicsConfig.ai;
  const goalSet = new Set(goalNodeIds);
  const gScore = new Float64Array(graph.nodes.length);
  const fScore = new Float64Array(graph.nodes.length);
  const cameFrom = new Int32Array(graph.nodes.length);
  const inOpen = new Uint8Array(graph.nodes.length);
  const closed = new Uint8Array(graph.nodes.length);
  gScore.fill(Infinity);
  fScore.fill(Infinity);
  cameFrom.fill(-1);
  const open = [startNodeId];
  gScore[startNodeId] = 0;
  fScore[startNodeId] = estimateNavHeuristic(
    graph.nodes[startNodeId],
    goalNodeIds,
    graph,
  );
  inOpen[startNodeId] = 1;

  while (open.length) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) {
      if (fScore[open[i]] < fScore[open[bestIndex]]) bestIndex = i;
    }
    const currentId = open.splice(bestIndex, 1)[0];
    inOpen[currentId] = 0;
    if (goalSet.has(currentId) && currentId !== startNodeId) {
      const path = [currentId];
      let cursor = currentId;
      while (cameFrom[cursor] >= 0) {
        cursor = cameFrom[cursor];
        path.push(cursor);
      }
      path.reverse();
      return path;
    }

    closed[currentId] = 1;
    for (const edge of graph.edges[currentId]) {
      const neighborId = edge.to;
      if (closed[neighborId]) continue;
      const neighbor = graph.nodes[neighborId];
      const playerDistance = Math.hypot(neighbor.x - car.x, neighbor.y - car.y);
      const dynamicPenalty =
        playerDistance >= aiCfg.playerAvoidanceRadius
          ? 0
          : aiCfg.playerNodePenalty *
            (1 - playerDistance / Math.max(aiCfg.playerAvoidanceRadius, 1));
      const tentative = gScore[currentId] + edge.cost + dynamicPenalty;
      if (tentative >= gScore[neighborId]) continue;
      cameFrom[neighborId] = currentId;
      gScore[neighborId] = tentative;
      fScore[neighborId] =
        tentative + estimateNavHeuristic(neighbor, goalNodeIds, graph);
      if (!inOpen[neighborId]) {
        open.push(neighborId);
        inOpen[neighborId] = 1;
      }
    }
  }

  return [];
}

function getRouteNodeIdAt(graph, routeIndex) {
  if (!graph.bestLapRouteNodeIds.length) return -1;
  const normalizedIndex =
    ((routeIndex % graph.bestLapRouteNodeIds.length) +
      graph.bestLapRouteNodeIds.length) %
    graph.bestLapRouteNodeIds.length;
  return graph.bestLapRouteNodeIds[normalizedIndex] ?? -1;
}

function findNearestRouteIndex(graph, node, progressHint = null) {
  if (!graph.bestLapRouteNodeIds.length) return -1;
  if (node?.id >= 0) {
    const exactIndex = graph.routeIndexByNodeId[node.id];
    if (exactIndex >= 0) return exactIndex;
  }
  let bestRouteIndex = 0;
  let bestScore = Infinity;
  for (
    let routeIndex = 0;
    routeIndex < graph.bestLapRouteNodeIds.length;
    routeIndex++
  ) {
    const routeNode = graph.nodes[graph.bestLapRouteNodeIds[routeIndex]];
    if (!routeNode) continue;
    let score = node
      ? Math.hypot(routeNode.x - node.x, routeNode.y - node.y)
      : 0;
    if (progressHint !== null) {
      score += progressDeltaForward(progressHint, routeNode.progress) * 60;
    }
    if (score < bestScore) {
      bestScore = score;
      bestRouteIndex = routeIndex;
    }
  }
  return bestRouteIndex;
}

function buildRouteHorizonNodeIds(graph, routeIndex, length) {
  const nodeIds = [];
  for (let offset = 0; offset < length; offset++) {
    const nodeId = getRouteNodeIdAt(graph, routeIndex + offset);
    if (nodeId >= 0) nodeIds.push(nodeId);
  }
  return nodeIds;
}

function appendCheckpointContinuation(graph, nodeIds, count) {
  if (!graph || !nodeIds.length || count <= 0) return nodeIds;
  const extendedNodeIds = [...nodeIds];
  const visited = new Set(nodeIds);
  let currentNodeId = nodeIds[nodeIds.length - 1];
  for (let step = 0; step < count; step++) {
    const currentNode = graph.nodes[currentNodeId];
    if (!currentNode) break;
    let bestEdge = null;
    let bestScore = Infinity;
    for (const edge of graph.edges[currentNodeId] || []) {
      if (visited.has(edge.to)) continue;
      const nextNode = graph.nodes[edge.to];
      if (!nextNode) continue;
      const turnPenalty =
        Math.abs(
          signedAngleDelta(
            Math.atan2(currentNode.tangentY, currentNode.tangentX),
            Math.atan2(nextNode.tangentY, nextNode.tangentX),
          ),
        ) * 18;
      const score = edge.cost + turnPenalty + nextNode.obstaclePenalty * 0.04;
      if (score < bestScore) {
        bestScore = score;
        bestEdge = edge;
      }
    }
    if (!bestEdge) break;
    extendedNodeIds.push(bestEdge.to);
    visited.add(bestEdge.to);
    currentNodeId = bestEdge.to;
  }
  return extendedNodeIds;
}

function buildAiPath(graph, force = false) {
  const aiCfg = physicsConfig.ai;
  if (!force && aiPhysicsRuntime.replanCooldown > 0) return;
  const fallbackNode =
    aiPhysicsRuntime.lastValidNodeId >= 0
      ? graph.nodes[aiPhysicsRuntime.lastValidNodeId]
      : null;
  const currentNode =
    findNearestTrackNavNode(aiCar.x, aiCar.y, {
      progressHint: aiPhysicsRuntime.progress,
      maxDistance: aiCfg.softResetSearchRadiusFallback,
    }) || fallbackNode;
  if (!currentNode) return;
  aiPhysicsRuntime.currentNodeId = currentNode.id;
  const currentRouteIndex = findNearestRouteIndex(
    graph,
    currentNode,
    aiPhysicsRuntime.progress,
  );
  aiPhysicsRuntime.routeNodeIndex = currentRouteIndex;
  const nextCheckpointIndex =
    aiLapData.nextCheckpointIndex % checkpoints.length;
  const checkpointGoalNodeIds =
    graph.checkpointGoalNodeIds?.[nextCheckpointIndex] || [];
  const checkpointFallbackNodeIds =
    graph.checkpointNodeIds?.[nextCheckpointIndex] || [];
  let plannedNodeIds = planTrackNavPath(
    graph,
    currentNode.id,
    checkpointGoalNodeIds,
  );
  if (!plannedNodeIds.length && checkpointFallbackNodeIds.length) {
    plannedNodeIds = planTrackNavPath(
      graph,
      currentNode.id,
      checkpointFallbackNodeIds,
    );
  }
  if (plannedNodeIds.length) {
    plannedNodeIds = appendCheckpointContinuation(
      graph,
      plannedNodeIds,
      aiCfg.checkpointContinuationNodes,
    );
  }
  if (!plannedNodeIds.length && aiPhysicsRuntime.plannedNodeIds.length) {
    plannedNodeIds = [...aiPhysicsRuntime.plannedNodeIds];
  }
  const terminalNodeId =
    plannedNodeIds.length > 0
      ? plannedNodeIds[plannedNodeIds.length - 1]
      : currentNode.id;
  const terminalNode = graph.nodes[terminalNodeId] || currentNode;
  const rejoinRouteIndex = findNearestRouteIndex(
    graph,
    terminalNode,
    terminalNode?.progress ?? aiPhysicsRuntime.progress,
  );
  if (plannedNodeIds.length) {
    aiPhysicsRuntime.rejoinRouteIndex = rejoinRouteIndex;
    aiPhysicsRuntime.plannedNodeIds = plannedNodeIds;
    aiPhysicsRuntime.pathCursor = 0;
    aiPhysicsRuntime.targetNodeId =
      plannedNodeIds[Math.min(1, plannedNodeIds.length - 1)];
    aiPhysicsRuntime.debugPathPoints = plannedNodeIds.map((nodeId) => {
      const node = graph.nodes[nodeId];
      return { x: node.x, y: node.y };
    });
  }
  aiPhysicsRuntime.replanCooldown = aiCfg.replanInterval;
}

function primeAiRaceStartPlan() {
  if (!aiOpponentsEnabled()) return;
  const graph = getTrackNavigationGraph(track);
  aiPhysicsRuntime.progress = trackProgressAtPoint(aiCar.x, aiCar.y, track);
  aiPhysicsRuntime.progressAtLastSample = aiPhysicsRuntime.progress;
  const nearestNode = findNearestTrackNavNode(aiCar.x, aiCar.y, {
    progressHint: aiPhysicsRuntime.progress,
    maxDistance: physicsConfig.ai.softResetSearchRadiusFallback,
  });
  if (nearestNode) {
    aiPhysicsRuntime.currentNodeId = nearestNode.id;
    aiPhysicsRuntime.lastValidNodeId = nearestNode.id;
    const routeIndex = graph.routeIndexByNodeId[nearestNode.id];
    if (routeIndex >= 0) aiPhysicsRuntime.routeNodeIndex = routeIndex;
  }
  buildAiPath(graph, true);
}

function pickAiRecoveryNode(graph, maxDistance) {
  const baseProgress =
    aiPhysicsRuntime.lastValidNodeId >= 0
      ? (graph.nodes[aiPhysicsRuntime.lastValidNodeId]?.progress ??
        aiPhysicsRuntime.progress)
      : aiPhysicsRuntime.progress;
  return findNearestTrackNavNode(aiCar.x, aiCar.y, {
    maxDistance,
    progressHint: baseProgress,
    preferForwardProgress: baseProgress,
  });
}

function applyAiSoftReset(graph) {
  const aiCfg = physicsConfig.ai;
  let candidate =
    pickAiRecoveryNode(graph, aiCfg.softResetSearchRadius) ||
    pickAiRecoveryNode(graph, aiCfg.softResetSearchRadiusFallback) ||
    findNearestTrackNavNode(aiCar.x, aiCar.y, {
      progressHint: aiPhysicsRuntime.progress,
    });
  if (
    candidate &&
    aiPhysicsRuntime.lastValidNodeId >= 0 &&
    graph.nodes[aiPhysicsRuntime.lastValidNodeId]
  ) {
    const lastValid = graph.nodes[aiPhysicsRuntime.lastValidNodeId];
    if (
      progressDeltaForward(lastValid.progress, candidate.progress) >
      2 / Math.max(graph.progressCount, 1)
    ) {
      candidate = lastValid;
    }
  }
  if (!candidate && aiPhysicsRuntime.lastValidNodeId >= 0) {
    candidate = graph.nodes[aiPhysicsRuntime.lastValidNodeId] || null;
  }
  if (!candidate) return;

  aiCar.x = candidate.x;
  aiCar.y = candidate.y;
  aiCar.angle = Math.atan2(candidate.tangentY, candidate.tangentX);
  aiCar.vx = Math.cos(aiCar.angle) * aiCfg.softResetForwardSpeed;
  aiCar.vy = Math.sin(aiCar.angle) * aiCfg.softResetForwardSpeed;
  aiCar.speed = aiCfg.softResetForwardSpeed;
  aiCar.z = 0;
  aiCar.vz = 0;
  aiCar.airborne = false;
  aiCar.airTime = 0;
  aiCar.visualScale = 1;
  aiPhysicsRuntime.mode = "race";
  aiPhysicsRuntime.recoveryMode = "none";
  aiPhysicsRuntime.recoveryTimer = 0;
  aiPhysicsRuntime.lowProgressTimer = 0;
  aiPhysicsRuntime.offRoadTimer = 0;
  aiPhysicsRuntime.repeatedCollisionTimer = 0;
  aiPhysicsRuntime.softResetCooldown = aiCfg.softResetCooldown;
  aiPhysicsRuntime.currentNodeId = candidate.id;
  aiPhysicsRuntime.lastValidNodeId = candidate.id;
  aiPhysicsRuntime.targetNodeId = candidate.id;
  aiPhysicsRuntime.routeNodeIndex = findNearestRouteIndex(
    graph,
    candidate,
    candidate.progress,
  );
  aiPhysicsRuntime.rejoinRouteIndex = aiPhysicsRuntime.routeNodeIndex;
  aiPhysicsRuntime.plannedNodeIds = [candidate.id];
  aiPhysicsRuntime.pathCursor = 0;
  aiPhysicsRuntime.desiredSpeed = candidate.targetSpeed;
  aiPhysicsRuntime.targetPoint = { x: candidate.x, y: candidate.y };
  aiPhysicsRuntime.debugPathPoints = [{ x: candidate.x, y: candidate.y }];
  aiPhysicsRuntime.input.throttle = 0;
  aiPhysicsRuntime.input.brake = 0;
  aiPhysicsRuntime.input.steer = 0;
  aiPhysicsRuntime.input.handbrake = 0;
  aiPhysicsRuntime.steeringRate = 0;
  aiPhysicsRuntime.collisionGripTimer = 0;
  aiPhysicsRuntime.replanCooldown = 0;
}

function setAiInputTargets(
  dt,
  { throttle = 0, brake = 0, steer = 0, handbrake = 0 },
) {
  aiPhysicsRuntime.input.throttle = smoothInputValue(
    aiPhysicsRuntime.input.throttle,
    clamp(throttle, 0, 1),
    dt,
  );
  aiPhysicsRuntime.input.brake = smoothInputValue(
    aiPhysicsRuntime.input.brake,
    clamp(brake, 0, 1),
    dt,
  );
  aiPhysicsRuntime.input.steer = smoothInputValue(
    aiPhysicsRuntime.input.steer,
    clamp(steer, -1, 1),
    dt,
  );
  aiPhysicsRuntime.input.handbrake = smoothInputValue(
    aiPhysicsRuntime.input.handbrake,
    clamp(handbrake, 0, 1),
    dt,
  );
}

function projectPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = Math.max(dx * dx + dy * dy, 1e-6);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  return {
    x: ax + dx * t,
    y: ay + dy * t,
    t,
  };
}

function aiSightlineBlocked(ax, ay, bx, by, samples) {
  for (let step = 1; step <= samples; step++) {
    const t = step / samples;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    if (resolveObjectCollisions(x, y, 0).hit) return true;
  }
  return false;
}

function buildAiTargetPreview(graph) {
  if (!aiPhysicsRuntime.plannedNodeIds.length) return null;
  const aiCfg = physicsConfig.ai;
  const currentNode =
    graph.nodes[aiPhysicsRuntime.plannedNodeIds[aiPhysicsRuntime.pathCursor]];
  if (!currentNode) return null;

  let anchorX = currentNode.x;
  let anchorY = currentNode.y;
  let segmentIndex = aiPhysicsRuntime.pathCursor;
  if (
    aiPhysicsRuntime.pathCursor <
    aiPhysicsRuntime.plannedNodeIds.length - 1
  ) {
    const nextNode =
      graph.nodes[
        aiPhysicsRuntime.plannedNodeIds[aiPhysicsRuntime.pathCursor + 1]
      ];
    if (nextNode) {
      const projection = projectPointToSegment(
        aiCar.x,
        aiCar.y,
        currentNode.x,
        currentNode.y,
        nextNode.x,
        nextNode.y,
      );
      anchorX = projection.x;
      anchorY = projection.y;
    }
  }

  let remainingDistance = Math.min(
    aiCfg.targetPreviewMaxDistance,
    aiCfg.targetPreviewDistanceBase + aiCar.speed * aiCfg.targetPreviewSpeedMul,
  );
  let previewX = anchorX;
  let previewY = anchorY;
  let previewNode = currentNode;

  while (
    segmentIndex < aiPhysicsRuntime.plannedNodeIds.length - 1 &&
    remainingDistance > 0
  ) {
    const fromNode = graph.nodes[aiPhysicsRuntime.plannedNodeIds[segmentIndex]];
    const toNode =
      graph.nodes[aiPhysicsRuntime.plannedNodeIds[segmentIndex + 1]];
    if (!fromNode || !toNode) break;
    const fromX =
      segmentIndex === aiPhysicsRuntime.pathCursor ? anchorX : fromNode.x;
    const fromY =
      segmentIndex === aiPhysicsRuntime.pathCursor ? anchorY : fromNode.y;
    const segDx = toNode.x - fromX;
    const segDy = toNode.y - fromY;
    const segLen = Math.hypot(segDx, segDy);
    if (segLen <= 1e-5) {
      segmentIndex += 1;
      continue;
    }
    if (remainingDistance <= segLen) {
      const t = remainingDistance / segLen;
      previewX = fromX + segDx * t;
      previewY = fromY + segDy * t;
      previewNode = toNode;
      break;
    }
    previewX = toNode.x;
    previewY = toNode.y;
    previewNode = toNode;
    remainingDistance -= segLen;
    segmentIndex += 1;
  }

  while (
    segmentIndex > aiPhysicsRuntime.pathCursor &&
    aiSightlineBlocked(
      aiCar.x,
      aiCar.y,
      previewX,
      previewY,
      aiCfg.targetSightlineSamples,
    )
  ) {
    const fallbackNode =
      graph.nodes[aiPhysicsRuntime.plannedNodeIds[segmentIndex]];
    if (!fallbackNode) break;
    previewX = fallbackNode.x;
    previewY = fallbackNode.y;
    previewNode = fallbackNode;
    segmentIndex -= 1;
  }

  return {
    x: previewX,
    y: previewY,
    node: previewNode,
  };
}

function updateAiPathCursor(graph) {
  if (!aiPhysicsRuntime.plannedNodeIds.length) return null;
  const aiCfg = physicsConfig.ai;
  while (
    aiPhysicsRuntime.pathCursor <
    aiPhysicsRuntime.plannedNodeIds.length - 1
  ) {
    const nextNode =
      graph.nodes[
        aiPhysicsRuntime.plannedNodeIds[aiPhysicsRuntime.pathCursor + 1]
      ];
    if (!nextNode) break;
    const distance = Math.hypot(nextNode.x - aiCar.x, nextNode.y - aiCar.y);
    if (distance > aiCfg.pathNodeReachDistance) break;
    aiPhysicsRuntime.pathCursor += 1;
  }
  const lookAheadNodeCount = Math.max(
    1,
    Math.round(aiCfg.lookAheadBase + aiCar.speed * aiCfg.lookAheadSpeedMul),
  );
  const targetIndex = Math.min(
    aiPhysicsRuntime.plannedNodeIds.length - 1,
    aiPhysicsRuntime.pathCursor + lookAheadNodeCount,
  );
  const targetNodeId = aiPhysicsRuntime.plannedNodeIds[targetIndex];
  aiPhysicsRuntime.targetNodeId = targetNodeId;
  const routeIndex = graph.routeIndexByNodeId[targetNodeId];
  if (routeIndex >= 0) aiPhysicsRuntime.routeNodeIndex = routeIndex;
  const targetNode = graph.nodes[targetNodeId] || null;
  const preview = buildAiTargetPreview(graph);
  if (preview) {
    aiPhysicsRuntime.targetPoint = { x: preview.x, y: preview.y };
    return {
      ...(targetNode || {}),
      x: preview.x,
      y: preview.y,
      tangentX: preview.node?.tangentX ?? targetNode?.tangentX ?? 1,
      tangentY: preview.node?.tangentY ?? targetNode?.tangentY ?? 0,
      targetSpeed:
        preview.node?.targetSpeed ??
        targetNode?.targetSpeed ??
        physicsConfig.ai.targetSpeedMax,
    };
  }
  return targetNode;
}

function computeAiTargetSpeed(graph) {
  if (!aiPhysicsRuntime.plannedNodeIds.length) {
    return physicsConfig.ai.targetSpeedMin;
  }
  const aiCfg = physicsConfig.ai;
  let targetSpeed = aiCfg.targetSpeedMax;
  const endIndex = Math.min(
    aiPhysicsRuntime.plannedNodeIds.length - 1,
    aiPhysicsRuntime.pathCursor + aiCfg.targetSpeedLookAhead,
  );
  for (let i = aiPhysicsRuntime.pathCursor; i <= endIndex; i++) {
    const node = graph.nodes[aiPhysicsRuntime.plannedNodeIds[i]];
    if (!node) continue;
    const distanceIndex = i - aiPhysicsRuntime.pathCursor;
    const brakingAllowance = distanceIndex <= 1 ? 0 : distanceIndex * 18;
    targetSpeed = Math.min(targetSpeed, node.targetSpeed + brakingAllowance);
  }
  aiPhysicsRuntime.desiredSpeed = clamp(
    targetSpeed * aiCfg.targetSpeedBias,
    aiCfg.targetSpeedMin,
    aiCfg.targetSpeedMax,
  );
  return aiPhysicsRuntime.desiredSpeed;
}

function updateAiRaceControl(dt, graph) {
  const aiCfg = physicsConfig.ai;
  if (
    !aiPhysicsRuntime.plannedNodeIds.length ||
    aiPhysicsRuntime.replanCooldown <= 0
  ) {
    buildAiPath(graph, !aiPhysicsRuntime.plannedNodeIds.length);
  }
  const targetNode = updateAiPathCursor(graph);
  if (!targetNode) {
    aiPhysicsRuntime.mode = "recover";
    aiPhysicsRuntime.recoveryMode = "reverseTurn";
    aiPhysicsRuntime.recoveryTimer = 0;
    setAiInputTargets(dt, { brake: 1 });
    return;
  }

  const dx = targetNode.x - aiCar.x;
  const dy = targetNode.y - aiCar.y;
  const distanceToTarget = Math.hypot(dx, dy);
  const directHeading = Math.atan2(dy, dx);
  const tangentHeading = Math.atan2(targetNode.tangentY, targetNode.tangentX);
  const tangentBlend =
    clamp(distanceToTarget / Math.max(aiCfg.tangentBlendDistance, 1), 0, 1) *
    aiCfg.tangentBlendMax;
  const desiredHeading =
    directHeading +
    signedAngleDelta(directHeading, tangentHeading) * tangentBlend;
  const forwardX = Math.cos(aiCar.angle);
  const forwardY = Math.sin(aiCar.angle);
  const rightX = -forwardY;
  const rightY = forwardX;
  const lateralError = dx * rightX + dy * rightY;
  const headingError = signedAngleDelta(aiCar.angle, desiredHeading);
  const obstacleTurnDamping =
    distanceToTarget <= aiCfg.obstacleTurnDampingDistance
      ? 1
      : clamp(
          1 -
            (distanceToTarget - aiCfg.obstacleTurnDampingDistance) /
              Math.max(aiCfg.tangentBlendDistance, 1),
          0,
          1,
        );
  let steerTarget =
    headingError * physicsConfig.ai.steeringGain +
    lateralError * physicsConfig.ai.lateralErrorGain;
  steerTarget *= 1 - obstacleTurnDamping * 0.18;
  steerTarget = clamp(steerTarget, -1, 1);

  const forwardSpeed = aiCar.vx * forwardX + aiCar.vy * forwardY;
  const targetSpeed = computeAiTargetSpeed(graph);
  let throttleTarget = 1;
  let brakeTarget = 0;
  if (forwardSpeed > targetSpeed + aiCfg.lateBrakeMargin) {
    brakeTarget = clamp((forwardSpeed - targetSpeed) / 72, 0, 1);
    throttleTarget = brakeTarget > 0.1 ? 0 : 1;
  } else {
    throttleTarget = 1;
  }
  let handbrakeTarget = 0;
  if (Math.abs(headingError) > 1.18 && Math.abs(forwardSpeed) > 235) {
    handbrakeTarget = clamp((Math.abs(headingError) - 1.18) / 0.45, 0, 0.4);
    throttleTarget *= 0.94;
  }

  const rivalDistance = Math.hypot(car.x - aiCar.x, car.y - aiCar.y);
  const rivalAhead =
    (car.x - aiCar.x) * forwardX + (car.y - aiCar.y) * forwardY > 0;
  if (rivalAhead && rivalDistance < physicsConfig.ai.rivalAvoidanceRadius) {
    brakeTarget = Math.max(
      brakeTarget,
      0.04 *
        (1 -
          rivalDistance / Math.max(physicsConfig.ai.rivalAvoidanceRadius, 1)),
    );
  }
  setAiInputTargets(dt, {
    throttle: throttleTarget,
    brake: brakeTarget,
    steer: steerTarget,
    handbrake: handbrakeTarget,
  });
}

function updateAiRecoveryControl(dt, graph) {
  const aiCfg = physicsConfig.ai;
  aiPhysicsRuntime.recoveryTimer += dt;
  const recoveryNode =
    pickAiRecoveryNode(graph, aiCfg.softResetSearchRadiusFallback) ||
    (aiPhysicsRuntime.lastValidNodeId >= 0
      ? graph.nodes[aiPhysicsRuntime.lastValidNodeId]
      : null);
  if (!recoveryNode) {
    applyAiSoftReset(graph);
    return;
  }

  aiPhysicsRuntime.targetNodeId = recoveryNode.id;
  aiPhysicsRuntime.targetPoint = { x: recoveryNode.x, y: recoveryNode.y };
  aiPhysicsRuntime.debugPathPoints = [{ x: recoveryNode.x, y: recoveryNode.y }];
  const desiredForwardHeading = Math.atan2(
    recoveryNode.y - aiCar.y,
    recoveryNode.x - aiCar.x,
  );

  if (aiPhysicsRuntime.recoveryTimer >= aiCfg.maxRecoveryTime) {
    if (aiPhysicsRuntime.softResetCooldown <= 0) {
      applyAiSoftReset(graph);
    }
    return;
  }

  if (aiPhysicsRuntime.recoveryMode === "forwardHook") {
    const headingError = signedAngleDelta(aiCar.angle, desiredForwardHeading);
    setAiInputTargets(dt, {
      throttle: 1,
      brake: 0,
      steer: clamp(headingError * 1.4, -1, 1),
    });
    if (
      aiPhysicsRuntime.recoveryTimer >=
      aiCfg.reverseRecoverTime + aiCfg.forwardRecoverTime
    ) {
      aiPhysicsRuntime.recoveryMode = "reverseTurn";
      aiPhysicsRuntime.recoveryTimer = 0;
    }
    return;
  }

  const reverseHeading = desiredForwardHeading + Math.PI;
  const headingError = signedAngleDelta(aiCar.angle, reverseHeading);
  setAiInputTargets(dt, {
    throttle: 0,
    brake: 1,
    steer: clamp(headingError * 1.2, -1, 1),
  });
  if (aiPhysicsRuntime.recoveryTimer >= aiCfg.reverseRecoverTime) {
    aiPhysicsRuntime.recoveryMode = "forwardHook";
  }
}

function updateAiControl(dt) {
  const aiCfg = physicsConfig.ai;
  const graph = getTrackNavigationGraph(track);
  const currentSurface = surfaceAt(aiCar.x, aiCar.y);
  aiPhysicsRuntime.progress = trackProgressAtPoint(aiCar.x, aiCar.y, track);
  aiPhysicsRuntime.replanCooldown = Math.max(
    0,
    aiPhysicsRuntime.replanCooldown - dt,
  );
  aiPhysicsRuntime.softResetCooldown = Math.max(
    0,
    aiPhysicsRuntime.softResetCooldown - dt,
  );

  const nearestNode = findNearestTrackNavNode(aiCar.x, aiCar.y, {
    maxDistance: aiCfg.softResetSearchRadiusFallback,
    progressHint: aiPhysicsRuntime.progress,
  });
  if (nearestNode) {
    aiPhysicsRuntime.currentNodeId = nearestNode.id;
    if (currentSurface === "asphalt" || currentSurface === "curb") {
      aiPhysicsRuntime.lastValidNodeId = nearestNode.id;
      const routeIndex = graph.routeIndexByNodeId[nearestNode.id];
      if (routeIndex >= 0) aiPhysicsRuntime.routeNodeIndex = routeIndex;
    }
  }

  if (aiPhysicsRuntime.mode !== "recover") {
    updateAiRaceControl(dt, graph);
  } else {
    updateAiRecoveryControl(dt, graph);
  }
}

function distanceToAiPlannedPath(graph) {
  if (!graph || !aiPhysicsRuntime.plannedNodeIds.length) return Infinity;
  let bestDistance = Infinity;
  const startIndex = Math.max(0, aiPhysicsRuntime.pathCursor - 1);
  const endIndex = Math.min(
    aiPhysicsRuntime.plannedNodeIds.length - 1,
    aiPhysicsRuntime.pathCursor + 6,
  );
  for (let i = startIndex; i < endIndex; i++) {
    const fromNode = graph.nodes[aiPhysicsRuntime.plannedNodeIds[i]];
    const toNode = graph.nodes[aiPhysicsRuntime.plannedNodeIds[i + 1]];
    if (!fromNode || !toNode) continue;
    const projection = projectPointToSegment(
      aiCar.x,
      aiCar.y,
      fromNode.x,
      fromNode.y,
      toNode.x,
      toNode.y,
    );
    bestDistance = Math.min(
      bestDistance,
      Math.hypot(projection.x - aiCar.x, projection.y - aiCar.y),
    );
  }
  if (!Number.isFinite(bestDistance)) {
    const fallbackNode =
      graph.nodes[aiPhysicsRuntime.plannedNodeIds[aiPhysicsRuntime.pathCursor]];
    if (!fallbackNode) return Infinity;
    return Math.hypot(fallbackNode.x - aiCar.x, fallbackNode.y - aiCar.y);
  }
  return bestDistance;
}

function updateAiProgressHealth(dt, collision) {
  const aiCfg = physicsConfig.ai;
  const graph = getTrackNavigationGraph(track);
  const nextProgress = trackProgressAtPoint(aiCar.x, aiCar.y, track);
  const progressGain = progressDeltaForward(
    aiPhysicsRuntime.progressAtLastSample,
    nextProgress,
  );
  aiPhysicsRuntime.progressAtLastSample = nextProgress;
  aiPhysicsRuntime.progress = nextProgress;

  const currentSurface = surfaceAt(aiCar.x, aiCar.y);
  if (
    aiCar.speed < aiCfg.stuckSpeedThreshold &&
    progressGain < aiCfg.stuckProgressThreshold
  ) {
    aiPhysicsRuntime.lowProgressTimer += dt;
  } else {
    aiPhysicsRuntime.lowProgressTimer = Math.max(
      0,
      aiPhysicsRuntime.lowProgressTimer - dt * 1.5,
    );
  }
  if (currentSurface === "grass" || currentSurface === "water") {
    const distanceToPlan = distanceToAiPlannedPath(graph);
    const intentionalGrassShortcut =
      currentSurface === "grass" &&
      distanceToPlan <= aiCfg.grassRecoveryPathDistance &&
      (progressGain >= aiCfg.stuckProgressThreshold ||
        aiCar.speed >= aiCfg.grassRecoverySpeedThreshold);
    if (currentSurface === "water" || !intentionalGrassShortcut) {
      aiPhysicsRuntime.offRoadTimer += dt;
    } else {
      aiPhysicsRuntime.offRoadTimer = Math.max(
        0,
        aiPhysicsRuntime.offRoadTimer - dt * 2,
      );
    }
  } else {
    aiPhysicsRuntime.offRoadTimer = 0;
  }

  if (collision?.hit) {
    const prevDot =
      aiPhysicsRuntime.lastCollisionNormalX * collision.normalX +
      aiPhysicsRuntime.lastCollisionNormalY * collision.normalY;
    aiPhysicsRuntime.lastCollisionNormalX = collision.normalX;
    aiPhysicsRuntime.lastCollisionNormalY = collision.normalY;
    aiPhysicsRuntime.repeatedCollisionTimer += prevDot < 0.2 ? dt : dt * 0.55;
  } else {
    aiPhysicsRuntime.repeatedCollisionTimer = Math.max(
      0,
      aiPhysicsRuntime.repeatedCollisionTimer - dt * 2,
    );
  }

  const recovered =
    (currentSurface === "asphalt" || currentSurface === "curb") &&
    progressGain >= aiCfg.stuckProgressThreshold * 2;
  if (aiPhysicsRuntime.mode === "recover" && recovered) {
    aiPhysicsRuntime.mode = "race";
    aiPhysicsRuntime.recoveryMode = "none";
    aiPhysicsRuntime.recoveryTimer = 0;
    aiPhysicsRuntime.lowProgressTimer = 0;
    aiPhysicsRuntime.offRoadTimer = 0;
    aiPhysicsRuntime.repeatedCollisionTimer = 0;
    aiPhysicsRuntime.replanCooldown = 0;
    return;
  }

  if (
    aiPhysicsRuntime.mode === "race" &&
    (aiPhysicsRuntime.lowProgressTimer >= aiCfg.stuckTime ||
      aiPhysicsRuntime.offRoadTimer >= aiCfg.offRoadStuckTime ||
      aiPhysicsRuntime.repeatedCollisionTimer >= aiCfg.repeatedCollisionTime)
  ) {
    aiPhysicsRuntime.mode = "recover";
    aiPhysicsRuntime.recoveryMode = "reverseTurn";
    aiPhysicsRuntime.recoveryTimer = 0;
    aiPhysicsRuntime.replanCooldown = 0;
  }
}

function updateAiVehicle(dt) {
  const carCfg = physicsConfig.car;
  const assistCfg = physicsConfig.assists;
  const flags = physicsConfig.flags;
  const constants = physicsConfig.constants;
  const surfaceName = surfaceAt(aiCar.x, aiCar.y);
  const targetSurface =
    physicsConfig.surfaces[surfaceName] || physicsConfig.surfaces.asphalt;
  const blendAlpha = flags.SURFACE_BLENDING
    ? clamp(dt / Math.max(constants.surfaceBlendTime, 0.001), 0, 1)
    : 1;

  aiPhysicsRuntime.surface.lateralGripMul +=
    (targetSurface.lateralGripMul - aiPhysicsRuntime.surface.lateralGripMul) *
    blendAlpha;
  aiPhysicsRuntime.surface.longDragMul +=
    (targetSurface.longDragMul - aiPhysicsRuntime.surface.longDragMul) *
    blendAlpha;
  aiPhysicsRuntime.surface.engineMul +=
    (targetSurface.engineMul - aiPhysicsRuntime.surface.engineMul) * blendAlpha;
  aiPhysicsRuntime.surface.coastDecelMul +=
    (targetSurface.coastDecelMul - aiPhysicsRuntime.surface.coastDecelMul) *
    blendAlpha;

  const forwardX = Math.cos(aiCar.angle);
  const forwardY = Math.sin(aiCar.angle);
  const rightX = -forwardY;
  const rightY = forwardX;
  let forwardSpeed = aiCar.vx * forwardX + aiCar.vy * forwardY;
  let lateralSpeed = aiCar.vx * rightX + aiCar.vy * rightY;

  if (aiPhysicsRuntime.input.throttle > 0.01) {
    forwardSpeed +=
      carCfg.engineAccel *
      aiPhysicsRuntime.surface.engineMul *
      aiPhysicsRuntime.input.throttle *
      dt;
  }
  if (aiPhysicsRuntime.input.brake > 0.01) {
    forwardSpeed -= carCfg.brakeDecel * aiPhysicsRuntime.input.brake * dt;
  }
  if (
    aiPhysicsRuntime.input.throttle <= 0.01 &&
    aiPhysicsRuntime.input.brake <= 0.01
  ) {
    forwardSpeed = moveTowards(
      forwardSpeed,
      0,
      carCfg.coastDecel * aiPhysicsRuntime.surface.coastDecelMul * dt,
    );
  }
  if (flags.HANDBRAKE_MODE && aiPhysicsRuntime.input.handbrake > 0.05) {
    const handbrakeDecel =
      assistCfg.handbrakeLongDecel * aiPhysicsRuntime.input.handbrake * dt;
    if (forwardSpeed > 0) {
      forwardSpeed = Math.max(0, forwardSpeed - handbrakeDecel);
    } else {
      forwardSpeed = moveTowards(
        forwardSpeed,
        0,
        assistCfg.handbrakeReverseKillDecel *
          aiPhysicsRuntime.input.handbrake *
          dt,
      );
    }
  }
  forwardSpeed *= Math.exp(
    -carCfg.longDrag * aiPhysicsRuntime.surface.longDragMul * dt,
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
  const targetYawRate =
    aiPhysicsRuntime.input.steer *
    carCfg.steerRate *
    lowSpeedSteerMul *
    speedSteerMul;
  let desiredYawRate = targetYawRate;
  if (flags.HANDBRAKE_MODE && aiPhysicsRuntime.input.handbrake > 0.05) {
    desiredYawRate +=
      assistCfg.handbrakeYawBoost *
      aiPhysicsRuntime.input.handbrake *
      aiPhysicsRuntime.input.steer;
  }
  aiPhysicsRuntime.steeringRate +=
    (desiredYawRate - aiPhysicsRuntime.steeringRate) *
    clamp(carCfg.yawDamping * dt, 0, 1);
  const oldAngle = aiCar.angle;
  aiCar.angle += aiPhysicsRuntime.steeringRate * dt;

  let effectiveLateralGrip =
    carCfg.lateralGrip * aiPhysicsRuntime.surface.lateralGripMul;
  const allowAutoDrift = surfaceName !== "grass";
  if (
    flags.AUTO_DRIFT_ON_STEER &&
    allowAutoDrift &&
    Math.abs(aiPhysicsRuntime.input.steer) > constants.driftSteerThreshold
  ) {
    effectiveLateralGrip *=
      1 - assistCfg.autoDriftGripCut * Math.abs(aiPhysicsRuntime.input.steer);
  }
  if (flags.DRIFT_ASSIST_RECOVERY) {
    const steerAbs = Math.abs(aiPhysicsRuntime.input.steer);
    if (
      aiPhysicsRuntime.prevSteerAbs > constants.driftSteerThreshold &&
      steerAbs <= constants.driftSteerThreshold
    ) {
      aiPhysicsRuntime.recoveryTimer = assistCfg.driftAssistRecoveryTime;
    }
    aiPhysicsRuntime.prevSteerAbs = steerAbs;
    if (aiPhysicsRuntime.recoveryTimer > 0) {
      effectiveLateralGrip *= 1 + assistCfg.driftAssistRecoveryBoost;
      aiPhysicsRuntime.recoveryTimer = Math.max(
        0,
        aiPhysicsRuntime.recoveryTimer - dt,
      );
    }
  }
  if (
    allowAutoDrift &&
    aiPhysicsRuntime.input.throttle < 0.08 &&
    speedAbs > assistCfg.throttleLiftMinSpeed
  ) {
    const liftBlend =
      (1 - aiPhysicsRuntime.input.throttle) *
      clamp(
        (speedAbs - assistCfg.throttleLiftMinSpeed) /
          Math.max(carCfg.maxSpeed - assistCfg.throttleLiftMinSpeed, 1),
        0,
        1,
      );
    effectiveLateralGrip *= 1 - assistCfg.throttleLiftGripCut * liftBlend;
    lateralSpeed +=
      aiPhysicsRuntime.input.steer *
      speedAbs *
      assistCfg.throttleLiftSlipBoost *
      liftBlend *
      dt;
  }
  if (flags.HANDBRAKE_MODE && aiPhysicsRuntime.input.handbrake > 0.05) {
    const gripMul =
      1 + (assistCfg.handbrakeGrip - 1) * aiPhysicsRuntime.input.handbrake;
    effectiveLateralGrip *= gripMul;
    lateralSpeed +=
      aiPhysicsRuntime.input.steer *
      Math.max(speedAbs, 0) *
      assistCfg.handbrakeSlipBoost *
      aiPhysicsRuntime.input.handbrake *
      dt;
  }
  if (aiPhysicsRuntime.collisionGripTimer > 0) {
    effectiveLateralGrip *= 0.7;
    aiPhysicsRuntime.collisionGripTimer = Math.max(
      0,
      aiPhysicsRuntime.collisionGripTimer - dt,
    );
  }

  lateralSpeed *= 1 - clamp(effectiveLateralGrip * dt, 0, 1);
  aiCar.vx =
    Math.cos(aiCar.angle) * forwardSpeed +
    -Math.sin(aiCar.angle) * lateralSpeed;
  aiCar.vy =
    Math.sin(aiCar.angle) * forwardSpeed + Math.cos(aiCar.angle) * lateralSpeed;

  const headingForwardX = Math.cos(aiCar.angle);
  const headingForwardY = Math.sin(aiCar.angle);
  const pivotBlend = clamp(
    Math.abs(forwardSpeed) / Math.max(constants.pivotBlendSpeed, 1),
    0,
    1,
  );
  let pivotRatio =
    constants.pivotAtLowSpeedRatio +
    (constants.pivotFromRearRatio - constants.pivotAtLowSpeedRatio) *
      pivotBlend;
  if (flags.HANDBRAKE_MODE && aiPhysicsRuntime.input.handbrake > 0.05) {
    pivotRatio +=
      (constants.pivotAtLowSpeedRatio - pivotRatio) *
      clamp(aiPhysicsRuntime.input.handbrake, 0, 1);
  }
  const pivotOffset = aiCar.width * (pivotRatio - 0.5);
  const pivotShiftX =
    Math.cos(oldAngle) * pivotOffset - headingForwardX * pivotOffset;
  const pivotShiftY =
    Math.sin(oldAngle) * pivotOffset - headingForwardY * pivotOffset;
  const collision = resolveObjectCollisions(
    aiCar.x + aiCar.vx * dt + pivotShiftX,
    aiCar.y + aiCar.vy * dt + pivotShiftY,
    0,
  );
  aiCar.x = collision.x;
  aiCar.y = collision.y;
  if (collision.hit) {
    const inwardSpeed =
      aiCar.vx * collision.normalX + aiCar.vy * collision.normalY;
    if (inwardSpeed < 0) {
      aiCar.vx -= inwardSpeed * collision.normalX;
      aiCar.vy -= inwardSpeed * collision.normalY;
    }
    if (flags.ARCADE_COLLISION_PUSH) {
      aiCar.vx *= 0.72;
      aiCar.vy *= 0.72;
      aiCar.vx += collision.normalX * 18;
      aiCar.vy += collision.normalY * 18;
      aiPhysicsRuntime.collisionGripTimer = 0.08;
    } else {
      aiCar.vx *= 0.55;
      aiCar.vy *= 0.55;
    }
  }

  const headingRightX = -headingForwardY;
  const headingRightY = headingForwardX;
  let rawHeadingForwardSpeed =
    aiCar.vx * headingForwardX + aiCar.vy * headingForwardY;
  if (
    flags.HANDBRAKE_MODE &&
    aiPhysicsRuntime.input.handbrake > 0.05 &&
    rawHeadingForwardSpeed < 0
  ) {
    aiCar.vx -= rawHeadingForwardSpeed * headingForwardX;
    aiCar.vy -= rawHeadingForwardSpeed * headingForwardY;
    rawHeadingForwardSpeed = 0;
  }
  const maxVectorSpeed =
    rawHeadingForwardSpeed >= 0
      ? carCfg.maxSpeed
      : carCfg.maxSpeed * carCfg.reverseMaxSpeedMul;
  const vectorSpeed = Math.hypot(aiCar.vx, aiCar.vy);
  if (vectorSpeed > maxVectorSpeed && vectorSpeed > 0) {
    const scale = maxVectorSpeed / vectorSpeed;
    aiCar.vx *= scale;
    aiCar.vy *= scale;
  }

  aiCar.speed = Math.hypot(aiCar.vx, aiCar.vy);
  aiPhysicsRuntime.lastGroundedSpeed = aiCar.speed;
  const headingForwardSpeed =
    aiCar.vx * headingForwardX + aiCar.vy * headingForwardY;
  const headingLateralSpeed =
    aiCar.vx * headingRightX + aiCar.vy * headingRightY;
  const prevForward = aiPhysicsRuntime.prevForwardSpeed;
  const longAccel =
    prevForward === null || dt <= 0
      ? 0
      : (headingForwardSpeed - prevForward) / dt;
  aiPhysicsRuntime.prevForwardSpeed = headingForwardSpeed;
  const skidSurface = surfaceAt(aiCar.x, aiCar.y);
  const wheelPoints = wheelWorldPoints(aiCar);
  recordSkids(
    skidSurface,
    headingForwardSpeed,
    headingLateralSpeed,
    longAccel,
    {
      vehicle: aiCar,
      runtime: aiPhysicsRuntime,
    },
  );
  emitDrivingParticles({
    dt,
    vehicle: aiCar,
    runtime: aiPhysicsRuntime,
    wheelPoints,
    forwardX: headingForwardX,
    forwardY: headingForwardY,
    headingForwardSpeed,
    headingLateralSpeed,
    surfaceName: skidSurface,
  });
  updateAiVehicleAudioState({
    surfaceName: skidSurface,
    headingForwardSpeed,
    headingLateralSpeed,
    longAccel,
  });
  updateAiProgressHealth(dt, collision);
}

export function resolveCarToCarCollision(
  carA,
  carB,
  { radiusScale = 0.34, restitution = 0.14, pushBias = 0.5 } = {},
) {
  const radiusA = Math.max(carA.width, carA.height) * radiusScale;
  const radiusB = Math.max(carB.width, carB.height) * radiusScale;
  const dx = carB.x - carA.x;
  const dy = carB.y - carA.y;
  const distance = Math.hypot(dx, dy);
  const minDistance = radiusA + radiusB;
  if (distance >= minDistance || minDistance <= 0) return false;

  const nx = distance > 1e-4 ? dx / distance : 1;
  const ny = distance > 1e-4 ? dy / distance : 0;
  const overlap = minDistance - distance;
  carA.x -= nx * overlap * pushBias;
  carA.y -= ny * overlap * pushBias;
  carB.x += nx * overlap * (1 - pushBias);
  carB.y += ny * overlap * (1 - pushBias);

  const relativeNormalVelocity =
    (carB.vx - carA.vx) * nx + (carB.vy - carA.vy) * ny;
  if (relativeNormalVelocity < 0) {
    const impulse = -(1 + restitution) * relativeNormalVelocity * 0.5;
    carA.vx -= nx * impulse;
    carA.vy -= ny * impulse;
    carB.vx += nx * impulse;
    carB.vy += ny * impulse;
  }
  carA.speed = Math.hypot(carA.vx, carA.vy);
  carB.speed = Math.hypot(carB.vx, carB.vy);
  return true;
}

function checkCheckpointProgress(vehicle, targetLapData, options = {}) {
  if (!checkpoints.length || targetLapData.finished) return;
  const { blink = false, onFinish = null, racerKey = "player" } = options;
  const startCheckpointIndex = getStartCheckpointIndex();
  const targetIndex = targetLapData.nextCheckpointIndex % checkpoints.length;
  const cp = checkpoints[targetIndex];
  const frame = trackFrameAtAngle(cp.angle, track);
  const checkpointSpan = frame.roadWidth * CHECKPOINT_WIDTH_MULTIPLIER;
  const halfSpan = checkpointSpan * 0.5;
  const ax = frame.point.x - frame.normal.x * halfSpan;
  const ay = frame.point.y - frame.normal.y * halfSpan;
  const bx = frame.point.x + frame.normal.x * halfSpan;
  const by = frame.point.y + frame.normal.y * halfSpan;
  const triggerDistance = Math.max(15, vehicle.width * 0.55);
  const nearCheckpoint =
    distanceToSegment(vehicle.x, vehicle.y, ax, ay, bx, by) <= triggerDistance;
  if (!nearCheckpoint) return;

  if (blink) {
    state.checkpointBlink.time = state.checkpointBlink.duration;
  }

  if (targetIndex !== startCheckpointIndex) {
    targetLapData.passed.add(targetIndex);
    targetLapData.nextCheckpointIndex = (targetIndex + 1) % checkpoints.length;
    return;
  }

  if (targetLapData.passed.size !== checkpoints.length) return;
  const lapTime = state.raceTime - targetLapData.currentLapStart;
  if (lapTime <= 2) return;

  targetLapData.lapTimes.push(lapTime);
  targetLapData.currentLapStart = state.raceTime;
  targetLapData.passed = new Set([startCheckpointIndex]);
  targetLapData.nextCheckpointIndex =
    (startCheckpointIndex + 1) % checkpoints.length;
  targetLapData.lap += 1;

  if (targetLapData.lap > targetLapData.maxLaps) {
    targetLapData.finished = true;
    targetLapData.finishTime = state.raceTime;
    recordRaceFinish(racerKey);
    if (typeof onFinish === "function") onFinish();
  }
}

function wheelWorldPoints(vehicle = car) {
  const forwardX = Math.cos(vehicle.angle);
  const forwardY = Math.sin(vehicle.angle);
  const rightX = -forwardY;
  const rightY = forwardX;
  const frontOffset = vehicle.width * 0.36;
  const rearOffset = -vehicle.width * 0.34;
  const sideOffset = vehicle.height * 0.43;
  const localOffsets = [
    { x: frontOffset, y: -sideOffset },
    { x: frontOffset, y: sideOffset },
    { x: rearOffset, y: -sideOffset },
    { x: rearOffset, y: sideOffset },
  ];

  return localOffsets.map((o) => ({
    x: vehicle.x + forwardX * o.x + rightX * o.y,
    y: vehicle.y + forwardY * o.x + rightY * o.y,
  }));
}

function emitDrivingParticles({
  dt,
  vehicle = car,
  runtime = physicsRuntime,
  wheelPoints,
  forwardX,
  forwardY,
  headingForwardSpeed,
  headingLateralSpeed,
  surfaceName,
}) {
  const emitters = runtime.particleEmitters;
  emitters.smokeCooldown = Math.max(0, emitters.smokeCooldown - dt);
  emitters.splashCooldown = Math.max(0, emitters.splashCooldown - dt);
  emitters.dustCooldown = Math.max(0, emitters.dustCooldown - dt);

  const speedAbs = Math.abs(headingForwardSpeed);
  const lateralAbs = Math.abs(headingLateralSpeed);
  const speedFactor = clamp((vehicle.speed - 28) / 110, 0, 1);
  const handbrakeStrength =
    runtime.input.handbrake *
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
        inheritVx: vehicle.vx * 0.16,
        inheritVy: vehicle.vy * 0.16,
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
        inheritVx: vehicle.vx * 0.1,
        inheritVy: vehicle.vy * 0.1,
      });
    }
    emitters.dustCooldown = 0.05 - grassStrength * 0.022;
  }
}

function recordSkids(
  surfaceName,
  forwardSpeed,
  lateralSpeed,
  longAccel,
  { vehicle = car, runtime = physicsRuntime } = {},
) {
  if (vehicle.airborne) {
    runtime.wheelLastPoints = null;
    return;
  }

  const points = wheelWorldPoints(vehicle);
  const lastPoints = runtime.wheelLastPoints;
  runtime.wheelLastPoints = points;
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
  const handbrakeSkid = runtime.input.handbrake > 0.08 && speedAbs > 24;
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

function emitLandingMarks(surfaceName, impact) {
  const isGrass = surfaceName === "grass";
  const isWater = surfaceName === "water";
  const isRoad = surfaceName === "asphalt" || surfaceName === "curb";
  if (!isGrass && !isWater && !isRoad) return;

  const color = isGrass
    ? "rgba(112, 74, 44, 0.40)"
    : isWater
      ? "rgba(245, 250, 255, 0.42)"
      : "rgba(20, 20, 20, 0.37)";
  const width = isGrass || isWater ? 2.7 : 2.2;
  const forwardX = Math.cos(car.angle);
  const forwardY = Math.sin(car.angle);
  const markLength = 4 + clamp(impact, 0, 1) * 7;
  const wheelPoints = wheelWorldPoints();

  for (const point of wheelPoints) {
    skidMarks.push({
      x1: point.x - forwardX * markLength,
      y1: point.y - forwardY * markLength,
      x2: point.x,
      y2: point.y,
      color,
      width,
    });
  }
}

function updateVehicleAudioState({
  surfaceName,
  headingForwardSpeed = 0,
  headingLateralSpeed = 0,
  longAccel = 0,
}) {
  const carCfg = physicsConfig.car;
  const airCfg = physicsConfig.air;
  const skidAmount = car.airborne
    ? 0
    : clamp(Math.abs(headingLateralSpeed) / 110, 0, 1) *
      clamp(Math.abs(headingForwardSpeed) / 45, 0, 1);
  const airborneAmount = clamp(car.z / Math.max(airCfg.maxJumpHeight, 1), 0, 1);
  const wheelSpinAmount = car.airborne
    ? clamp(
        physicsRuntime.input.throttle * 0.8 +
          Math.abs(car.vz) / Math.max(airCfg.maxJumpHeight * 4, 1),
        0,
        1,
      )
    : 0;

  gameAudio.updateVehicleAudio({
    speedNormalized: clamp(car.speed / Math.max(carCfg.maxSpeed, 1), 0, 1),
    throttle: physicsRuntime.input.throttle,
    acceleration: clamp(longAccel / Math.max(carCfg.engineAccel, 1), -1, 1),
    skidAmount,
    surface: surfaceName,
    isMoving: car.speed > 4,
    airborne: car.airborne,
    airborneAmount,
    wheelSpinAmount,
  });
}

function updateAiVehicleAudioState({
  surfaceName,
  headingForwardSpeed = 0,
  headingLateralSpeed = 0,
  longAccel = 0,
}) {
  const carCfg = physicsConfig.car;
  const airCfg = physicsConfig.air;
  const wheelSpinAmount = aiCar.airborne
    ? clamp(
        aiPhysicsRuntime.input.throttle * 0.8 +
          Math.abs(aiCar.vz) / Math.max(airCfg.maxJumpHeight * 4, 1),
        0,
        1,
      )
    : 0;

  gameAudio.updateRivalVehicleAudio({
    speedNormalized: clamp(aiCar.speed / Math.max(carCfg.maxSpeed, 1), 0, 1),
    throttle: aiPhysicsRuntime.input.throttle,
    acceleration: clamp(longAccel / Math.max(carCfg.engineAccel, 1), -1, 1),
    skidAmount: aiCar.airborne
      ? 0
      : clamp(Math.abs(headingLateralSpeed) / 120, 0, 1) *
        clamp(Math.abs(headingForwardSpeed) / 55, 0, 1),
    surface: surfaceName,
    isMoving: aiCar.speed > 4,
    airborne: aiCar.airborne,
    airborneAmount: clamp(aiCar.z / Math.max(airCfg.maxJumpHeight, 1), 0, 1),
    wheelSpinAmount,
  });
}

function launchFromSpring() {
  const airCfg = physicsConfig.air;
  const speedRatio = clamp(
    car.speed / Math.max(physicsConfig.car.maxSpeed, 1),
    0,
    1,
  );
  const apexHeight = Math.min(airCfg.maxJumpHeight, 1.8 + speedRatio * 1.2);
  car.airborne = true;
  car.airTime = 0;
  car.z = Math.max(car.z, 0.02);
  car.vz = Math.sqrt(2 * airCfg.gravity * apexHeight);
  car.visualScale = 1 + car.z * airCfg.visualScalePerMeter;
  physicsRuntime.landingBouncePending = true;
  physicsRuntime.lastGroundedSpeed = car.speed;
  physicsRuntime.wheelLastPoints = null;
}

function resolveLanding(surfaceName) {
  const airCfg = physicsConfig.air;
  if (car.z > 0) return;
  car.z = 0;
  const landingImpact = clamp(Math.abs(car.vz) / 8, 0, 1);
  if (landingImpact > 0.08) emitLandingMarks(surfaceName, landingImpact);
  if (car.vz < -airCfg.minBounceVz && physicsRuntime.landingBouncePending) {
    car.vz = Math.abs(car.vz) * airCfg.bounceRestitution;
    car.airborne = true;
    car.airTime += 0.01;
    physicsRuntime.landingBouncePending = false;
    physicsRuntime.wheelLastPoints = null;
    return;
  }

  car.vz = 0;
  car.airborne = false;
  car.airTime = 0;
  car.visualScale = 1;
  physicsRuntime.landingBouncePending = false;
  physicsRuntime.landingCooldown = 0.1;
  physicsRuntime.lastGroundedSpeed = car.speed;
  physicsRuntime.wheelLastPoints = wheelWorldPoints();
  if (landingImpact > 0.08) gameAudio.playLandingBump(landingImpact);
  if (surfaceName === "grass") physicsRuntime.collisionGripTimer = 0.04;
}

function integrateAirborneMotion(dt, surfaceName) {
  const airCfg = physicsConfig.air;
  const carCfg = physicsConfig.car;
  const headingX = Math.cos(car.angle);
  const headingY = Math.sin(car.angle);
  const headingForwardSpeed = car.vx * headingX + car.vy * headingY;
  let forwardSpeed = headingForwardSpeed;

  forwardSpeed +=
    carCfg.engineAccel *
    airCfg.throttleAccelMul *
    physicsRuntime.input.throttle *
    dt;
  forwardSpeed -=
    carCfg.brakeDecel * airCfg.brakeDecelMul * physicsRuntime.input.brake * dt;
  forwardSpeed *= Math.exp(-carCfg.longDrag * airCfg.longDragMul * dt);

  car.vx = headingX * forwardSpeed;
  car.vy = headingY * forwardSpeed;
  const collision = resolveObjectCollisions(
    car.x + car.vx * dt,
    car.y + car.vy * dt,
    car.z,
  );
  car.x = collision.x;
  car.y = collision.y;
  if (collision.hit) {
    const inwardSpeed = car.vx * collision.normalX + car.vy * collision.normalY;
    if (inwardSpeed < 0) {
      car.vx -= inwardSpeed * collision.normalX;
      car.vy -= inwardSpeed * collision.normalY;
    }
  }

  car.speed = Math.hypot(car.vx, car.vy);
  car.vz -= airCfg.gravity * dt;
  car.z += car.vz * dt;
  car.airTime += dt;
  car.visualScale = Math.min(
    1.32,
    1 + Math.max(car.z, 0) * airCfg.visualScalePerMeter,
  );
  physicsRuntime.debug.surface = surfaceName;
  physicsRuntime.debug.vForward = forwardSpeed;
  physicsRuntime.debug.vLateral = 0;
  physicsRuntime.debug.z = car.z;
  physicsRuntime.debug.vz = car.vz;
  physicsRuntime.debug.pivotX = car.x;
  physicsRuntime.debug.pivotY = car.y;

  resolveLanding(surfaceName);

  const prevForward = physicsRuntime.prevForwardSpeed;
  const longAccel =
    prevForward === null || dt <= 0 ? 0 : (forwardSpeed - prevForward) / dt;
  physicsRuntime.prevForwardSpeed = forwardSpeed;
  updateVehicleAudioState({
    surfaceName,
    headingForwardSpeed: forwardSpeed,
    headingLateralSpeed: 0,
    longAccel,
  });
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
  car.z = 0;
  car.vz = 0;
  car.airborne = false;
  car.airTime = 0;
  car.visualScale = 1;
  state.raceTime = 0;
  state.finished = false;
  state.paused = false;
  state.pauseMenuIndex = 0;
  state.raceStandings.nextFinishOrder = 1;
  state.raceStandings.playerFinishOrder = 0;
  state.raceStandings.aiFinishOrder = 0;
  const startCheckpointIndex = getStartCheckpointIndex();
  resetLapProgress(lapData, startCheckpointIndex);
  aiCar.x = spawnPoint.x - Math.cos(car.angle) * 34 - Math.sin(car.angle) * 22;
  aiCar.y = spawnPoint.y - Math.sin(car.angle) * 34 + Math.cos(car.angle) * 22;
  aiCar.vx = 0;
  aiCar.vy = 0;
  aiCar.angle = car.angle;
  aiCar.speed = 0;
  aiCar.z = 0;
  aiCar.vz = 0;
  aiCar.airborne = false;
  aiCar.airTime = 0;
  aiCar.visualScale = 1;
  resetLapProgress(aiLapData, startCheckpointIndex);
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
  physicsRuntime.lastGroundedSpeed = 0;
  physicsRuntime.landingBouncePending = false;
  physicsRuntime.landingCooldown = 0;
  physicsRuntime.prevSteerAbs = 0;
  physicsRuntime.surface = {
    lateralGripMul: 1,
    longDragMul: 1,
    engineMul: 1,
    coastDecelMul: 1,
  };
  physicsRuntime.debug.pivotX = car.x;
  physicsRuntime.debug.pivotY = car.y;
  physicsRuntime.debug.z = 0;
  physicsRuntime.debug.vz = 0;
  physicsRuntime.wheelLastPoints = null;
  physicsRuntime.prevForwardSpeed = null;
  physicsRuntime.particleEmitters.smokeCooldown = 0;
  physicsRuntime.particleEmitters.splashCooldown = 0;
  physicsRuntime.particleEmitters.dustCooldown = 0;
  aiPhysicsRuntime.input.throttle = 0;
  aiPhysicsRuntime.input.brake = 0;
  aiPhysicsRuntime.input.steer = 0;
  aiPhysicsRuntime.input.handbrake = 0;
  aiPhysicsRuntime.steeringRate = 0;
  aiPhysicsRuntime.recoveryTimer = 0;
  aiPhysicsRuntime.collisionGripTimer = 0;
  aiPhysicsRuntime.impactCooldown = 0;
  aiPhysicsRuntime.prevSteerAbs = 0;
  aiPhysicsRuntime.lastGroundedSpeed = 0;
  aiPhysicsRuntime.landingBouncePending = false;
  aiPhysicsRuntime.landingCooldown = 0;
  aiPhysicsRuntime.mode = "race";
  aiPhysicsRuntime.recoveryMode = "none";
  aiPhysicsRuntime.targetLaneOffset = 0;
  aiPhysicsRuntime.blockedTimer = 0;
  aiPhysicsRuntime.progress = trackProgressAtPoint(aiCar.x, aiCar.y, track);
  aiPhysicsRuntime.progressAtLastSample = aiPhysicsRuntime.progress;
  aiPhysicsRuntime.lowProgressTimer = 0;
  aiPhysicsRuntime.offRoadTimer = 0;
  aiPhysicsRuntime.repeatedCollisionTimer = 0;
  aiPhysicsRuntime.lastCollisionNormalX = 0;
  aiPhysicsRuntime.lastCollisionNormalY = 0;
  aiPhysicsRuntime.lastCollisionTime = 0;
  aiPhysicsRuntime.softResetCooldown = 0;
  aiPhysicsRuntime.replanCooldown = 0;
  aiPhysicsRuntime.currentNodeId = -1;
  aiPhysicsRuntime.lastValidNodeId = -1;
  aiPhysicsRuntime.targetNodeId = -1;
  aiPhysicsRuntime.routeNodeIndex = -1;
  aiPhysicsRuntime.rejoinRouteIndex = -1;
  aiPhysicsRuntime.pathCursor = 0;
  aiPhysicsRuntime.plannedNodeIds = [];
  aiPhysicsRuntime.desiredSpeed = 0;
  aiPhysicsRuntime.targetPoint = { x: aiCar.x, y: aiCar.y };
  aiPhysicsRuntime.debugPathPoints = [];
  aiPhysicsRuntime.surface = {
    lateralGripMul: 1,
    longDragMul: 1,
    engineMul: 1,
    coastDecelMul: 1,
  };
  aiPhysicsRuntime.wheelLastPoints = null;
  aiPhysicsRuntime.prevForwardSpeed = null;
  aiPhysicsRuntime.particleEmitters.smokeCooldown = 0;
  aiPhysicsRuntime.particleEmitters.splashCooldown = 0;
  aiPhysicsRuntime.particleEmitters.dustCooldown = 0;
  primeAiRaceStartPlan();
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
  const airCfg = physicsConfig.air;
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
      airborne: false,
      airborneAmount: 0,
      wheelSpinAmount: 0,
    });
    gameAudio.updateRivalVehicleAudio({
      speedNormalized: 0,
      throttle: 0,
      acceleration: 0,
      skidAmount: 0,
      surface: "asphalt",
      isMoving: false,
      airborne: false,
      airborneAmount: 0,
      wheelSpinAmount: 0,
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

  const throttleTarget = keys.accel ? 1 : 0;
  const brakeTarget = keys.brake ? 1 : 0;
  const steerTarget = car.airborne
    ? 0
    : (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
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

  if (physicsRuntime.landingCooldown > 0) {
    physicsRuntime.landingCooldown = Math.max(
      0,
      physicsRuntime.landingCooldown - dt,
    );
  }

  if (car.airborne) {
    integrateAirborneMotion(dt, surfaceName);
    if (aiOpponentsEnabled()) {
      updateAiControl(dt);
      updateAiVehicle(dt);
      if (resolveCarToCarCollision(car, aiCar)) {
        physicsRuntime.collisionGripTimer = Math.max(
          physicsRuntime.collisionGripTimer,
          0.06,
        );
        aiPhysicsRuntime.collisionGripTimer = Math.max(
          aiPhysicsRuntime.collisionGripTimer,
          0.06,
        );
      }
    } else {
      gameAudio.updateRivalVehicleAudio({
        speedNormalized: 0,
        throttle: 0,
        acceleration: 0,
        skidAmount: 0,
        surface: "asphalt",
        isMoving: false,
        airborne: false,
        airborneAmount: 0,
        wheelSpinAmount: 0,
      });
    }
    if (!state.finished) {
      checkCheckpointProgress(car, lapData, {
        blink: true,
        racerKey: "player",
        onFinish: () => {
          state.finished = true;
          finalizeFinishCelebration();
        },
      });
      if (aiOpponentsEnabled()) {
        checkCheckpointProgress(aiCar, aiLapData, {
          blink: false,
          racerKey: "ai",
        });
      }
    }
    return;
  }

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

  const collision = resolveObjectCollisions(nx, ny, car.z);
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
  physicsRuntime.lastGroundedSpeed = car.speed;
  const headingForwardSpeed =
    car.vx * headingForwardX + car.vy * headingForwardY;
  const headingLateralSpeed = car.vx * headingRightX + car.vy * headingRightY;
  physicsRuntime.debug.surface = surfaceName;
  physicsRuntime.debug.vForward = headingForwardSpeed;
  physicsRuntime.debug.vLateral = headingLateralSpeed;
  physicsRuntime.debug.pivotX = car.x + headingForwardX * pivotOffset;
  physicsRuntime.debug.pivotY = car.y + headingForwardY * pivotOffset;
  physicsRuntime.debug.z = car.z;
  physicsRuntime.debug.vz = car.vz;
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
  const spring = findSpringTrigger(car.x, car.y);
  if (spring && !car.airborne) {
    launchFromSpring();
  }
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
  updateVehicleAudioState({
    surfaceName: skidSurface,
    headingForwardSpeed,
    headingLateralSpeed,
    longAccel,
  });

  if (aiOpponentsEnabled()) {
    updateAiControl(dt);
    updateAiVehicle(dt);
    if (resolveCarToCarCollision(car, aiCar)) {
      physicsRuntime.collisionGripTimer = Math.max(
        physicsRuntime.collisionGripTimer,
        0.06,
      );
      aiPhysicsRuntime.collisionGripTimer = Math.max(
        aiPhysicsRuntime.collisionGripTimer,
        0.06,
      );
    }
  } else {
    gameAudio.updateRivalVehicleAudio({
      speedNormalized: 0,
      throttle: 0,
      acceleration: 0,
      skidAmount: 0,
      surface: "asphalt",
      isMoving: false,
      airborne: false,
      airborneAmount: 0,
      wheelSpinAmount: 0,
    });
  }

  if (!state.finished) {
    checkCheckpointProgress(car, lapData, {
      blink: true,
      racerKey: "player",
      onFinish: () => {
        state.finished = true;
        finalizeFinishCelebration();
      },
    });
    if (aiOpponentsEnabled()) {
      checkCheckpointProgress(aiCar, aiLapData, {
        blink: false,
        racerKey: "ai",
      });
    }
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

import {
  CHECKPOINT_WIDTH_MULTIPLIER,
  applyTrackPreset,
  getCarColorHex,
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
  aiCars,
  aiLapDataList,
  aiPhysicsRuntimes,
  getActiveAiCars,
  getActiveAiLapDataList,
  getActiveAiOpponentCount,
  keys,
  lapData,
  physicsRuntime,
  skidMarks,
  state,
} from "./state.js";
import { gameAudio } from "./game-audio.js";
import { clamp, moveTowards } from "./utils.js";
import {
  checkpointFrame,
  checkpointProgress,
  findSpringTrigger,
  findNearestTrackNavNode,
  getTrackNavigationGraph,
  pointOnCenterLine,
  resolveObjectCollisions,
  surfaceAt,
  trackProgressAtPoint,
  trackStartAngle,
} from "./track.js";

let aiCar = aiCars[0];
let aiLapData = aiLapDataList[0];
let aiPhysicsRuntime = aiPhysicsRuntimes[0];
let aiOpponentIndex = 0;

function selectAiOpponent(index) {
  aiOpponentIndex = index;
  aiCar = aiCars[index];
  aiLapData = aiLapDataList[index];
  aiPhysicsRuntime = aiPhysicsRuntimes[index];
}

function withAiOpponent(index, callback) {
  const prevIndex = aiOpponentIndex;
  const prevAiCar = aiCar;
  const prevAiLapData = aiLapData;
  const prevAiPhysicsRuntime = aiPhysicsRuntime;
  selectAiOpponent(index);
  try {
    return callback(aiCar, aiLapData, aiPhysicsRuntime, index);
  } finally {
    aiOpponentIndex = prevIndex;
    aiCar = prevAiCar;
    aiLapData = prevAiLapData;
    aiPhysicsRuntime = prevAiPhysicsRuntime;
  }
}

function forEachAiOpponent(callback) {
  for (let index = 0; index < getActiveAiOpponentCount(); index++) {
    withAiOpponent(index, callback);
  }
}

function getAiOpponentIndexById(racerKey) {
  if (racerKey === "ai") return 0;
  return getActiveAiCars().findIndex((vehicle) => vehicle.id === racerKey);
}

function getAiStateById(racerKey) {
  const index = getAiOpponentIndexById(racerKey);
  if (index < 0) return null;
  return {
    index,
    vehicle: aiCars[index],
    lapData: aiLapDataList[index],
    runtime: aiPhysicsRuntimes[index],
  };
}

function getFinishOrder(racerKey) {
  return state.raceStandings.finishOrders[racerKey] || 0;
}

function getActiveAiProfile() {
  return (
    state.aiRoster[aiOpponentIndex] || {
      id: aiCar.id,
      name: aiCar.label,
      style: "precise",
      topSpeedMul: 1,
      laneOffset: 0,
    }
  );
}

function getAiProfileByIndex(index) {
  return (
    state.aiRoster[index] || {
      id: aiCars[index]?.id || `ai-${index + 1}`,
      name: aiCars[index]?.label || `AI ${index + 1}`,
      style: "precise",
      topSpeedMul: 1,
      laneOffset: 0,
      kind: "ai",
      participantId: null,
      slotId: null,
      connected: true,
      externalControl: false,
    }
  );
}

function rivalUsesExternalControl(index) {
  return Boolean(getAiProfileByIndex(index).externalControl);
}

function rivalIsRemoteHuman(index) {
  return getAiProfileByIndex(index).kind === "remoteHuman";
}

function smoothInputValue(current, target, dt) {
  const smoothing = physicsConfig.car.inputSmoothing;
  const response = clamp((1 - smoothing) * dt * 60, 0, 1);
  return current + (target - current) * response;
}

function vehicleIsFlying(vehicle = car) {
  return Boolean(vehicle?.airborne) || Number(vehicle?.z) > 0.001;
}

function getVehicleSurfaceAt(
  vehicle = car,
  groundSurfaceName = surfaceAt(vehicle.x, vehicle.y),
) {
  return vehicleIsFlying(vehicle) ? "flying" : groundSurfaceName;
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

function getStartCheckpointIndex() {
  return checkpoints.length ? 0 : -1;
}

function wrapProgress(progress) {
  return ((progress % 1) + 1) % 1;
}

function normalizeCheckpointIndex(index, total) {
  if (!Number.isFinite(index) || total <= 0) return 0;
  return ((Math.round(index) % total) + total) % total;
}

function getCheckpointProgressValue(index) {
  if (!checkpoints.length) return 0;
  const checkpointIndex = normalizeCheckpointIndex(index, checkpoints.length);
  return checkpointProgress(checkpoints[checkpointIndex], track);
}

function getCheckpointsPassedThisLap(racerLapData) {
  const checkpointCount = checkpoints.length;
  if (checkpointCount <= 1) return 0;
  const startCheckpointIndex = getStartCheckpointIndex();
  const nextCheckpointIndex = normalizeCheckpointIndex(
    racerLapData?.nextCheckpointIndex,
    checkpointCount,
  );
  const firstCheckpointAfterStart =
    (startCheckpointIndex + 1) % checkpointCount;
  return normalizeCheckpointIndex(
    nextCheckpointIndex - firstCheckpointAfterStart,
    checkpointCount,
  );
}

function getSegmentProgress(rawProgress, racerLapData) {
  const checkpointCount = checkpoints.length;
  if (checkpointCount <= 1) return 0;
  const nextCheckpointIndex = normalizeCheckpointIndex(
    racerLapData?.nextCheckpointIndex,
    checkpointCount,
  );
  const lastCheckpointIndex =
    (nextCheckpointIndex - 1 + checkpointCount) % checkpointCount;
  const lastCheckpointProgress =
    getCheckpointProgressValue(lastCheckpointIndex);
  const nextCheckpointProgress =
    getCheckpointProgressValue(nextCheckpointIndex);
  const segmentSpan = progressDeltaForward(
    lastCheckpointProgress,
    nextCheckpointProgress,
  );
  if (segmentSpan <= 1e-6) return 0;
  const segmentDistance = progressDeltaForward(
    lastCheckpointProgress,
    rawProgress,
  );
  return clamp(segmentDistance / segmentSpan, 0, 1);
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
  if ("finalPosition" in targetLapData) targetLapData.finalPosition = 0;
}

function applyLapSnapshot(targetLapData, payload = {}) {
  targetLapData.lap = Number.isFinite(payload.lap)
    ? Math.max(1, Math.round(payload.lap))
    : targetLapData.lap;
  targetLapData.maxLaps = Number.isFinite(payload.maxLaps)
    ? Math.max(1, Math.round(payload.maxLaps))
    : targetLapData.maxLaps;
  targetLapData.lapTimes = Array.isArray(payload.lapTimes)
    ? payload.lapTimes
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    : targetLapData.lapTimes;
  targetLapData.passed = Array.isArray(payload.passed)
    ? new Set(
        payload.passed
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 0),
      )
    : targetLapData.passed;
  targetLapData.nextCheckpointIndex = Number.isInteger(
    payload.nextCheckpointIndex,
  )
    ? Math.max(0, payload.nextCheckpointIndex)
    : targetLapData.nextCheckpointIndex;
  targetLapData.finished = Boolean(payload.finished);
  targetLapData.finishTime = Number.isFinite(payload.finishTime)
    ? Number(payload.finishTime)
    : 0;
  targetLapData.finalPosition = Number.isInteger(payload.finalPosition)
    ? Math.max(0, payload.finalPosition)
    : 0;
}

function aiOpponentsEnabled() {
  return physicsConfig.flags.AI_OPPONENTS_ENABLED !== false;
}

function recordRaceFinish(racerKey) {
  const currentOrder = getFinishOrder(racerKey);
  if (currentOrder > 0) return currentOrder;
  const finishOrder = state.raceStandings.nextFinishOrder;
  state.raceStandings.finishOrders[racerKey] = finishOrder;
  if (racerKey === "player") {
    state.raceStandings.playerFinishOrder = finishOrder;
  }
  state.raceStandings.nextFinishOrder += 1;
  return finishOrder;
}

function getRacerSnapshot(racerKey) {
  let vehicle = car;
  let racerLapData = lapData;
  let sortOrder = 0;
  if (racerKey !== "player") {
    const aiState = getAiStateById(racerKey);
    if (!aiState) return null;
    vehicle = aiState.vehicle;
    racerLapData = aiState.lapData;
    sortOrder = aiState.index + 1;
  }
  const rawProgress = trackProgressAtPoint(vehicle.x, vehicle.y, track);
  const checkpointsPassedThisLap = getCheckpointsPassedThisLap(racerLapData);
  const nextCheckpointIndex = checkpoints.length
    ? normalizeCheckpointIndex(
        racerLapData.nextCheckpointIndex,
        checkpoints.length,
      )
    : -1;
  const lastCheckpointIndex =
    nextCheckpointIndex >= 0 && checkpoints.length
      ? (nextCheckpointIndex - 1 + checkpoints.length) % checkpoints.length
      : -1;
  const finishOrder =
    racerKey === "player"
      ? state.raceStandings.playerFinishOrder
      : getFinishOrder(racerKey);
  const finalPosition =
    racerLapData.finalPosition > 0 ? racerLapData.finalPosition : finishOrder;
  return {
    id: racerKey,
    finished: racerLapData.finished,
    finishOrder,
    finalPosition,
    finishTime: racerLapData.finishTime || 0,
    lapsCompleted: Math.max(
      0,
      Math.min(racerLapData.lap - 1, racerLapData.maxLaps),
    ),
    checkpointsPassedThisLap,
    lastCheckpointIndex,
    nextCheckpointIndex,
    segmentProgress: getSegmentProgress(rawProgress, racerLapData),
    sortOrder,
  };
}

function compareRaceSnapshots(a, b) {
  if (a.finished || b.finished) {
    if (a.finished && b.finished) {
      if (a.finalPosition !== b.finalPosition) {
        return a.finalPosition - b.finalPosition;
      }
      if (a.finishOrder !== b.finishOrder) return a.finishOrder - b.finishOrder;
      return a.finishTime - b.finishTime;
    }
    return a.finished ? -1 : 1;
  }
  if (a.lapsCompleted !== b.lapsCompleted) {
    return b.lapsCompleted - a.lapsCompleted;
  }
  if (a.checkpointsPassedThisLap !== b.checkpointsPassedThisLap) {
    return b.checkpointsPassedThisLap - a.checkpointsPassedThisLap;
  }
  if (a.segmentProgress !== b.segmentProgress) {
    return b.segmentProgress - a.segmentProgress;
  }
  return a.sortOrder - b.sortOrder;
}

export function getRaceStandings() {
  const standings = [getRacerSnapshot("player")];
  if (aiOpponentsEnabled()) {
    getActiveAiCars().forEach((vehicle) => {
      const snapshot = getRacerSnapshot(vehicle.id);
      if (snapshot) standings.push(snapshot);
    });
  }
  const filteredStandings = standings.filter(Boolean);
  filteredStandings.sort(compareRaceSnapshots);
  return filteredStandings;
}

function getRacerDisplayName(racerKey) {
  if (racerKey === "player") {
    return String(state.playerName || "PLAYER").trim() || "PLAYER";
  }
  const aiState = getAiStateById(racerKey);
  if (!aiState) return String(racerKey || "RIVAL");
  return (
    String(
      aiState.vehicle?.label || getAiProfileByIndex(aiState.index).name,
    ).trim() || String(racerKey || "RIVAL")
  );
}

function racerIsHuman(racerKey) {
  if (racerKey === "player") return true;
  const aiState = getAiStateById(racerKey);
  if (!aiState) return false;
  return getAiProfileByIndex(aiState.index).kind === "remoteHuman";
}

function getRacerAccentColor(racerKey) {
  if (racerKey === "player") {
    return getCarColorHex(state.playerColor);
  }
  const aiState = getAiStateById(racerKey);
  if (!aiState) return "#f3f8ff";
  return getCarColorHex(getAiProfileByIndex(aiState.index).color);
}

export function getFinishCelebrationStandings() {
  const activeRivalCount = aiOpponentsEnabled()
    ? getActiveAiOpponentCount()
    : 0;
  const activeRivals = state.aiRoster.slice(0, activeRivalCount);
  const humanFieldCount =
    1 +
    activeRivals.reduce((count, entry) => {
      return entry?.kind === "remoteHuman" ? count + 1 : count;
    }, 0);
  const showHumanOnly = humanFieldCount > 1;
  const finishedStandings = getRaceStandings().filter(
    (entry) => entry.finished && entry.finishTime > 0,
  );
  const scopedStandings = showHumanOnly
    ? finishedStandings.filter((entry) => racerIsHuman(entry.id))
    : finishedStandings;

  return {
    mode: showHumanOnly ? "human" : "all",
    totalRacers: showHumanOnly ? humanFieldCount : 1 + activeRivalCount,
    finishedCount: scopedStandings.length,
    entries: scopedStandings.map((entry, index, list) => {
      const previous = list[index - 1] || null;
      const gapMs =
        previous && Number.isFinite(previous.finishTime)
          ? Math.max(
              0,
              Math.round(
                (Number(entry.finishTime) - Number(previous.finishTime)) * 1000,
              ),
            )
          : 0;
      return {
        id: entry.id,
        position: index + 1,
        label: getRacerDisplayName(entry.id),
        finishTime: entry.finishTime,
        gapMs,
        isPlayer: entry.id === "player",
        accentColor: getRacerAccentColor(entry.id),
      };
    }),
  };
}

export function buildFinishCelebrationStats({
  lapTimes = lapData.lapTimes,
  selectedTrack = trackOptions[state.selectedTrackIndex] || null,
} = {}) {
  const totalTime = lapTimes.reduce((sum, lapSeconds) => sum + lapSeconds, 0);
  const bestLapTime = lapTimes.length ? Math.min(...lapTimes) : 0;
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

  return {
    bestLap,
    bestRace,
    totalTime,
    bestLapTime,
    bestLapImprovementMs:
      bestLap && previousBestLapMs !== null
        ? previousBestLapMs - bestLapMs
        : null,
    bestRaceImprovementMs:
      bestRace && previousBestRaceMs !== null
        ? previousBestRaceMs - totalMs
        : null,
    previousBestLapMs,
    previousBestRaceMs,
    previousBestLapDisplayName:
      selectedTrack && typeof selectedTrack.bestLapDisplayName === "string"
        ? selectedTrack.bestLapDisplayName
        : null,
    previousBestRaceDisplayName:
      selectedTrack && typeof selectedTrack.bestRaceDisplayName === "string"
        ? selectedTrack.bestRaceDisplayName
        : null,
    confettiActive: bestLap || bestRace,
  };
}

export function getRacePosition(racerKey = "player") {
  const targetLapData =
    racerKey === "player" ? lapData : getAiStateById(racerKey)?.lapData;
  if (targetLapData?.finished && targetLapData.finalPosition > 0) {
    return targetLapData.finalPosition;
  }
  const standings = getRaceStandings();
  const index = standings.findIndex((entry) => entry.id === racerKey);
  return index >= 0 ? index + 1 : standings.length;
}

function anyAiStillRacing() {
  if (!aiOpponentsEnabled()) return false;
  return getActiveAiLapDataList().some((entry) => !entry.finished);
}

function raceClockShouldAdvance() {
  return !lapData.finished || anyAiStillRacing();
}

function progressDeltaForward(from, to) {
  return wrapProgress(to - from);
}

// Approximate equilibrium speed ratio on a surface relative to asphalt.
// At steady-state the car's speed is proportional to engineMul / longDragMul.
function surfaceSpeedRatio(surfaceName) {
  const surface =
    physicsConfig.surfaces[surfaceName] || physicsConfig.surfaces.asphalt;
  return surface.engineMul / Math.max(surface.longDragMul, 0.01);
}

// Estimate how long (in seconds) it takes to traverse the edge from→to,
// considering curvature-limited speed and surface slowdown.
function computeEdgeTimeCost(fromNode, toNode) {
  const dx = toNode.x - fromNode.x;
  const dy = toNode.y - fromNode.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-5) return 0;
  const maxSpeed = physicsConfig.ai.targetSpeedMax;
  // Average curvature-limited speed along the edge
  const curvatureSpeed =
    ((fromNode.baseTargetSpeed || maxSpeed) +
      (toNode.baseTargetSpeed || maxSpeed)) *
    0.5;
  // Surface speed limit — if the departure node is a spring the car will fly
  const fromRatio = fromNode.nearSpring
    ? 1
    : surfaceSpeedRatio(fromNode.surface || "asphalt");
  const toRatio = surfaceSpeedRatio(toNode.surface || "asphalt");
  const avgSurfaceRatio = (fromRatio + toRatio) * 0.5;
  const surfaceSpeed = maxSpeed * avgSurfaceRatio;
  // Effective speed is the lower of the curvature and surface limits
  const effectiveSpeed = Math.max(Math.min(curvatureSpeed, surfaceSpeed), 1);
  return distance / effectiveSpeed;
}

function estimateNavHeuristic(node, goalNodeIds, _graph) {
  if (!goalNodeIds.length) return 0;
  let bestDist = Infinity;
  for (const goalNodeId of goalNodeIds) {
    const goalNode = _graph.nodes[goalNodeId];
    if (!goalNode) continue;
    const dist = Math.hypot(goalNode.x - node.x, goalNode.y - node.y);
    if (dist < bestDist) bestDist = dist;
  }
  if (bestDist === Infinity) return 0;
  // Admissible: straight-line at the fastest possible speed
  return bestDist / Math.max(physicsConfig.ai.targetSpeedMax, 1);
}

function estimateRemainingGoalProgress(node, goalNodeIds, graph) {
  if (!node || !goalNodeIds.length || !Number.isFinite(node.progress)) {
    return 0;
  }
  let best = Infinity;
  for (const goalNodeId of goalNodeIds) {
    const goalNode = graph.nodes[goalNodeId];
    if (!goalNode || !Number.isFinite(goalNode.progress)) continue;
    best = Math.min(
      best,
      progressDeltaForward(node.progress, goalNode.progress),
    );
  }
  return best === Infinity ? 0 : best;
}

function estimateNavLapLength(graph) {
  const averageSegmentLength = Math.max(graph.averageSegmentLength || 0, 1);
  const segmentCount = Math.max(
    graph.progressCount || 0,
    graph.nodes.length || 0,
    1,
  );
  return averageSegmentLength * segmentCount;
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

  // Pre-compute goal progress range for checkpoint-skip rejection.
  let hasGoalProgress = false;
  const goalProgressValues = [];
  for (const goalNodeId of goalNodeIds) {
    const goalNode = graph.nodes[goalNodeId];
    if (goalNode && Number.isFinite(goalNode.progress)) {
      goalProgressValues.push(goalNode.progress);
      hasGoalProgress = true;
    }
  }

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
    const currentNode = graph.nodes[currentId];
    for (const edge of graph.edges[currentId]) {
      const neighborId = edge.to;
      if (closed[neighborId]) continue;
      const neighbor = graph.nodes[neighborId];

      // --- Checkpoint-skip rejection ---
      // A junction that jumps over the goal checkpoint in progress space is
      // rejected — the AI must actually reach the checkpoint, not skip it.
      if (
        hasGoalProgress &&
        edge.kind === "junction" &&
        Number.isFinite(currentNode.progress) &&
        Number.isFinite(neighbor.progress)
      ) {
        const fwd = wrapProgress(neighbor.progress - currentNode.progress);
        if (fwd > 0.04 && fwd < 0.96) {
          let skipsCheckpoint = false;
          for (const gp of goalProgressValues) {
            const goalFwd = wrapProgress(gp - currentNode.progress);
            if (goalFwd > 0.01 && goalFwd < fwd - 0.01) {
              skipsCheckpoint = true;
              break;
            }
          }
          if (skipsCheckpoint) continue;
        }
      }

      // --- Time-based edge cost ---
      const timeCost = computeEdgeTimeCost(currentNode, neighbor);

      // Backward edges incur a reversal penalty: the car must brake, turn
      // around, and re-accelerate.  Still much cheaper than a full lap.
      const reversalPenalty = edge.kind === "backward" ? 0.35 : 0;

      // Obstacle proximity penalty (safety concern, in time-equivalent units)
      const obstaclePenalty =
        ((currentNode.obstaclePenalty || 0) + (neighbor.obstaclePenalty || 0)) *
        0.001;

      // Dynamic player avoidance (mild — don't distort the optimal path)
      const playerDist = Math.hypot(neighbor.x - car.x, neighbor.y - car.y);
      const dynamicPenalty =
        playerDist >= aiCfg.playerAvoidanceRadius
          ? 0
          : (aiCfg.playerNodePenalty || 0) *
            0.003 *
            (1 - playerDist / Math.max(aiCfg.playerAvoidanceRadius, 1));

      const tentative =
        gScore[currentId] +
        timeCost +
        reversalPenalty +
        obstaclePenalty +
        dynamicPenalty;
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

function findReachableTrackNavPlan(
  graph,
  {
    x,
    y,
    progressHint = null,
    maxDistance = Infinity,
    goalNodeIds = [],
    fallbackGoalNodeIds = [],
  },
) {
  const candidates = [];
  for (const node of graph.nodes) {
    const distance = Math.hypot(node.x - x, node.y - y);
    if (distance > maxDistance) continue;
    if (!(graph.edges[node.id] || []).length) continue;
    let score = distance;
    if (progressHint !== null) {
      const progressDelta = progressDeltaForward(progressHint, node.progress);
      score += Math.min(progressDelta, 1 - progressDelta) * 90;
    }
    candidates.push({ node, score });
  }
  candidates.sort((a, b) => a.score - b.score);

  for (const candidate of candidates.slice(0, 24)) {
    let plannedNodeIds = goalNodeIds.length
      ? planTrackNavPath(graph, candidate.node.id, goalNodeIds)
      : [];
    if (!plannedNodeIds.length && fallbackGoalNodeIds.length) {
      plannedNodeIds = planTrackNavPath(
        graph,
        candidate.node.id,
        fallbackGoalNodeIds,
      );
    }
    if (plannedNodeIds.length) {
      return { node: candidate.node, plannedNodeIds };
    }
  }

  return null;
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
      if (edge.kind === "backward") continue;
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

  const nextCheckpointIndex =
    aiLapData.nextCheckpointIndex % checkpoints.length;
  const checkpointGoalNodeIds =
    graph.checkpointGoalNodeIds?.[nextCheckpointIndex] || [];
  const checkpointFallbackNodeIds =
    graph.checkpointNodeIds?.[nextCheckpointIndex] || [];

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
  if (!plannedNodeIds.length) {
    const fallbackPlan = findReachableTrackNavPlan(graph, {
      x: aiCar.x,
      y: aiCar.y,
      progressHint: aiPhysicsRuntime.progress,
      maxDistance: aiCfg.softResetSearchRadiusFallback,
      goalNodeIds: checkpointGoalNodeIds,
      fallbackGoalNodeIds: checkpointFallbackNodeIds,
    });
    if (fallbackPlan) {
      aiPhysicsRuntime.currentNodeId = fallbackPlan.node.id;
      plannedNodeIds = fallbackPlan.plannedNodeIds;
    }
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
  aiPhysicsRuntime.planCheckpointIndex = nextCheckpointIndex;
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
  // AI uses very fast input response (near-instant) — no human-like lag.
  const aiSmoothing = physicsConfig.ai.inputSmoothing;
  const response = clamp((1 - aiSmoothing) * dt * 60, 0, 1);
  const chase = (current, target) => current + (target - current) * response;
  aiPhysicsRuntime.input.throttle = chase(
    aiPhysicsRuntime.input.throttle,
    clamp(throttle, 0, 1),
  );
  aiPhysicsRuntime.input.brake = chase(
    aiPhysicsRuntime.input.brake,
    clamp(brake, 0, 1),
  );
  aiPhysicsRuntime.input.steer = chase(
    aiPhysicsRuntime.input.steer,
    clamp(steer, -1, 1),
  );
  aiPhysicsRuntime.input.handbrake = chase(
    aiPhysicsRuntime.input.handbrake,
    clamp(handbrake, 0, 1),
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
  const isFlying = vehicleIsFlying(aiCar);
  let penaltySurfaceCount = 0;
  const penaltySurfaceThreshold = Math.max(1, Math.floor(samples * 0.25));
  for (let step = 1; step <= samples; step++) {
    const t = step / samples;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    if (!isFlying && resolveObjectCollisions(x, y, 0).hit) return true;
    if (!isFlying) {
      const surface = surfaceAt(x, y);
      if (surface === "grass" || surface === "water") {
        penaltySurfaceCount += 1;
        if (penaltySurfaceCount >= penaltySurfaceThreshold) return true;
      }
    }
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
  let penaltySurfaceDistance = 0;
  const maxPenaltySurfaceDistance =
    aiCfg.maxPreviewPenaltySurfaceDistance || 30;
  let lastCleanX = anchorX;
  let lastCleanY = anchorY;
  let lastCleanNode = currentNode;
  let lastCleanSegmentIndex = segmentIndex;
  let penaltyCapped = false;

  while (
    segmentIndex < aiPhysicsRuntime.plannedNodeIds.length - 1 &&
    remainingDistance > 0 &&
    !penaltyCapped
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

    // Sample mid-segment surface to accumulate penalty distance.
    // Skip penalty accumulation if leaving from a spring node or car is flying.
    const midX = fromX + segDx * 0.5;
    const midY = fromY + segDy * 0.5;
    const midSurface = surfaceAt(midX, midY);
    const isPenalty = midSurface === "grass" || midSurface === "water";
    const springBypass = fromNode.nearSpring || vehicleIsFlying(aiCar);
    const segTravel = Math.min(remainingDistance, segLen);
    if (isPenalty && !springBypass) {
      penaltySurfaceDistance += segTravel;
      if (penaltySurfaceDistance > maxPenaltySurfaceDistance) {
        // Clamp to last clean point
        previewX = lastCleanX;
        previewY = lastCleanY;
        previewNode = lastCleanNode;
        segmentIndex = lastCleanSegmentIndex;
        penaltyCapped = true;
        break;
      }
    } else {
      lastCleanX = toNode.x;
      lastCleanY = toNode.y;
      lastCleanNode = toNode;
      lastCleanSegmentIndex = segmentIndex + 1;
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
  const profile = getActiveAiProfile();
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
    const offset =
      profile.style === "long" ? Number(profile.laneOffset) || 0 : 0;
    const rightX = -(preview.node?.tangentY ?? targetNode?.tangentY ?? 0);
    const rightY = preview.node?.tangentX ?? targetNode?.tangentX ?? 1;
    const offsetX = rightX * offset;
    const offsetY = rightY * offset;
    aiPhysicsRuntime.targetPoint = { x: preview.x, y: preview.y };
    return {
      ...(targetNode || {}),
      x: preview.x + offsetX,
      y: preview.y + offsetY,
      tangentX: preview.node?.tangentX ?? targetNode?.tangentX ?? 1,
      tangentY: preview.node?.tangentY ?? targetNode?.tangentY ?? 0,
      targetSpeed:
        preview.node?.targetSpeed ??
        targetNode?.targetSpeed ??
        physicsConfig.ai.targetSpeedMax,
    };
  }
  if (!targetNode) return null;
  const offset = profile.style === "long" ? Number(profile.laneOffset) || 0 : 0;
  const rightX = -(targetNode.tangentY ?? 0);
  const rightY = targetNode.tangentX ?? 1;
  return {
    ...targetNode,
    x: targetNode.x + rightX * offset,
    y: targetNode.y + rightY * offset,
  };
}

function computeAiTargetSpeed(graph) {
  if (!aiPhysicsRuntime.plannedNodeIds.length) {
    return physicsConfig.ai.targetSpeedMin;
  }
  const aiCfg = physicsConfig.ai;
  const brakeDecel = physicsConfig.car.brakeDecel;
  let targetSpeed = aiCfg.targetSpeedMax;
  const cursor = aiPhysicsRuntime.pathCursor;
  const endIndex = Math.min(
    aiPhysicsRuntime.plannedNodeIds.length - 1,
    cursor + aiCfg.targetSpeedLookAhead,
  );

  // Walk the planned path, computing actual turning angle at each node and
  // deriving speed limits from the path geometry — not from the centerline
  // curvature stored on each node.  On a straight planned path this gives
  // full speed even if the centerline is curved underneath.
  let cumulativeDistance = 0;
  let prevNode = graph.nodes[aiPhysicsRuntime.plannedNodeIds[cursor]];
  let prevDirX = Math.cos(aiCar.angle);
  let prevDirY = Math.sin(aiCar.angle);
  if (cursor > 0) {
    const behindNode = graph.nodes[aiPhysicsRuntime.plannedNodeIds[cursor - 1]];
    if (behindNode && prevNode) {
      const dx = prevNode.x - behindNode.x;
      const dy = prevNode.y - behindNode.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-4) {
        prevDirX = dx / len;
        prevDirY = dy / len;
      }
    }
  }

  for (let i = cursor; i <= endIndex; i++) {
    const node = graph.nodes[aiPhysicsRuntime.plannedNodeIds[i]];
    if (!node) continue;

    if (i > cursor && prevNode) {
      const segDx = node.x - prevNode.x;
      const segDy = node.y - prevNode.y;
      const segLen = Math.hypot(segDx, segDy);
      cumulativeDistance += segLen;

      if (segLen > 1e-4) {
        const dirX = segDx / segLen;
        const dirY = segDy / segLen;
        // Turning angle between consecutive segments
        const dot = prevDirX * dirX + prevDirY * dirY;
        const pathCurvature = Math.max(0, 1 - clamp(dot, -1, 1));
        // Also blend in a fraction of the node's centerline curvature
        // so the AI still respects tight centerline corners when the
        // planned path can't smooth them out.
        const effectiveCurvature = Math.max(
          pathCurvature,
          (node.curvature || 0) * 0.5,
        );
        const excessCurvature = Math.max(
          0,
          effectiveCurvature - aiCfg.fullThrottleCurvature,
        );
        const nodeSpeedLimit = clamp(
          aiCfg.targetSpeedMax -
            excessCurvature * aiCfg.curvatureSpeedScale +
            aiCfg.curvatureSpeedBias,
          aiCfg.cornerSpeedMin,
          aiCfg.targetSpeedMax,
        );

        // Physics-based braking: how fast can we be NOW and still slow
        // to nodeSpeedLimit by the time we reach this node?
        const allowedSpeed =
          cumulativeDistance <= 1
            ? nodeSpeedLimit
            : Math.sqrt(
                nodeSpeedLimit * nodeSpeedLimit +
                  2 * brakeDecel * aiCfg.brakingEfficiency * cumulativeDistance,
              );
        targetSpeed = Math.min(targetSpeed, allowedSpeed);

        prevDirX = dirX;
        prevDirY = dirY;
      }
    }
    prevNode = node;
  }

  const profile = getActiveAiProfile();
  aiPhysicsRuntime.desiredSpeed = clamp(
    targetSpeed * aiCfg.targetSpeedBias * (profile.topSpeedMul || 1),
    aiCfg.targetSpeedMin,
    aiCfg.targetSpeedMax,
  );
  return aiPhysicsRuntime.desiredSpeed;
}

function getNearestBlockingRival(forwardX, forwardY) {
  let bestDistance = Infinity;
  for (const rival of [car, ...getActiveAiCars()]) {
    if (rival === aiCar) continue;
    const dx = rival.x - aiCar.x;
    const dy = rival.y - aiCar.y;
    const forwardDistance = dx * forwardX + dy * forwardY;
    if (forwardDistance <= 0) continue;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) bestDistance = distance;
  }
  return bestDistance;
}

function getNearestRivalMetrics(forwardX, forwardY, rightX, rightY) {
  let best = null;
  for (const rival of [car, ...getActiveAiCars()]) {
    if (rival === aiCar) continue;
    const dx = rival.x - aiCar.x;
    const dy = rival.y - aiCar.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 1e-4) continue;
    const forwardDistance = dx * forwardX + dy * forwardY;
    const lateralDistance = dx * rightX + dy * rightY;
    const relVx = aiCar.vx - rival.vx;
    const relVy = aiCar.vy - rival.vy;
    const closingSpeed = (relVx * dx + relVy * dy) / distance;
    if (!best || distance < best.distance) {
      best = {
        rival,
        distance,
        forwardDistance,
        lateralDistance,
        closingSpeed,
      };
    }
  }
  return best;
}

function updateAiRaceControl(dt, graph) {
  const aiCfg = physicsConfig.ai;
  const profile = getActiveAiProfile();

  // Force immediate replan when the checkpoint advances — don't follow
  // the old plan's continuation nodes deeper into a loop we've already done.
  const currentCheckpointTarget =
    aiLapData.nextCheckpointIndex % checkpoints.length;
  const checkpointChanged =
    aiPhysicsRuntime.planCheckpointIndex !== undefined &&
    aiPhysicsRuntime.planCheckpointIndex !== currentCheckpointTarget;

  if (
    checkpointChanged ||
    !aiPhysicsRuntime.plannedNodeIds.length ||
    aiPhysicsRuntime.replanCooldown <= 0
  ) {
    buildAiPath(
      graph,
      checkpointChanged || !aiPhysicsRuntime.plannedNodeIds.length,
    );
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
  let steerTarget =
    headingError * physicsConfig.ai.steeringGain +
    lateralError * physicsConfig.ai.lateralErrorGain;
  steerTarget = clamp(steerTarget, -1, 1);

  const forwardSpeed = aiCar.vx * forwardX + aiCar.vy * forwardY;
  const targetSpeed = computeAiTargetSpeed(graph);
  let throttleTarget = 1;
  let brakeTarget = 0;
  const speedExcess = forwardSpeed - targetSpeed;
  if (speedExcess > aiCfg.lateBrakeMargin) {
    // Hard braking zone — proportional but sharp response
    brakeTarget = clamp(speedExcess / aiCfg.brakeRampRange, 0.15, 1);
    throttleTarget = brakeTarget > 0.15 ? 0 : 0.3;
  } else if (speedExcess > 0) {
    // Trail-braking zone: modulate throttle instead of braking
    throttleTarget = clamp(1 - speedExcess / aiCfg.lateBrakeMargin, 0.2, 1);
  }
  let handbrakeTarget = 0;
  if (
    Math.abs(headingError) > aiCfg.handbrakeHeadingThreshold &&
    Math.abs(forwardSpeed) > aiCfg.handbrakeSpeedThreshold
  ) {
    handbrakeTarget = clamp(
      (Math.abs(headingError) - aiCfg.handbrakeHeadingThreshold) / 0.45,
      0,
      0.5,
    );
    throttleTarget *= 0.9;
  }

  const rivalDistance = getNearestBlockingRival(forwardX, forwardY);
  if (
    rivalDistance < physicsConfig.ai.rivalAvoidanceRadius &&
    profile.style !== "bump"
  ) {
    brakeTarget = Math.max(
      brakeTarget,
      0.04 *
        (1 -
          rivalDistance / Math.max(physicsConfig.ai.rivalAvoidanceRadius, 1)),
    );
  }

  if (profile.style === "bump") {
    const rivalMetrics = getNearestRivalMetrics(
      forwardX,
      forwardY,
      rightX,
      rightY,
    );
    const closeThreat =
      rivalMetrics &&
      rivalMetrics.distance < 86 &&
      rivalMetrics.forwardDistance > -24 &&
      rivalMetrics.forwardDistance < 72 &&
      (Math.abs(rivalMetrics.lateralDistance) < 64 ||
        rivalMetrics.closingSpeed > 14);
    if (closeThreat) {
      steerTarget = clamp(
        steerTarget + clamp(rivalMetrics.lateralDistance / 26, -0.65, 0.65),
        -1,
        1,
      );
      throttleTarget = Math.max(throttleTarget, 0.82);
      brakeTarget *= 0.35;
      if (
        Math.abs(rivalMetrics.lateralDistance) > 10 &&
        Math.abs(forwardSpeed) > 95
      ) {
        handbrakeTarget = Math.max(handbrakeTarget, 0.14);
      }
    }
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
  const profile = getActiveAiProfile();
  const graph = getTrackNavigationGraph(track);
  const currentSurface = surfaceAt(aiCar.x, aiCar.y);
  aiPhysicsRuntime.targetLaneOffset =
    profile.style === "long" ? Number(profile.laneOffset) || 0 : 0;
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
  const isOffRoad = currentSurface === "grass" || currentSurface === "water";
  const isFlying = vehicleIsFlying(aiCar);

  if (
    aiCar.speed < aiCfg.stuckSpeedThreshold &&
    progressGain < aiCfg.stuckProgressThreshold &&
    !isFlying
  ) {
    aiPhysicsRuntime.lowProgressTimer += dt;
    // Off-road stalling compounds the stuck timer faster
    if (isOffRoad) {
      aiPhysicsRuntime.lowProgressTimer += dt * 0.5;
    }
  } else {
    aiPhysicsRuntime.lowProgressTimer = Math.max(
      0,
      aiPhysicsRuntime.lowProgressTimer - dt * 1.5,
    );
  }
  // Track off-road time only when far from the planned path (truly lost,
  // not an intentional shortcut the planner chose).
  if (isOffRoad && !isFlying) {
    const distanceToPlan = distanceToAiPlannedPath(graph);
    if (distanceToPlan > aiCfg.grassRecoveryPathDistance) {
      aiPhysicsRuntime.offRoadTimer += dt;
    } else {
      aiPhysicsRuntime.offRoadTimer = Math.max(
        0,
        aiPhysicsRuntime.offRoadTimer - dt * 2,
      );
    }
  } else {
    aiPhysicsRuntime.offRoadTimer = Math.max(
      0,
      aiPhysicsRuntime.offRoadTimer - dt * 3,
    );
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
    progressGain >= aiCfg.stuckProgressThreshold * 2 &&
    aiCar.speed >= aiCfg.stuckSpeedThreshold;
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

  // When the car is stuck but NOT wall-blocked, force a replan instead of
  // entering the reverse-forward recovery cycle.  The planner will find
  // the best path out (which may go across more grass).
  if (
    aiPhysicsRuntime.mode === "race" &&
    aiPhysicsRuntime.lowProgressTimer >= aiCfg.stuckTime &&
    aiPhysicsRuntime.repeatedCollisionTimer < aiCfg.repeatedCollisionTime
  ) {
    aiPhysicsRuntime.lowProgressTimer = 0;
    aiPhysicsRuntime.replanCooldown = 0;
    buildAiPath(getTrackNavigationGraph(track), true);
    return;
  }

  // Only the reverse-forward recovery triggers when repeatedly hitting a
  // wall — this is a genuinely stuck state that replanning can't fix.
  if (
    aiPhysicsRuntime.mode === "race" &&
    aiPhysicsRuntime.repeatedCollisionTimer >= aiCfg.repeatedCollisionTime
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
  const airCfg = physicsConfig.air;
  const surfaceName = surfaceAt(aiCar.x, aiCar.y);

  // --- Spring trigger (same as player) ---
  const spring = findSpringTrigger(aiCar.x, aiCar.y);
  if (spring && !vehicleIsFlying(aiCar)) {
    launchAiFromSpring();
  }

  // --- Airborne branch: simplified physics while flying ---
  if (vehicleIsFlying(aiCar)) {
    const headingX = Math.cos(aiCar.angle);
    const headingY = Math.sin(aiCar.angle);
    const headingForwardSpeed = aiCar.vx * headingX + aiCar.vy * headingY;
    let forwardSpeed = headingForwardSpeed;

    forwardSpeed +=
      carCfg.engineAccel *
      airCfg.throttleAccelMul *
      aiPhysicsRuntime.input.throttle *
      dt;
    forwardSpeed -=
      carCfg.brakeDecel *
      airCfg.brakeDecelMul *
      aiPhysicsRuntime.input.brake *
      dt;
    forwardSpeed *= Math.exp(-carCfg.longDrag * airCfg.longDragMul * dt);

    aiCar.vx = headingX * forwardSpeed;
    aiCar.vy = headingY * forwardSpeed;
    const collision = resolveObjectCollisions(
      aiCar.x + aiCar.vx * dt,
      aiCar.y + aiCar.vy * dt,
      aiCar.z || 0,
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
    }

    aiCar.speed = Math.hypot(aiCar.vx, aiCar.vy);
    aiCar.vz = (aiCar.vz || 0) - airCfg.gravity * dt;
    aiCar.z = (aiCar.z || 0) + aiCar.vz * dt;
    aiCar.airTime = (aiCar.airTime || 0) + dt;
    aiCar.visualScale = Math.min(
      1.32,
      1 + Math.max(aiCar.z, 0) * airCfg.visualScalePerMeter,
    );

    // Landing
    if (aiCar.z <= 0) {
      aiCar.z = 0;
      const landingImpact = clamp(Math.abs(aiCar.vz) / 8, 0, 1);
      if (
        aiCar.vz < -airCfg.minBounceVz &&
        aiPhysicsRuntime.landingBouncePending
      ) {
        aiCar.vz = Math.abs(aiCar.vz) * airCfg.bounceRestitution;
        aiCar.airborne = true;
        aiCar.airTime += 0.01;
        aiPhysicsRuntime.landingBouncePending = false;
        aiPhysicsRuntime.wheelLastPoints = null;
      } else {
        aiCar.vz = 0;
        aiCar.airborne = false;
        aiCar.airTime = 0;
        aiCar.visualScale = 1;
        aiPhysicsRuntime.landingBouncePending = false;
        aiPhysicsRuntime.lastGroundedSpeed = aiCar.speed;
        aiPhysicsRuntime.wheelLastPoints = null;
        if (surfaceName === "grass") aiPhysicsRuntime.collisionGripTimer = 0.04;
      }
      if (landingImpact > 0.08) {
        emitLandingMarks(surfaceName, landingImpact, aiCar);
      }
    }

    const aiHeadingForwardSpeed = aiCar.vx * headingX + aiCar.vy * headingY;
    const prevForward = aiPhysicsRuntime.prevForwardSpeed;
    const longAccel =
      prevForward === null || dt <= 0
        ? 0
        : (aiHeadingForwardSpeed - prevForward) / dt;
    aiPhysicsRuntime.prevForwardSpeed = aiHeadingForwardSpeed;
    updateAiProgressHealth(dt, collision);
    return;
  }

  // --- Grounded physics (existing code) ---
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
    aiCar.z || 0,
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
  if (!checkpoints.length) return;
  const { blink = false, onFinish = null, racerKey = "player" } = options;
  const startCheckpointIndex = getStartCheckpointIndex();
  const targetIndex = targetLapData.nextCheckpointIndex % checkpoints.length;
  const cp = checkpoints[targetIndex];
  const frame = checkpointFrame(cp, track);
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

  // Reset checkpoint set and advance to next lap's first checkpoint,
  // keeping the car cycling through checkpoints even after finishing.
  targetLapData.passed = new Set([startCheckpointIndex]);
  targetLapData.nextCheckpointIndex =
    (startCheckpointIndex + 1) % checkpoints.length;

  // After the race is finished, keep cycling but don't record times or advance laps.
  if (targetLapData.finished) return;

  targetLapData.lapTimes.push(lapTime);
  targetLapData.currentLapStart = state.raceTime;
  targetLapData.lap += 1;

  if (targetLapData.lap > targetLapData.maxLaps) {
    targetLapData.finished = true;
    targetLapData.finishTime = state.raceTime;
    targetLapData.finalPosition = recordRaceFinish(racerKey);
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
  if (vehicleIsFlying(vehicle)) return;

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
    surfaceName === "water" ? clamp((vehicle.speed - 30) / 115, 0, 1) : 0;
  if (waterStrength > 0.03 && emitters.splashCooldown <= 0) {
    const travelAngle = Math.atan2(vehicle.vy, vehicle.vx);
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
    surfaceName === "grass" ? clamp((vehicle.speed - 42) / 120, 0, 1) : 0;
  if (grassStrength > 0.02 && emitters.dustCooldown <= 0) {
    const travelAngle = Math.atan2(vehicle.vy, vehicle.vx);
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
    const mark = {
      x1: lastPoints[i].x,
      y1: lastPoints[i].y,
      x2: points[i].x,
      y2: points[i].y,
      color,
      width,
    };
    skidMarks.push(mark);
    if (state.tournamentRoom.active) {
      state.tournamentRoom.pendingSkidMarks.push({ ...mark });
    }
  }
}

function emitLandingMarks(surfaceName, impact, vehicle = car) {
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
  const forwardX = Math.cos(vehicle.angle);
  const forwardY = Math.sin(vehicle.angle);
  const markLength = 4 + clamp(impact, 0, 1) * 7;
  const wheelPoints = wheelWorldPoints(vehicle);

  for (const point of wheelPoints) {
    const mark = {
      x1: point.x - forwardX * markLength,
      y1: point.y - forwardY * markLength,
      x2: point.x,
      y2: point.y,
      color,
      width,
    };
    skidMarks.push(mark);
    if (state.tournamentRoom.active) {
      state.tournamentRoom.pendingSkidMarks.push({ ...mark });
    }
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
  if (aiOpponentIndex !== 0) return;
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

function launchAiFromSpring() {
  const airCfg = physicsConfig.air;
  const speedRatio = clamp(
    aiCar.speed / Math.max(physicsConfig.car.maxSpeed, 1),
    0,
    1,
  );
  const apexHeight = Math.min(airCfg.maxJumpHeight, 1.8 + speedRatio * 1.2);
  aiCar.airborne = true;
  aiCar.airTime = 0;
  aiCar.z = Math.max(aiCar.z || 0, 0.02);
  aiCar.vz = Math.sqrt(2 * airCfg.gravity * apexHeight);
  aiCar.visualScale = 1 + aiCar.z * airCfg.visualScalePerMeter;
  aiPhysicsRuntime.landingBouncePending = true;
  aiPhysicsRuntime.lastGroundedSpeed = aiCar.speed;
  aiPhysicsRuntime.wheelLastPoints = null;
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
  physicsRuntime.debug.vForward = forwardSpeed;
  physicsRuntime.debug.vLateral = 0;
  physicsRuntime.debug.z = car.z;
  physicsRuntime.debug.vz = car.vz;
  physicsRuntime.debug.pivotX = car.x;
  physicsRuntime.debug.pivotY = car.y;

  resolveLanding(surfaceName);
  const effectiveSurfaceName = getVehicleSurfaceAt(car, surfaceName);
  physicsRuntime.debug.surface = effectiveSurfaceName;

  const prevForward = physicsRuntime.prevForwardSpeed;
  const longAccel =
    prevForward === null || dt <= 0 ? 0 : (forwardSpeed - prevForward) / dt;
  physicsRuntime.prevForwardSpeed = forwardSpeed;
  updateVehicleAudioState({
    surfaceName: effectiveSurfaceName,
    headingForwardSpeed: forwardSpeed,
    headingLateralSpeed: 0,
    longAccel,
  });
}

function resetAiOpponentForRace(
  index,
  spawnPoint,
  headingAngle,
  startCheckpoint,
) {
  withAiOpponent(index, () => {
    const profile = getAiProfileByIndex(index);
    const forwardX = Math.cos(headingAngle);
    const forwardY = Math.sin(headingAngle);
    const rightX = -forwardY;
    const rightY = forwardX;
    const gridSlots = [
      { back: 38, side: 20 },
      { back: 38, side: -20 },
      { back: 76, side: 20 },
      { back: 76, side: -20 },
      { back: 114, side: 0 },
    ];
    const slot = gridSlots[index] || {
      back: 38 + index * 34,
      side: index % 2 === 0 ? 18 : -18,
    };
    aiCar.x = spawnPoint.x - forwardX * slot.back + rightX * slot.side;
    aiCar.y = spawnPoint.y - forwardY * slot.back + rightY * slot.side;
    aiCar.vx = 0;
    aiCar.vy = 0;
    aiCar.angle = headingAngle;
    aiCar.speed = 0;
    aiCar.z = 0;
    aiCar.vz = 0;
    aiCar.airborne = false;
    aiCar.airTime = 0;
    aiCar.visualScale = 1;
    resetLapProgress(aiLapData, startCheckpoint);
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
    aiPhysicsRuntime.targetLaneOffset =
      profile.style === "long" ? Number(profile.laneOffset) || 0 : 0;
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
    if (!profile.externalControl && profile.kind === "ai") {
      primeAiRaceStartPlan();
    }
  });
}

export function resetRace() {
  // Reset the runtime track state to the selected preset so transient race-time
  // mutations do not leak into the next start.
  applyTrackPreset(state.selectedTrackIndex);
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
  state.raceStandings.finishOrders = { player: 0 };
  getActiveAiCars().forEach((vehicle) => {
    state.raceStandings.finishOrders[vehicle.id] = 0;
  });
  const startCheckpointIndex = getStartCheckpointIndex();
  resetLapProgress(lapData, startCheckpointIndex);
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
  forEachAiOpponent((_, __, ___, index) => {
    resetAiOpponentForRace(index, spawnPoint, car.angle, startCheckpointIndex);
  });
  skidMarks.length = 0;
  state.tournamentRoom.pendingSkidMarks.length = 0;
  resetParticles();
  state.finishCelebration.bestLap = false;
  state.finishCelebration.bestRace = false;
  state.finishCelebration.totalTime = 0;
  state.finishCelebration.bestLapTime = 0;
  state.finishCelebration.bestLapImprovementMs = null;
  state.finishCelebration.bestRaceImprovementMs = null;
  state.finishCelebration.previousBestLapMs = null;
  state.finishCelebration.previousBestRaceMs = null;
  state.finishCelebration.previousBestLapDisplayName = null;
  state.finishCelebration.previousBestRaceDisplayName = null;
  state.finishCelebration.confettiActive = false;
}

export function clearRaceInputs() {
  keys.accel = false;
  keys.brake = false;
  keys.left = false;
  keys.right = false;
  keys.handbrake = false;
}

function resetRivalAudioState() {
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

function resolveRaceFieldCollisions() {
  const field = [
    { vehicle: car, runtime: physicsRuntime },
    ...getActiveAiCars().map((vehicle, index) => ({
      vehicle,
      runtime: aiPhysicsRuntimes[index],
      externalControl: rivalUsesExternalControl(index),
    })),
  ];
  for (let i = 0; i < field.length - 1; i++) {
    for (let j = i + 1; j < field.length; j++) {
      if (field[i].externalControl || field[j].externalControl) continue;
      if (!resolveCarToCarCollision(field[i].vehicle, field[j].vehicle)) {
        continue;
      }
      field[i].runtime.collisionGripTimer = Math.max(
        field[i].runtime.collisionGripTimer,
        0.06,
      );
      field[j].runtime.collisionGripTimer = Math.max(
        field[j].runtime.collisionGripTimer,
        0.06,
      );
    }
  }
}

function updateAiField(dt) {
  if (!aiOpponentsEnabled()) {
    resetRivalAudioState();
    return;
  }
  forEachAiOpponent((_, __, ___, index) => {
    if (rivalUsesExternalControl(index)) return;
    updateAiControl(dt);
    updateAiVehicle(dt);
  });
  resolveRaceFieldCollisions();
}

function updateAiCheckpointProgress() {
  if (!aiOpponentsEnabled()) return;
  forEachAiOpponent((_, __, ___, index) => {
    if (rivalUsesExternalControl(index)) return;
    checkCheckpointProgress(aiCar, aiLapData, {
      blink: false,
      racerKey: aiCar.id,
    });
  });
}

export function applyExternalRivalState(index, payload = {}) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= getActiveAiOpponentCount()
  ) {
    return;
  }
  withAiOpponent(index, () => {
    aiCar.x = Number.isFinite(payload.x) ? Number(payload.x) : aiCar.x;
    aiCar.y = Number.isFinite(payload.y) ? Number(payload.y) : aiCar.y;
    aiCar.vx = Number.isFinite(payload.vx) ? Number(payload.vx) : aiCar.vx;
    aiCar.vy = Number.isFinite(payload.vy) ? Number(payload.vy) : aiCar.vy;
    aiCar.angle = Number.isFinite(payload.angle)
      ? Number(payload.angle)
      : aiCar.angle;
    aiCar.speed = Number.isFinite(payload.speed)
      ? Number(payload.speed)
      : aiCar.speed;
    aiCar.z = Number.isFinite(payload.z) ? Number(payload.z) : aiCar.z;
    aiCar.vz = Number.isFinite(payload.vz) ? Number(payload.vz) : aiCar.vz;
    aiCar.airborne = Boolean(payload.airborne);
    aiCar.airTime = Number.isFinite(payload.airTime)
      ? Number(payload.airTime)
      : 0;
    aiCar.visualScale = Number.isFinite(payload.visualScale)
      ? Number(payload.visualScale)
      : 1;
    aiPhysicsRuntime.input = {
      ...aiPhysicsRuntime.input,
      ...(payload.input && typeof payload.input === "object"
        ? payload.input
        : {}),
    };
    applyLapSnapshot(aiLapData, payload);
    if (aiLapData.finished) {
      const finalPosition = Number.isInteger(payload.finalPosition)
        ? Math.max(0, payload.finalPosition)
        : 0;
      if (finalPosition > 0) {
        aiLapData.finalPosition = finalPosition;
        state.raceStandings.finishOrders[aiCar.id] = finalPosition;
        state.raceStandings.nextFinishOrder = Math.max(
          state.raceStandings.nextFinishOrder,
          finalPosition + 1,
        );
      }
    }
  });
}

export function getRivalPhysicsSnapshot(index) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= getActiveAiOpponentCount()
  ) {
    return null;
  }
  return withAiOpponent(index, () => ({
    x: aiCar.x,
    y: aiCar.y,
    vx: aiCar.vx,
    vy: aiCar.vy,
    angle: aiCar.angle,
    speed: aiCar.speed,
    z: aiCar.z,
    vz: aiCar.vz,
    airborne: aiCar.airborne,
    airTime: aiCar.airTime,
    visualScale: aiCar.visualScale,
    lap: aiLapData.lap,
    maxLaps: aiLapData.maxLaps,
    lapTimes: [...aiLapData.lapTimes],
    passed: [...aiLapData.passed],
    nextCheckpointIndex: aiLapData.nextCheckpointIndex,
    finished: aiLapData.finished,
    finishTime: aiLapData.finishTime,
    finalPosition: aiLapData.finalPosition,
    input: { ...aiPhysicsRuntime.input },
  }));
}

export function getExternalHumanRivalCount() {
  return state.aiRoster.reduce((count, _entry, index) => {
    if (!rivalIsRemoteHuman(index) || !rivalUsesExternalControl(index))
      return count;
    return aiLapDataList[index].finished ? count : count + 1;
  }, 0);
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

  const groundSurfaceName = surfaceAt(car.x, car.y);
  const surfaceName = getVehicleSurfaceAt(car, groundSurfaceName);

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
      airborne: vehicleIsFlying(car),
      airborneAmount: clamp(car.z / Math.max(airCfg.maxJumpHeight, 1), 0, 1),
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

  if (raceClockShouldAdvance()) {
    state.raceTime += dt;
  }
  if (state.checkpointBlink.time > 0) {
    state.checkpointBlink.time = Math.max(0, state.checkpointBlink.time - dt);
  }

  const targetSurface =
    physicsConfig.surfaces[groundSurfaceName] || physicsConfig.surfaces.asphalt;

  const throttleTarget = keys.accel ? 1 : 0;
  const brakeTarget = keys.brake ? 1 : 0;
  const steerTarget = vehicleIsFlying(car)
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

  if (vehicleIsFlying(car)) {
    integrateAirborneMotion(dt, groundSurfaceName);
    updateAiField(dt);
    if (!lapData.finished) {
      checkCheckpointProgress(car, lapData, {
        blink: true,
        racerKey: "player",
        onFinish: () => {
          state.finished = true;
          finalizeFinishCelebration();
        },
      });
    }
    updateAiCheckpointProgress();
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
  const allowAutoDrift = groundSurfaceName !== "grass";
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
  physicsRuntime.debug.surface = getVehicleSurfaceAt(car, groundSurfaceName);
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
  if (spring && !vehicleIsFlying(car)) {
    launchFromSpring();
  }
  const skidSurface = surfaceAt(car.x, car.y);
  const effectiveSurfaceName = getVehicleSurfaceAt(car, skidSurface);
  physicsRuntime.debug.surface = effectiveSurfaceName;
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
    surfaceName: effectiveSurfaceName,
    headingForwardSpeed,
    headingLateralSpeed,
    longAccel,
  });

  updateAiField(dt);

  if (!lapData.finished) {
    checkCheckpointProgress(car, lapData, {
      blink: true,
      racerKey: "player",
      onFinish: () => {
        state.finished = true;
        finalizeFinishCelebration();
      },
    });
  }
  updateAiCheckpointProgress();

  if (
    state.finished &&
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
  const summary = buildFinishCelebrationStats();
  Object.assign(state.finishCelebration, summary);

  if (summary.bestLap || summary.bestRace) {
    emitFinishConfetti({
      bestLap: summary.bestLap,
      bestRace: summary.bestRace,
    });
  }
}

import {
  applyTrackPreset,
  importTrackPresetData,
  savePlayerColor,
  sanitizePlayerName,
  sanitizeCarColor,
  trackOptions,
} from "./parameters.js";
import {
  createTournamentRoom,
  fetchTournamentRoom,
  joinTournamentRoom,
} from "./api.js";
import {
  assignAiRoster,
  assignRandomAiRoster,
  car,
  lapData,
  physicsRuntime,
  setCurbSegments,
  skidMarks,
  state,
} from "./state.js";
import {
  applyExternalRivalState,
  getExternalHumanRivalCount,
  getRivalPhysicsSnapshot,
  resetRace,
} from "./physics.js";
import { showSnackbar } from "./snackbar.js";
import { initCurbSegments } from "./track.js";
import { syncMenuMusicForMode } from "./audio.js";

const ROOM_SESSION_STORAGE_KEY = "carun.tournamentRoomSessions";
const ROOM_STATE_SEND_INTERVAL = 0.05;

let roomSocket = null;

function sanitizeRoomPlayerName(value) {
  const raw = sanitizePlayerName(value || "");
  return raw || "PLAYER";
}

function roomPath(roomId) {
  return `/tournament/${encodeURIComponent(roomId)}`;
}

function replaceAppUrl(pathname) {
  const url = new URL(window.location.href);
  url.pathname = pathname;
  url.searchParams.delete("track");
  window.history.replaceState(
    {},
    "",
    `${url.pathname}${url.search ? url.search : ""}${url.hash}`,
  );
}

function loadRoomSessions() {
  try {
    const raw = sessionStorage.getItem(ROOM_SESSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveRoomSession(roomId, participantId) {
  try {
    const sessions = loadRoomSessions();
    sessions[roomId] = participantId;
    sessionStorage.setItem(ROOM_SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Ignore storage failures.
  }
}

function loadRoomSession(roomId) {
  const sessions = loadRoomSessions();
  return typeof sessions[roomId] === "string" ? sessions[roomId] : null;
}

function removeRoomSession(roomId) {
  try {
    const sessions = loadRoomSessions();
    delete sessions[roomId];
    sessionStorage.setItem(ROOM_SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Ignore storage failures.
  }
}

function roomIsActive() {
  return Boolean(state.tournamentRoom.active && state.tournamentRoom.roomId);
}

function localRoomSlot() {
  return (
    state.tournamentRoom.slots.find(
      (slot) => slot.slot_id === state.tournamentRoom.localSlotId,
    ) || null
  );
}

function rivalRoomSlots() {
  const localSlotId = state.tournamentRoom.localSlotId;
  return state.tournamentRoom.slots.filter(
    (slot) => slot.slot_id !== localSlotId,
  );
}

function rivalIndexBySlotId(slotId) {
  if (typeof slotId !== "string" || !slotId) return -1;
  return rivalRoomSlots().findIndex((slot) => slot.slot_id === slotId);
}

function syncRoomTracks(room) {
  if (!room || !Array.isArray(room.tracks)) return;
  room.tracks.forEach((roomTrack) => {
    if (!roomTrack || typeof roomTrack !== "object") return;
    importTrackPresetData(
      {
        ...(roomTrack.track_payload_json || {}),
        id: roomTrack.id,
        name: roomTrack.name,
        source: "room",
        fromDb: false,
        canDelete: false,
      },
      { persist: false },
    );
  });

  state.tournament.trackOrder = room.tracks
    .map((roomTrack) =>
      trackOptions.findIndex(
        (preset) =>
          String(preset.id).toLowerCase() ===
          String(roomTrack.id).toLowerCase(),
      ),
    )
    .filter((index) => index >= 0);
}

function syncRoomRoster(room) {
  state.tournamentRoom.slots = Array.isArray(room?.slots)
    ? [...room.slots]
    : [];
  const localParticipantId = state.tournamentRoom.participantId;
  const localSlot = state.tournamentRoom.slots.find(
    (slot) => slot.participant_id === localParticipantId,
  );
  state.tournamentRoom.localSlotId = localSlot?.slot_id || null;
  state.tournamentRoom.isHost = Boolean(localSlot?.is_host);

  const localName = sanitizeRoomPlayerName(
    localSlot?.display_name || state.playerName,
  );
  state.playerName = localName;
  state.playerColor = sanitizeCarColor(localSlot?.color, state.playerColor);
  savePlayerColor(state.playerColor);

  const rivals = rivalRoomSlots().map((slot) => ({
    name: slot.display_name,
    style: slot.kind === "ai" ? slot.style || "precise" : "precise",
    color: slot.color,
    topSpeedMul:
      slot.kind === "ai" && Number.isFinite(slot.top_speed_mul)
        ? Number(slot.top_speed_mul)
        : 1,
    laneOffset:
      slot.kind === "ai" && Number.isFinite(slot.lane_offset)
        ? Number(slot.lane_offset)
        : 0,
    kind: slot.kind === "human" ? "remoteHuman" : "ai",
    participantId: slot.participant_id || null,
    slotId: slot.slot_id,
    connected: slot.connected !== false,
    externalControl: slot.kind === "human" || !state.tournamentRoom.isHost,
  }));
  assignAiRoster(rivals);
}

function syncTournamentStateFromRoom(room) {
  state.tournamentRoom.phase = room.phase || "lobby";
  state.tournamentRoom.paused = Boolean(room.paused);
  state.tournamentRoom.pausedBy =
    typeof room.paused_by === "string" ? room.paused_by : null;
  state.tournamentRoom.currentRaceIndex = Number(room.current_race_index) || 0;
  state.tournamentRoom.scores =
    room && typeof room.scores === "object" ? { ...room.scores } : {};
  state.tournamentRoom.raceResults = Array.isArray(room.race_results)
    ? [...room.race_results]
    : [];
  state.tournament.currentRaceIndex = state.tournamentRoom.currentRaceIndex;
  state.tournament.scores = { ...state.tournamentRoom.scores };
  state.tournament.raceResults = [...state.tournamentRoom.raceResults];
}

function currentRoomTrackIndex() {
  const raceIndex = state.tournament.currentRaceIndex;
  return state.tournament.trackOrder[raceIndex] ?? state.selectedTrackIndex;
}

function startRoomRaceLocally() {
  const trackIndex = currentRoomTrackIndex();
  if (
    !Number.isInteger(trackIndex) ||
    trackIndex < 0 ||
    trackIndex >= trackOptions.length
  ) {
    return;
  }
  state.selectedTrackIndex = trackIndex;
  applyTrackPreset(trackIndex);
  setCurbSegments(initCurbSegments());
  state.raceReturn.mode = "trackSelect";
  state.raceReturn.editorTrackIndex = null;
  state.mode = "racing";
  syncMenuMusicForMode(state.mode);
  resetRace();
}

function applyRoomSnapshot(room) {
  if (!room || typeof room !== "object") return;
  state.tournamentRoom.active = true;
  state.tournamentRoom.roomId = room.id || state.tournamentRoom.roomId;
  state.tournamentRoom.status = roomSocket ? "connected" : "joining";
  syncRoomTracks(room);
  syncTournamentStateFromRoom(room);
  syncRoomRoster(room);

  if (room.phase === "racing") {
    if (state.mode !== "racing") startRoomRaceLocally();
    state.paused = state.tournamentRoom.paused;
    if (!state.paused) state.pauseMenuIndex = 0;
  } else if (room.phase === "standings") {
    state.paused = false;
    state.mode = "tournamentStandings";
    syncMenuMusicForMode(state.mode);
  } else if (room.phase === "final") {
    state.paused = false;
    state.mode = "tournamentFinal";
    syncMenuMusicForMode(state.mode);
  } else {
    state.paused = false;
    state.mode = "tournamentLobby";
    state.tournamentLobbyIndex = state.tournamentRoom.slots.length;
    if (state.tournamentRoom.isHost) {
      state.tournamentLobbyIndex += 1;
    }
    syncMenuMusicForMode(state.mode);
  }
}

function socketUrl(roomId, participantId) {
  const url = new URL(window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/tournaments/${encodeURIComponent(roomId)}/ws`;
  url.search = `participant_id=${encodeURIComponent(participantId)}`;
  url.hash = "";
  return url.toString();
}

function closeRoomSocket() {
  if (!roomSocket) return;
  roomSocket.close();
  roomSocket = null;
}

function onRoomSocketMessage(message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "room_snapshot" && message.room) {
    applyRoomSnapshot(message.room);
    return;
  }
  if (message.type === "player_state") {
    const rivalIndex = rivalIndexBySlotId(message.slot_id);
    if (rivalIndex >= 0) applyExternalRivalState(rivalIndex, message.payload);
    return;
  }
  if (message.type === "ai_state" && Array.isArray(message.payload)) {
    message.payload.forEach((entry) => {
      const rivalIndex = rivalIndexBySlotId(entry?.slot_id || "");
      if (rivalIndex >= 0) applyExternalRivalState(rivalIndex, entry.payload);
    });
    return;
  }
  if (message.type === "skid_marks" && Array.isArray(message.payload)) {
    message.payload.forEach((mark) => {
      if (!mark || typeof mark !== "object") return;
      if (
        !Number.isFinite(mark.x1) ||
        !Number.isFinite(mark.y1) ||
        !Number.isFinite(mark.x2) ||
        !Number.isFinite(mark.y2) ||
        !Number.isFinite(mark.width)
      ) {
        return;
      }
      skidMarks.push({
        x1: Number(mark.x1),
        y1: Number(mark.y1),
        x2: Number(mark.x2),
        y2: Number(mark.y2),
        width: Number(mark.width),
        color:
          typeof mark.color === "string"
            ? mark.color
            : "rgba(20, 20, 20, 0.37)",
      });
    });
  }
}

function connectRoomSocket(roomId, participantId) {
  closeRoomSocket();
  state.tournamentRoom.status = "connecting";
  roomSocket = new WebSocket(socketUrl(roomId, participantId));
  roomSocket.addEventListener("open", () => {
    state.tournamentRoom.status = "connected";
  });
  roomSocket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      onRoomSocketMessage(payload);
    } catch {
      // Ignore malformed room messages.
    }
  });
  roomSocket.addEventListener("close", () => {
    state.tournamentRoom.status = roomIsActive() ? "disconnected" : "idle";
    roomSocket = null;
  });
  roomSocket.addEventListener("error", () => {
    state.tournamentRoom.status = "disconnected";
  });
}

function sendRoomMessage(payload) {
  if (!roomSocket || roomSocket.readyState !== WebSocket.OPEN) return;
  roomSocket.send(JSON.stringify(payload));
}

function buildRoomTracksPayload(trackIndices) {
  return trackIndices
    .map((index) => trackOptions[index])
    .filter(Boolean)
    .map((trackDef) => ({
      id: trackDef.id,
      name: trackDef.name,
      track_payload_json: {
        id: trackDef.id,
        name: trackDef.name,
        track: trackDef.track,
        checkpoints: trackDef.checkpoints,
        worldObjects: trackDef.worldObjects,
        centerlineStrokes: trackDef.centerlineStrokes,
        editStack: trackDef.editStack,
      },
    }));
}

function buildAiRosterPayload() {
  return state.aiRoster.map((entry) => ({
    name: entry.name,
    style: entry.style,
    color: entry.color,
    top_speed_mul: entry.topSpeedMul,
    lane_offset: entry.laneOffset,
  }));
}

function buildLocalPlayerPayload() {
  return {
    x: car.x,
    y: car.y,
    vx: car.vx,
    vy: car.vy,
    angle: car.angle,
    speed: car.speed,
    z: car.z,
    vz: car.vz,
    airborne: car.airborne,
    airTime: car.airTime,
    visualScale: car.visualScale,
    lap: lapData.lap,
    maxLaps: lapData.maxLaps,
    lapTimes: [...lapData.lapTimes],
    passed: [...lapData.passed],
    nextCheckpointIndex: lapData.nextCheckpointIndex,
    finished: lapData.finished,
    finishTime: lapData.finishTime,
    finalPosition: lapData.finalPosition,
    input: { ...physicsRuntime.input },
  };
}

function buildHostAiPayload() {
  return state.aiRoster
    .map((entry, index) => {
      if (entry.kind !== "ai" || entry.externalControl) return null;
      return {
        slot_id: entry.slotId,
        payload: getRivalPhysicsSnapshot(index),
      };
    })
    .filter(Boolean);
}

export function tournamentRoomActive() {
  return roomIsActive();
}

export function tournamentRoomShareUrl() {
  if (!state.tournamentRoom.roomId) return "";
  return `${window.location.origin}${roomPath(state.tournamentRoom.roomId)}`;
}

export async function copyTournamentRoomUrl() {
  const shareUrl = tournamentRoomShareUrl();
  if (!shareUrl) return;
  try {
    await navigator.clipboard.writeText(shareUrl);
    showSnackbar("Tournament URL copied", { seconds: 1.8, kind: "success" });
  } catch {
    showSnackbar(shareUrl, { seconds: 2.6, kind: "info" });
  }
}

export function leaveTournamentRoom({ resetUrl = true } = {}) {
  closeRoomSocket();
  if (state.tournamentRoom.roomId)
    removeRoomSession(state.tournamentRoom.roomId);
  state.tournamentRoom.active = false;
  state.tournamentRoom.roomId = null;
  state.tournamentRoom.participantId = null;
  state.tournamentRoom.localSlotId = null;
  state.tournamentRoom.isHost = false;
  state.tournamentRoom.phase = "lobby";
  state.tournamentRoom.paused = false;
  state.tournamentRoom.pausedBy = null;
  state.tournamentRoom.status = "idle";
  state.tournamentRoom.tracks = [];
  state.tournamentRoom.slots = [];
  state.tournamentRoom.lastPlayerStateAt = 0;
  state.tournamentRoom.lastAiStateAt = 0;
  state.tournamentRoom.pendingSkidMarks = [];
  state.tournamentRoom.scores = {};
  state.tournamentRoom.raceResults = [];
  state.tournamentRoom.currentRaceIndex = 0;
  state.tournamentRoom.remoteStates = {};
  if (resetUrl) replaceAppUrl("/tracks");
}

export async function createHostedTournamentRoom() {
  const indices = Array.from(state.tournament.selectedTrackIndices);
  if (indices.length === 0) return false;
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  state.tournament.trackOrder = indices;
  state.tournament.currentRaceIndex = 0;
  state.tournament.scores = {};
  state.tournament.raceResults = [];
  assignRandomAiRoster();

  const response = await createTournamentRoom({
    display_name: sanitizeRoomPlayerName(state.playerName),
    player_color: state.playerColor,
    tracks: buildRoomTracksPayload(indices),
    ai_roster: buildAiRosterPayload(),
  });
  state.tournamentRoom.participantId = response.participant_id;
  saveRoomSession(response.room.id, response.participant_id);
  replaceAppUrl(roomPath(response.room.id));
  applyRoomSnapshot(response.room);
  connectRoomSocket(response.room.id, response.participant_id);
  return true;
}

export async function joinTournamentRoomFromPath(roomId) {
  const existingParticipantId = loadRoomSession(roomId);
  const response = await joinTournamentRoom(roomId, {
    display_name: sanitizeRoomPlayerName(state.playerName),
    player_color: state.playerColor,
    participant_id: existingParticipantId,
  });
  state.tournamentRoom.participantId = response.participant_id;
  saveRoomSession(roomId, response.participant_id);
  replaceAppUrl(roomPath(roomId));
  applyRoomSnapshot(response.room);
  connectRoomSocket(roomId, response.participant_id);
}

export async function loadTournamentRoomFromPath(roomId) {
  const snapshot = await fetchTournamentRoom(roomId);
  state.tournamentRoom.roomId = snapshot.id;
  state.tournamentRoom.tracks = Array.isArray(snapshot.tracks)
    ? [...snapshot.tracks]
    : [];
  await joinTournamentRoomFromPath(roomId);
}

export function syncTournamentRoomSnapshot(phase) {
  if (!roomIsActive() || !state.tournamentRoom.isHost) return;
  sendRoomMessage({
    type: "room_sync",
    phase,
    current_race_index: state.tournament.currentRaceIndex,
    scores: state.tournament.scores,
    race_results: state.tournament.raceResults,
  });
}

export function startHostedRoomRace() {
  if (!roomIsActive() || !state.tournamentRoom.isHost) return;
  state.tournamentRoom.phase = "racing";
  startRoomRaceLocally();
  syncTournamentRoomSnapshot("racing");
}

export function toggleTournamentRoomPause() {
  if (!roomIsActive() || state.mode !== "racing") return;
  sendRoomMessage({
    type: "pause_sync",
    paused: !state.tournamentRoom.paused,
  });
}

export function endTournamentRoom() {
  if (!roomIsActive()) return;
  sendRoomMessage({
    type: "end_tournament",
  });
}

export function canStartHostedRoomRace() {
  return Boolean(
    roomIsActive() &&
    state.mode === "tournamentLobby" &&
    state.tournamentRoom.isHost &&
    state.tournament.trackOrder.length > 0,
  );
}

export function canAdvanceHostedTournamentStandings() {
  return Boolean(roomIsActive() && state.tournamentRoom.isHost);
}

export function allTournamentHumansFinished() {
  if (!roomIsActive()) return state.raceStandings.playerFinishOrder > 0;
  return (
    state.raceStandings.playerFinishOrder > 0 &&
    getExternalHumanRivalCount() === 0
  );
}

export function tickTournamentRoom(dt) {
  if (!roomIsActive() || state.mode !== "racing") return;
  state.tournamentRoom.lastPlayerStateAt += dt;
  state.tournamentRoom.lastAiStateAt += dt;
  if (state.tournamentRoom.lastPlayerStateAt >= ROOM_STATE_SEND_INTERVAL) {
    state.tournamentRoom.lastPlayerStateAt = 0;
    sendRoomMessage({
      type: "player_state",
      payload: buildLocalPlayerPayload(),
    });
  }
  if (
    state.tournamentRoom.isHost &&
    state.tournamentRoom.lastAiStateAt >= ROOM_STATE_SEND_INTERVAL
  ) {
    state.tournamentRoom.lastAiStateAt = 0;
    sendRoomMessage({
      type: "ai_state",
      payload: buildHostAiPayload(),
    });
  }
  if (state.tournamentRoom.pendingSkidMarks.length > 0) {
    sendRoomMessage({
      type: "skid_marks",
      payload: state.tournamentRoom.pendingSkidMarks.splice(0),
    });
  }
}

export function onTournamentStandingsAdvanced() {
  if (!roomIsActive() || !state.tournamentRoom.isHost) return;
  if (state.tournament.currentRaceIndex < state.tournament.trackOrder.length) {
    startHostedRoomRace();
  } else {
    syncTournamentRoomSnapshot("final");
  }
}

export function refreshTournamentRoomRoster() {
  if (!roomIsActive()) return;
  syncRoomRoster({
    slots: state.tournamentRoom.slots,
  });
}

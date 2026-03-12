import { startGameLoop } from "./game-loop.js";
import {
  enterEditor,
  initInputHandlers,
  syncTrackSelectWindow,
} from "./menus.js";
import {
  applyTrackPreset,
  loadSharedTrackFromApi,
  loadTrackPresetFromApi,
  loadVisibleTracksFromApi,
  sanitizePlayerName,
  trackOptions,
} from "./parameters.js";
import { resetRace, updateRace } from "./physics.js";
import { render } from "./render.js";
import { showSnackbar, tickSnackbar } from "./snackbar.js";
import { setCurbSegments, state } from "./state.js";
import { nextTaglineSet } from "./taglines.js";
import { initCurbSegments } from "./track.js";
import { fetchAuthMe } from "./api.js";
import { initAudio, syncMenuMusicForMode } from "./audio.js";
import { gameAudio } from "./game-audio.js";
import { updateParticles, updateScreenParticles } from "./particles.js";

function decodePathSegment(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function updateMenuTagline(dt) {
  const rotation = state.menuTagline;
  if (!rotation.list.length) return;

  const cycleDuration = rotation.displaySeconds + rotation.fadeSeconds;
  rotation.elapsed += dt;

  while (rotation.elapsed >= cycleDuration) {
    rotation.elapsed -= cycleDuration;
    rotation.index += 1;
    if (rotation.index >= rotation.list.length) {
      rotation.list = nextTaglineSet(rotation.list);
      rotation.index = 0;
    }
  }
}

function updateEditorSelectionFlash(dt) {
  const flash = state.editor?.selectionFlash;
  if (!flash || flash.time <= 0) return;
  flash.time = Math.max(0, flash.time - dt);
  if (flash.time === 0) {
    flash.kind = null;
    flash.index = -1;
  }
}

const appUrl = new URL(window.location.href);
const authResult = appUrl.searchParams.get("auth");
const authError = appUrl.searchParams.get("auth_error");
let raceAudioActive = false;
if (authResult === "ok") {
  showSnackbar("Logged in", { seconds: 1.8, kind: "success" });
}
if (authResult === "failed") {
  const errorText = authError ? `Login failed: ${authError}` : "Login failed";
  showSnackbar(errorText, { seconds: 2.4, kind: "error" });
}
if (authResult) {
  appUrl.searchParams.delete("auth");
  appUrl.searchParams.delete("auth_error");
  const query = appUrl.searchParams.toString();
  window.history.replaceState(
    {},
    "",
    `${appUrl.pathname}${query ? `?${query}` : ""}${appUrl.hash}`,
  );
}

try {
  const me = await fetchAuthMe();
  if (me && me.authenticated) {
    const displayName = sanitizePlayerName(me.display_name || "");
    state.auth.authenticated = true;
    state.auth.userId = typeof me.user_id === "string" ? me.user_id : null;
    state.auth.displayName = displayName;
    state.auth.isAdmin = Boolean(me.is_admin);
    state.playerName = displayName;
  }
} catch {
  // Ignore auth probe failures and continue in anonymous mode.
}

await loadVisibleTracksFromApi({
  currentUserId: state.auth.userId,
  currentUserIsAdmin: state.auth.isAdmin,
});
const currentUrl = new URL(window.location.href);
const trackEditMatch = currentUrl.pathname.match(
  /^\/tracks\/edit\/([^/]+)\/?$/,
);
const editTrackIdFromPath = decodePathSegment(trackEditMatch?.[1] || "");
const raceTrackMatch = currentUrl.pathname.match(/^\/tracks\/([^/]+)\/?$/);
const raceTrackIdFromPath =
  !editTrackIdFromPath && raceTrackMatch?.[1]
    ? decodePathSegment(raceTrackMatch[1])
    : "";
const trackSelectFromPath =
  currentUrl.pathname === "/tracks" || currentUrl.pathname === "/tracks/";
const shareFromUrl = currentUrl.searchParams.get("share");
const trackFromUrl = currentUrl.searchParams.get("track");
const requestedTrackId =
  editTrackIdFromPath || raceTrackIdFromPath || trackFromUrl || "";
if (shareFromUrl) {
  try {
    await loadSharedTrackFromApi(shareFromUrl, {
      currentUserId: state.auth.userId,
      currentUserIsAdmin: state.auth.isAdmin,
    });
  } catch {
    showSnackbar("Track not found", { seconds: 1.8, kind: "error" });
  }
} else if (requestedTrackId) {
  try {
    await loadTrackPresetFromApi(requestedTrackId, {
      currentUserId: state.auth.userId,
      currentUserIsAdmin: state.auth.isAdmin,
    });
  } catch {
    showSnackbar("Track not found", { seconds: 1.8, kind: "error" });
  }
}
if (trackOptions.length > 0) {
  const targetTrackId = shareFromUrl
    ? trackOptions[trackOptions.length - 1]?.id || ""
    : requestedTrackId
      ? requestedTrackId.toLowerCase()
      : "";
  const targetIndex = targetTrackId
    ? trackOptions.findIndex((opt) => opt.id === targetTrackId)
    : -1;
  state.selectedTrackIndex = targetIndex >= 0 ? targetIndex : 0;
  state.trackSelectIndex = state.selectedTrackIndex;
  state.trackSelectViewOffset = 0;
  syncTrackSelectWindow();
}
if (editTrackIdFromPath) {
  enterEditor(state.selectedTrackIndex);
} else if (raceTrackIdFromPath) {
  applyTrackPreset(state.selectedTrackIndex);
  setCurbSegments(initCurbSegments());
  resetRace();
  state.raceReturn.mode = "trackSelect";
  state.raceReturn.editorTrackIndex = null;
  state.mode = "racing";
  syncMenuMusicForMode(state.mode);
} else if (trackSelectFromPath) {
  state.mode = "trackSelect";
}
if (!editTrackIdFromPath && !raceTrackIdFromPath) {
  setCurbSegments(initCurbSegments());
}

initAudio();
gameAudio.resumeOnUserGesture();
initInputHandlers();
render();
syncMenuMusicForMode(state.mode);

startGameLoop({
  update(dt) {
    updateMenuTagline(dt);
    updateEditorSelectionFlash(dt);
    tickSnackbar(dt);
    const shouldPlayRaceAudio = state.mode === "racing" && !state.paused;
    if (shouldPlayRaceAudio && !raceAudioActive) {
      void gameAudio.start();
      raceAudioActive = true;
    } else if (!shouldPlayRaceAudio && raceAudioActive) {
      gameAudio.stop();
      raceAudioActive = false;
    }
    updateScreenParticles(dt);
    if (state.mode === "racing" && !state.paused) {
      updateParticles(dt);
      updateRace(dt);
    }
  },
  render,
});

import { startGameLoop } from "./game-loop.js";
import { initInputHandlers } from "./menus.js";
import {
  loadSharedTrackFromApi,
  loadTrackPresetFromApi,
  loadTracksFromFolder,
  loadVisibleTracksFromApi,
  sanitizePlayerName,
  trackOptions,
} from "./parameters.js";
import { updateRace } from "./physics.js";
import { render } from "./render.js";
import { setCurbSegments, state } from "./state.js";
import { nextTaglineSet } from "./taglines.js";
import { initCurbSegments } from "./track.js";
import { fetchAuthMe } from "./api.js";

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

const appUrl = new URL(window.location.href);
const authResult = appUrl.searchParams.get("auth");
if (authResult === "ok") {
  state.snackbar.text = "Logged in";
  state.snackbar.time = 1.8;
}
if (authResult === "failed") {
  state.snackbar.text = "Login failed";
  state.snackbar.time = 1.8;
}
if (authResult) {
  appUrl.searchParams.delete("auth");
  const query = appUrl.searchParams.toString();
  window.history.replaceState({}, "", `${appUrl.pathname}${query ? `?${query}` : ""}${appUrl.hash}`);
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

await loadTracksFromFolder();
await loadVisibleTracksFromApi({ currentUserId: state.auth.userId });
const currentUrl = new URL(window.location.href);
const shareFromUrl = currentUrl.searchParams.get("share");
const trackFromUrl = currentUrl.searchParams.get("track");
if (shareFromUrl) {
  try {
    await loadSharedTrackFromApi(shareFromUrl, { currentUserId: state.auth.userId });
  } catch {
    state.snackbar.text = "Track not found";
    state.snackbar.time = 1.8;
  }
} else if (trackFromUrl) {
  try {
    await loadTrackPresetFromApi(trackFromUrl, { currentUserId: state.auth.userId });
  } catch {
    state.snackbar.text = "Track not found";
    state.snackbar.time = 1.8;
  }
}
if (trackOptions.length > 0) {
  const targetTrackId = shareFromUrl
    ? trackOptions[trackOptions.length - 1]?.id || ""
    : trackFromUrl
      ? trackFromUrl.toLowerCase()
      : "";
  const targetIndex = targetTrackId ? trackOptions.findIndex((opt) => opt.id === targetTrackId) : -1;
  state.selectedTrackIndex = targetIndex >= 0 ? targetIndex : 0;
  state.trackSelectIndex = state.selectedTrackIndex;
  state.trackSelectViewOffset = Math.max(0, Math.min(state.selectedTrackIndex, Math.max(0, trackOptions.length - 4)));
}
setCurbSegments(initCurbSegments());

initInputHandlers();
render();

startGameLoop({
  update(dt) {
    updateMenuTagline(dt);
    if (state.snackbar.time > 0) {
      state.snackbar.time = Math.max(0, state.snackbar.time - dt);
      if (state.snackbar.time === 0) state.snackbar.text = "";
    }
    if (state.mode === "racing" && !state.paused) {
      updateRace(dt);
    }
  },
  render,
});

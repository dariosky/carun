import { startGameLoop } from "./game-loop.js";
import { initInputHandlers } from "./menus.js";
import { loadOwnTracksFromApi, loadTrackPresetFromApi, loadTracksFromFolder, sanitizePlayerName, trackOptions } from "./parameters.js";
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
    state.playerName = displayName;
  }
} catch {
  // Ignore auth probe failures and continue in anonymous mode.
}

await loadTracksFromFolder();
await loadOwnTracksFromApi();
const trackFromUrl = new URL(window.location.href).searchParams.get("track");
if (trackFromUrl) {
  try {
    await loadTrackPresetFromApi(trackFromUrl);
  } catch {
    state.snackbar.text = "Track not found";
    state.snackbar.time = 1.8;
  }
}
if (trackOptions.length > 0) {
  const targetIndex = trackFromUrl ? trackOptions.findIndex((opt) => opt.id === trackFromUrl.toLowerCase()) : -1;
  state.selectedTrackIndex = targetIndex >= 0 ? targetIndex : 0;
  state.trackSelectIndex = state.selectedTrackIndex;
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

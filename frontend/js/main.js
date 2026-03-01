import { startGameLoop } from "./game-loop.js";
import { initInputHandlers } from "./menus.js";
import { loadOwnTracksFromApi, loadTrackPresetFromApi, loadTracksFromFolder, trackOptions } from "./parameters.js";
import { updateRace } from "./physics.js";
import { render } from "./render.js";
import { setCurbSegments, state } from "./state.js";
import { nextTaglineSet } from "./taglines.js";
import { initCurbSegments } from "./track.js";

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

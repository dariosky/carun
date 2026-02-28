import { startGameLoop } from "./game-loop.js";
import { initInputHandlers } from "./menus.js";
import { loadTracksFromFolder } from "./parameters.js";
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

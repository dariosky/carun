import { startGameLoop } from "./game-loop.js";
import { initInputHandlers } from "./menus.js";
import { loadTracksFromFolder } from "./parameters.js";
import { updateRace } from "./physics.js";
import { render } from "./render.js";
import { setCurbSegments, state } from "./state.js";
import { initCurbSegments } from "./track.js";

await loadTracksFromFolder();
setCurbSegments(initCurbSegments());

initInputHandlers();
render();

startGameLoop({
  update(dt) {
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

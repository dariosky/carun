import { startGameLoop } from "./game-loop.js";
import { initInputHandlers } from "./menus.js";
import { updateRace } from "./physics.js";
import { render } from "./render.js";
import { setCurbSegments, state } from "./state.js";
import { initCurbSegments } from "./track.js";

setCurbSegments(initCurbSegments());

initInputHandlers();
render();

startGameLoop({
  update(dt) {
    if (state.mode === "racing" && !state.paused) {
      updateRace(dt);
    }
  },
  render,
});

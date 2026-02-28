import { physicsConfig } from "./parameters.js";
import { state } from "./state.js";

export function startGameLoop({ update, render }) {
  let last = performance.now();

  function loop(now) {
    const dt = Math.min(physicsConfig.car.dtClamp, (now - last) / 1000);
    last = now;
    const rawFps = dt > 0 ? 1 / dt : 0;
    const smooth = 0.12;
    state.performance.fps = state.performance.fps
      ? state.performance.fps * (1 - smooth) + rawFps * smooth
      : rawFps;

    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

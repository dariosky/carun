import { physicsConfig } from "./parameters.js";

export function startGameLoop({ update, render }) {
  let last = performance.now();

  function loop(now) {
    const dt = Math.min(physicsConfig.car.dtClamp, (now - last) / 1000);
    last = now;

    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

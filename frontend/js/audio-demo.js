import { AudioManager } from "./audio/audio-manager.js";

const audio = new AudioManager();
audio.resumeOnUserGesture(window);

const controls = {
  speed: document.getElementById("speed"),
  throttle: document.getElementById("throttle"),
  acceleration: document.getElementById("acceleration"),
  skid: document.getElementById("skid"),
  surface: document.getElementById("surface"),
  moving: document.getElementById("moving"),
};

const outputs = {
  speed: document.getElementById("speed-value"),
  throttle: document.getElementById("throttle-value"),
  acceleration: document.getElementById("accel-value"),
  skid: document.getElementById("skid-value"),
};

const status = document.getElementById("status");
let running = false;

function readVehicleState() {
  return {
    speedNormalized: Number(controls.speed.value),
    throttle: Number(controls.throttle.value),
    acceleration: Number(controls.acceleration.value),
    skidAmount: Number(controls.skid.value),
    surface: controls.surface.value,
    isMoving: controls.moving.value === "true",
  };
}

function updateOutputs() {
  outputs.speed.value = Number(controls.speed.value).toFixed(2);
  outputs.throttle.value = Number(controls.throttle.value).toFixed(2);
  outputs.acceleration.value = Number(controls.acceleration.value).toFixed(2);
  outputs.skid.value = Number(controls.skid.value).toFixed(2);
}

function tick() {
  updateOutputs();
  if (running) audio.updateVehicleAudio(readVehicleState());
  requestAnimationFrame(tick);
}

document.getElementById("start-audio").addEventListener("click", async () => {
  await audio.start();
  running = true;
  status.textContent = "Vehicle audio running.";
});

document.getElementById("stop-audio").addEventListener("click", () => {
  running = false;
  audio.stop();
  status.textContent = "Vehicle audio muted.";
});

document.getElementById("countdown-1").addEventListener("click", () => {
  audio.playCountdownBeep(1);
});
document.getElementById("countdown-2").addEventListener("click", () => {
  audio.playCountdownBeep(2);
});
document.getElementById("countdown-3").addEventListener("click", () => {
  audio.playCountdownBeep(3);
});
document.getElementById("play-go").addEventListener("click", () => {
  audio.playGo();
});
document.getElementById("tree-bump").addEventListener("click", () => {
  audio.playTreeBump(0.75);
});
document.getElementById("wall-bump").addEventListener("click", () => {
  audio.playWallBump(0.75);
});

for (const element of Object.values(controls)) {
  element.addEventListener("input", updateOutputs);
  element.addEventListener("change", updateOutputs);
}

updateOutputs();
tick();

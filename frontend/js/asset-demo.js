import {
  ASSET_PLACEABLES,
  DEFAULT_ASSET_KIND,
  drawAnimalSprite,
  getAnimalFrame,
  getAnimalSpriteImage,
  getAssetPlaceable,
  isAnimalSpriteReady,
} from "./asset-sprites.js";

const assetSelect = document.getElementById("asset-kind");
const animationSelect = document.getElementById("animation");
const directionSelect = document.getElementById("direction");
const backgroundSelect = document.getElementById("background");
const frameInput = document.getElementById("frame");
const frameValue = document.getElementById("frame-value");
const scaleInput = document.getElementById("scale");
const scaleValue = document.getElementById("scale-value");
const togglePlayButton = document.getElementById("toggle-play");
const toggleShadowButton = document.getElementById("toggle-shadow");
const statusEl = document.getElementById("status");
const previewCanvas = document.getElementById("preview-canvas");
const atlasCanvas = document.getElementById("atlas-canvas");
const previewCtx = previewCanvas.getContext("2d");
const atlasCtx = atlasCanvas.getContext("2d");

const state = {
  kind: DEFAULT_ASSET_KIND,
  animation: "idle",
  direction: "front",
  frameIndex: 0,
  scale: 3,
  play: true,
  showShadow: true,
  background: "grass",
  elapsed: 0,
};

for (const asset of ASSET_PLACEABLES) {
  const option = document.createElement("option");
  option.value = asset.kind;
  option.textContent = asset.label;
  assetSelect.append(option);
}

assetSelect.value = state.kind;
animationSelect.value = state.animation;
directionSelect.value = state.direction;
backgroundSelect.value = state.background;

function setStatus(message) {
  statusEl.textContent = message;
}

function drawPreviewBackground() {
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  if (state.background === "transparent") return;
  previewCtx.fillStyle = state.background === "grass" ? "#2e8c42" : "#64686c";
  previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
  if (state.background === "grass") {
    previewCtx.fillStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i < 90; i++) {
      previewCtx.fillRect((i * 37) % previewCanvas.width, (i * 23) % previewCanvas.height, 2, 2);
    }
  }
}

function drawPreview() {
  drawPreviewBackground();
  drawAnimalSprite(previewCtx, {
    kind: state.kind,
    x: previewCanvas.width * 0.5,
    y: previewCanvas.height * 0.5,
    radius: 12 * state.scale,
    direction: state.direction,
    animation: state.animation,
    elapsed: state.play ? state.elapsed : 0,
    frameIndex: state.play ? null : state.frameIndex,
    shadow: state.showShadow,
  });
}

function drawAtlas() {
  atlasCtx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  atlasCtx.fillStyle = "#101821";
  atlasCtx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);

  const image = getAnimalSpriteImage(state.kind);
  if (!isAnimalSpriteReady(state.kind)) {
    atlasCtx.fillStyle = "#d6e8f5";
    atlasCtx.font = "16px Verdana";
    atlasCtx.fillText("Loading atlas...", 20, 28);
    return;
  }

  const fitScale = Math.min(
    (atlasCanvas.width - 32) / Math.max(image.width, 1),
    (atlasCanvas.height - 32) / Math.max(image.height, 1),
  );
  const drawWidth = image.width * fitScale;
  const drawHeight = image.height * fitScale;
  const drawX = (atlasCanvas.width - drawWidth) * 0.5;
  const drawY = (atlasCanvas.height - drawHeight) * 0.5;

  atlasCtx.imageSmoothingEnabled = false;
  atlasCtx.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  const frame = getAnimalFrame(state.kind, {
    animation: state.animation,
    direction: state.direction,
    elapsed: state.play ? state.elapsed : 0,
    frameIndex: state.play ? null : state.frameIndex,
  });
  atlasCtx.strokeStyle = "#ffe167";
  atlasCtx.lineWidth = 3;
  atlasCtx.strokeRect(
    drawX + frame.sx * fitScale,
    drawY + frame.sy * fitScale,
    frame.sw * fitScale,
    frame.sh * fitScale,
  );
}

function render() {
  const frame = getAnimalFrame(state.kind, {
    animation: state.animation,
    direction: state.direction,
    elapsed: state.play ? state.elapsed : 0,
    frameIndex: state.play ? null : state.frameIndex,
  });
  frameInput.value = String(frame.frameIndex);
  frameValue.textContent = String(frame.frameIndex);
  scaleValue.textContent = `${state.scale.toFixed(1)}x`;
  togglePlayButton.textContent = state.play ? "Pause" : "Play";
  toggleShadowButton.textContent = `Shadow: ${state.showShadow ? "On" : "Off"}`;
  drawPreview();
  drawAtlas();
  const asset = getAssetPlaceable(state.kind);
  setStatus(
    `${asset.label} | ${frame.animation} ${frame.direction} | frame ${frame.frameIndex}/${frame.frameCount - 1} | rect ${frame.sx},${frame.sy},${frame.sw},${frame.sh} | ${isAnimalSpriteReady(state.kind) ? "atlas ready" : "loading"}`,
  );
}

assetSelect.addEventListener("change", () => {
  state.kind = assetSelect.value || DEFAULT_ASSET_KIND;
  render();
});

animationSelect.addEventListener("change", () => {
  state.animation = animationSelect.value === "walk" ? "walk" : "idle";
  render();
});

directionSelect.addEventListener("change", () => {
  state.direction = directionSelect.value || "front";
  render();
});

backgroundSelect.addEventListener("change", () => {
  state.background = backgroundSelect.value || "grass";
  render();
});

frameInput.addEventListener("input", () => {
  state.frameIndex = Number(frameInput.value) || 0;
  if (!state.play) render();
});

scaleInput.addEventListener("input", () => {
  state.scale = Number(scaleInput.value) || 3;
  render();
});

togglePlayButton.addEventListener("click", () => {
  state.play = !state.play;
  if (!state.play) {
    state.frameIndex = Number(frameInput.value) || 0;
  }
  render();
});

toggleShadowButton.addEventListener("click", () => {
  state.showShadow = !state.showShadow;
  render();
});

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.play) {
    state.elapsed += dt;
    render();
  }
  requestAnimationFrame(loop);
}

render();
requestAnimationFrame(loop);

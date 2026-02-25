import { HEIGHT, WIDTH, track } from "./parameters.js";
import { trackRadiiAtAngle } from "./track.js";

let asphaltMaterial = null;

function clampByte(value) {
  return Math.max(0, Math.min(255, value | 0));
}

function hashNoise2D(x, y, seed = 0) {
  let n = x * 374761393 + y * 668265263 + seed * 1442695041;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function createMaterialCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function buildAsphaltMaterial() {
  const materialCanvas = createMaterialCanvas(WIDTH, HEIGHT);
  const materialCtx = materialCanvas.getContext("2d");
  const imageData = materialCtx.createImageData(WIDTH, HEIGHT);
  const pixels = imageData.data;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const px = (y * WIDTH + x) * 4;
      const dx = x - track.cx;
      const dy = y - track.cy;
      const angle = Math.atan2(dy, dx);
      const dist = Math.hypot(dx, dy);
      const radii = trackRadiiAtAngle(angle);

      if (dist < radii.inner || dist > radii.outer) {
        pixels[px + 3] = 0;
        continue;
      }

      const laneT = (dist - radii.inner) / Math.max(radii.outer - radii.inner, 1e-6);
      const edgeLift = Math.abs(laneT - 0.5) * 2;
      const outerBias = laneT - 0.5;
      const baseTone = 112 + edgeLift * 16 + outerBias * 8;

      const grain = (hashNoise2D(x, y, 17) - 0.5) * 24;
      const speckle = hashNoise2D(x, y, 71) > 0.92 ? (hashNoise2D(x, y, 113) - 0.5) * 18 : 0;
      const shade = clampByte(baseTone + grain + speckle);

      pixels[px] = shade;
      pixels[px + 1] = clampByte(shade + 2);
      pixels[px + 2] = clampByte(shade + 3);
      pixels[px + 3] = 255;
    }
  }

  materialCtx.putImageData(imageData, 0, 0);
  return materialCanvas;
}

function getAsphaltMaterial() {
  if (!asphaltMaterial) asphaltMaterial = buildAsphaltMaterial();
  return asphaltMaterial;
}

export function drawAsphaltMaterial(targetCtx) {
  targetCtx.drawImage(getAsphaltMaterial(), 0, 0);
}


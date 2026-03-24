export function setupFrontendTestEnv() {
  if (globalThis.__carunFrontendTestEnvReady) return;

  const noop = () => {};
  const fakeCtx = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    lineWidth: 0,
    globalAlpha: 1,
    save: noop,
    restore: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fillText: noop,
    measureText: (text) => ({ width: String(text).length * 10 }),
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    clip: noop,
    rect: noop,
    arc: noop,
    ellipse: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    drawImage: noop,
    roundRect: noop,
    quadraticCurveTo: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    setLineDash: noop,
    fill: noop,
    createPattern: () => ({}),
  };
  const fakeCanvas = {
    width: 1280,
    height: 720,
    getContext: () => fakeCtx,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1280,
      height: 720,
    }),
  };

  globalThis.window = {
    location: { href: "http://localhost:8080/" },
    history: { replaceState: noop },
    addEventListener: noop,
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = noop;
  globalThis.localStorage = {
    getItem: () => null,
    setItem: noop,
  };
  globalThis.document = {
    getElementById: () => fakeCanvas,
    createElement: () => fakeCanvas,
  };
  globalThis.Image = class {
    addEventListener() {}
    set src(_) {}
  };
  globalThis.Audio = class {
    constructor() {
      this.loop = false;
      this.preload = "";
      this.volume = 0;
      this.paused = true;
      this.currentTime = 0;
      this.muted = false;
    }
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  };
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return fakeCtx;
    }
  };

  globalThis.__carunFrontendTestEnvReady = true;
}

export function makeTrackData({
  cx = 640,
  cy = 360,
  halfWidth = 60,
  borderSize = 22,
  worldScale = 1,
  centerlineSmoothingMode = "light",
} = {}) {
  return {
    cx,
    cy,
    borderSize,
    centerlineHalfWidth: halfWidth,
    centerlineWidthProfile: new Array(8).fill(halfWidth),
    centerlineSmoothingMode,
    worldScale,
    startAngle: 0,
    centerlineLoop: [
      { x: cx - 220, y: cy - 120 },
      { x: cx - 80, y: cy - 180 },
      { x: cx + 90, y: cy - 170 },
      { x: cx + 210, y: cy - 70 },
      { x: cx + 220, y: cy + 120 },
      { x: cx + 80, y: cy + 180 },
      { x: cx - 90, y: cy + 170 },
      { x: cx - 210, y: cy + 70 },
    ],
  };
}

export function reverseTrackLoop(trackData) {
  return {
    ...trackData,
    centerlineLoop: [...trackData.centerlineLoop].reverse(),
    centerlineWidthProfile: [...trackData.centerlineWidthProfile],
  };
}

export function makeIntersectionTrackData() {
  return {
    cx: 640,
    cy: 360,
    borderSize: 22,
    centerlineHalfWidth: 58,
    centerlineWidthProfile: new Array(8).fill(58),
    centerlineSmoothingMode: "light",
    worldScale: 1,
    startAngle: 0,
    centerlineLoop: [
      { x: 340, y: 210 },
      { x: 560, y: 320 },
      { x: 870, y: 210 },
      { x: 760, y: 360 },
      { x: 870, y: 510 },
      { x: 560, y: 400 },
      { x: 340, y: 510 },
      { x: 450, y: 360 },
    ],
  };
}

export function curbOuterProbePoint(points, index, sideSign, width) {
  const point = points[index];
  let nx = 0;
  let ny = 0;
  if (index > 0) {
    const dx = point.x - points[index - 1].x;
    const dy = point.y - points[index - 1].y;
    const len = Math.hypot(dx, dy) || 1;
    nx -= dy / len;
    ny += dx / len;
  }
  if (index < points.length - 1) {
    const dx = points[index + 1].x - point.x;
    const dy = points[index + 1].y - point.y;
    const len = Math.hypot(dx, dy) || 1;
    nx -= dy / len;
    ny += dx / len;
  }
  const nlen = Math.hypot(nx, ny) || 1;
  return {
    x: point.x + (nx / nlen) * sideSign * width,
    y: point.y + (ny / nlen) * sideSign * width,
  };
}

export function nearestDistanceToLoop(point, loop) {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = Math.max(dx * dx + dy * dy, 1e-8);
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    best = Math.min(best, Math.hypot(point.x - px, point.y - py));
  }
  return best;
}

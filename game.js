const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const state = {
  mode: "menu",
  menuIndex: 0,
  settingsIndex: 0,
  playerName: "PLAYER",
  editingName: false,
  raceTime: 0,
  finished: false,
};

const keys = {
  up: false,
  down: false,
  left: false,
  right: false,
  accel: false,
  brake: false,
};

const menuItems = ["START RACE", "SETTINGS"];
const settingsItems = ["PLAYER NAME", "BACK"];

const track = {
  cx: WIDTH * 0.5,
  cy: HEIGHT * 0.53,
  outerA: 500,
  outerB: 265,
  innerA: 315,
  innerB: 145,
};

const checkpoints = [
  { angle: 0 },
  { angle: Math.PI * 0.5 },
  { angle: Math.PI },
  { angle: Math.PI * 1.5 },
];

const lapData = {
  currentLapStart: 0,
  lapTimes: [],
  maxLaps: 3,
  passed: new Set([0]),
  lap: 1,
};

const car = {
  x: track.cx,
  y: track.cy + 205,
  angle: -Math.PI / 2,
  speed: 0,
  width: 34,
  height: 20,
};

const physics = {
  accel: 260,
  brake: 320,
  drag: 0.985,
  steering: 2.35,
  maxSpeed: 320,
  reverseSpeed: -120,
};

const worldObjects = [
  { type: "tree", x: 150, y: 150, r: 26 },
  { type: "tree", x: 1080, y: 136, r: 24 },
  { type: "tree", x: 172, y: 596, r: 23 },
  { type: "tree", x: 1110, y: 580, r: 22 },
  { type: "pond", x: 650, y: 350, rx: 95, ry: 52 },
  { type: "pond", x: 215, y: 340, rx: 60, ry: 34 },
  { type: "barrel", x: 447, y: 153, r: 13 },
  { type: "barrel", x: 847, y: 567, r: 13 },
];

function resetRace() {
  car.x = track.cx;
  car.y = track.cy + 205;
  car.angle = -Math.PI / 2;
  car.speed = 0;
  state.raceTime = 0;
  state.finished = false;
  lapData.currentLapStart = 0;
  lapData.lapTimes = [];
  lapData.passed = new Set([0]);
  lapData.lap = 1;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normEllipse(x, y, a, b) {
  return (x * x) / (a * a) + (y * y) / (b * b);
}

function getSurface(x, y) {
  const dx = x - track.cx;
  const dy = y - track.cy;
  const nOuter = normEllipse(dx, dy, track.outerA, track.outerB);
  const nInner = normEllipse(dx, dy, track.innerA, track.innerB);

  if (nOuter > 1) return "grass";
  if (nInner < 1) return "innerGrass";

  const borderOuter = normEllipse(dx, dy, track.outerA - 22, track.outerB - 22);
  const borderInner = normEllipse(dx, dy, track.innerA + 22, track.innerB + 22);

  if (borderOuter > 1 || borderInner < 1) return "curb";
  return "asphalt";
}

function objectCollisionAt(x, y) {
  for (const obj of worldObjects) {
    if (obj.type === "tree" || obj.type === "barrel") {
      const r = obj.r + 8;
      const dx = x - obj.x;
      const dy = y - obj.y;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

function pondSlowdownAt(x, y) {
  for (const obj of worldObjects) {
    if (obj.type !== "pond") continue;
    const dx = x - obj.x;
    const dy = y - obj.y;
    const n = normEllipse(dx, dy, obj.rx, obj.ry);
    if (n < 1) return true;
  }
  return false;
}

function updateRace(dt) {
  if (state.finished) return;

  state.raceTime += dt;

  if (keys.accel) car.speed += physics.accel * dt;
  if (keys.brake) car.speed -= physics.brake * dt;
  car.speed *= Math.pow(physics.drag, dt * 60);

  const surface = getSurface(car.x, car.y);
  let grip = 1;
  let topSpeed = physics.maxSpeed;

  if (surface === "grass" || surface === "innerGrass") {
    topSpeed = 145;
    grip = 0.55;
    car.speed *= 0.97;
  }
  if (surface === "curb") {
    topSpeed = 350;
    grip = 1.16;
  }
  if (pondSlowdownAt(car.x, car.y)) {
    topSpeed = Math.min(topSpeed, 70);
    car.speed *= 0.9;
  }

  car.speed = clamp(car.speed, physics.reverseSpeed, topSpeed);

  const steerInput = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
  car.angle += steerInput * physics.steering * dt * (car.speed / physics.maxSpeed) * grip;

  const vx = Math.cos(car.angle) * car.speed;
  const vy = Math.sin(car.angle) * car.speed;

  const nx = car.x + vx * dt;
  const ny = car.y + vy * dt;

  if (!objectCollisionAt(nx, ny)) {
    car.x = nx;
    car.y = ny;
  } else {
    car.speed *= -0.25;
  }

  checkCheckpoints();
}

function checkCheckpoints() {
  const dx = car.x - track.cx;
  const dy = car.y - track.cy;
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += Math.PI * 2;

  checkpoints.forEach((cp, idx) => {
    let diff = Math.abs(angle - cp.angle);
    diff = Math.min(diff, Math.PI * 2 - diff);
    if (diff < 0.2) {
      lapData.passed.add(idx);
    }
  });

  const nearStart = Math.abs(car.x - track.cx) < 30 && Math.abs(car.y - (track.cy + (track.outerB + track.innerB) * 0.5)) < 34;

  if (nearStart && lapData.passed.size === checkpoints.length && !state.finished) {
    const lapTime = state.raceTime - lapData.currentLapStart;
    if (lapTime > 2) {
      lapData.lapTimes.push(lapTime);
      lapData.currentLapStart = state.raceTime;
      lapData.passed = new Set([0]);
      lapData.lap += 1;

      if (lapData.lap > lapData.maxLaps) {
        state.finished = true;
      }
    }
  }
}

function drawPixelNoise() {
  for (let i = 0; i < 250; i++) {
    const x = Math.floor(Math.random() * WIDTH);
    const y = Math.floor(Math.random() * HEIGHT);
    ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.03)";
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawTrack() {
  ctx.fillStyle = "#2e8c42";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawPixelNoise();

  ctx.fillStyle = "#7f8c8d";
  ctx.beginPath();
  ctx.ellipse(track.cx, track.cy, track.outerA, track.outerB, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 22;
  ctx.setLineDash([16, 10]);
  ctx.strokeStyle = "#d22e2e";
  ctx.beginPath();
  ctx.ellipse(track.cx, track.cy, track.outerA - 12, track.outerB - 12, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "#f1e9d3";
  ctx.beginPath();
  ctx.ellipse(track.cx, track.cy, track.innerA + 12, track.innerB + 12, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#247637";
  ctx.beginPath();
  ctx.ellipse(track.cx, track.cy, track.innerA, track.innerB, 0, 0, Math.PI * 2);
  ctx.fill();

  drawDecor();
  drawRoadDetails();
  drawStartLine();
}

function drawDecor() {
  for (const obj of worldObjects) {
    if (obj.type === "tree") {
      ctx.fillStyle = "#4a2f1e";
      ctx.fillRect(obj.x - 4, obj.y + 8, 8, 16);
      ctx.fillStyle = "#2f9c4a";
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, obj.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3dcf60";
      ctx.beginPath();
      ctx.arc(obj.x - 8, obj.y - 6, obj.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }

    if (obj.type === "pond") {
      ctx.fillStyle = "#1f6ca8";
      ctx.beginPath();
      ctx.ellipse(obj.x, obj.y, obj.rx, obj.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#8de2ff";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (obj.type === "barrel") {
      ctx.fillStyle = "#d16f0d";
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, obj.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#3a2a12";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function drawRoadDetails() {
  ctx.strokeStyle = "rgba(235, 235, 235, 0.45)";
  ctx.lineWidth = 4;
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    const x = track.cx + Math.cos(t) * ((track.outerA + track.innerA) * 0.5);
    const y = track.cy + Math.sin(t) * ((track.outerB + track.innerB) * 0.5);
    ctx.beginPath();
    ctx.arc(x, y, 1.3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawStartLine() {
  const y = track.cy + (track.outerB + track.innerB) * 0.5;
  const x = track.cx;
  const width = 16;
  const height = 62;

  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? "#ffffff" : "#111111";
      ctx.fillRect(x - width + j * width, y - height / 2 + i * 10, width, 10);
    }
  }
}

function drawCar() {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  ctx.fillStyle = "#d22525";
  ctx.fillRect(-car.width / 2, -car.height / 2, car.width, car.height);
  ctx.fillStyle = "#ffd34d";
  ctx.fillRect(-8, -6, 16, 12);
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(-car.width / 2 - 4, -car.height / 2 - 2, 6, 8);
  ctx.fillRect(-car.width / 2 - 4, car.height / 2 - 6, 6, 8);
  ctx.fillRect(car.width / 2 - 2, -car.height / 2 - 2, 6, 8);
  ctx.fillRect(car.width / 2 - 2, car.height / 2 - 6, 6, 8);

  ctx.restore();
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, "0");
  const ms = Math.floor((t % 1) * 1000)
    .toString()
    .padStart(3, "0");
  return `${m}:${s}.${ms}`;
}

function drawHUD() {
  ctx.fillStyle = "rgba(5, 8, 18, 0.78)";
  ctx.fillRect(20, 16, 350, 160);

  ctx.fillStyle = "#ffe167";
  ctx.font = "bold 24px Verdana";
  ctx.fillText(`DRIVER: ${state.playerName}`, 34, 46);

  ctx.fillStyle = "#f0f0f0";
  ctx.font = "18px Verdana";
  const liveLap = state.finished
    ? lapData.lapTimes[lapData.lapTimes.length - 1] || 0
    : state.raceTime - lapData.currentLapStart;
  ctx.fillText(`LAP ${Math.min(lapData.lap, lapData.maxLaps)}/${lapData.maxLaps}`, 34, 75);
  ctx.fillText(`CURRENT: ${formatTime(liveLap)}`, 34, 102);

  ctx.font = "16px Verdana";
  for (let i = 0; i < lapData.maxLaps; i++) {
    const t = lapData.lapTimes[i];
    ctx.fillStyle = t ? "#ffffff" : "#8ea4aa";
    ctx.fillText(`L${i + 1}: ${t ? formatTime(t) : "--:--.---"}`, 34, 128 + i * 20);
  }

  if (state.finished) {
    ctx.fillStyle = "rgba(12, 22, 18, 0.86)";
    ctx.fillRect(WIDTH / 2 - 210, HEIGHT / 2 - 90, 420, 180);
    ctx.fillStyle = "#6af0a8";
    ctx.font = "bold 42px Verdana";
    ctx.fillText("FINISH!", WIDTH / 2 - 95, HEIGHT / 2 - 18);
    ctx.font = "20px Verdana";
    ctx.fillStyle = "#ffffff";
    const total = lapData.lapTimes.reduce((a, b) => a + b, 0);
    ctx.fillText(`TOTAL: ${formatTime(total)}`, WIDTH / 2 - 104, HEIGHT / 2 + 20);
    ctx.fillText("ENTER TO RETURN MENU", WIDTH / 2 - 144, HEIGHT / 2 + 52);
  }
}

function drawMenu() {
  ctx.fillStyle = "#0f2640";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 118px Verdana";
  ctx.fillText("CARUN", WIDTH / 2 - 245, 210);

  ctx.font = "bold 42px Verdana";
  menuItems.forEach((item, idx) => {
    const y = 360 + idx * 74;
    ctx.fillStyle = idx === state.menuIndex ? "#ffffff" : "#8aa4b8";
    if (idx === state.menuIndex) {
      ctx.fillStyle = "#ec4f4f";
      ctx.fillRect(WIDTH / 2 - 230, y - 43, 460, 56);
      ctx.fillStyle = "#ffffff";
    }
    ctx.fillText(item, WIDTH / 2 - 145, y);
  });

  ctx.font = "22px Verdana";
  ctx.fillStyle = "#bfd8f7";
  ctx.fillText("Use ↑ ↓ and Enter", WIDTH / 2 - 108, HEIGHT - 80);
}

function drawSettings() {
  ctx.fillStyle = "#142a36";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 76px Verdana";
  ctx.fillText("SETTINGS", WIDTH / 2 - 210, 180);

  ctx.font = "bold 35px Verdana";
  settingsItems.forEach((item, idx) => {
    const y = 305 + idx * 90;
    if (idx === state.settingsIndex) {
      ctx.fillStyle = "#3d7ec7";
      ctx.fillRect(WIDTH / 2 - 280, y - 42, 560, 56);
      ctx.fillStyle = "#ffffff";
    } else {
      ctx.fillStyle = "#9db6c7";
    }

    if (item === "PLAYER NAME") {
      const suffix = state.editingName ? "_" : "";
      ctx.fillText(`${item}: ${state.playerName}${suffix}`, WIDTH / 2 - 250, y);
    } else {
      ctx.fillText(item, WIDTH / 2 - 250, y);
    }
  });

  ctx.font = "20px Verdana";
  ctx.fillStyle = "#d7e9f4";
  ctx.fillText("Enter edits/chooses. Esc exits name edit.", WIDTH / 2 - 205, HEIGHT - 80);
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  if (state.mode === "menu") drawMenu();
  else if (state.mode === "settings") drawSettings();
  else {
    drawTrack();
    drawCar();
    drawHUD();
  }
}

function activateSelection() {
  if (state.mode === "menu") {
    if (state.menuIndex === 0) {
      state.mode = "racing";
      resetRace();
    }
    if (state.menuIndex === 1) {
      state.mode = "settings";
      state.settingsIndex = 0;
      state.editingName = false;
    }
    return;
  }

  if (state.mode === "settings") {
    if (state.settingsIndex === 0) {
      state.editingName = !state.editingName;
    }
    if (state.settingsIndex === 1) {
      state.mode = "menu";
    }
    return;
  }

  if (state.mode === "racing" && state.finished) {
    state.mode = "menu";
  }
}

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();

  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
    e.preventDefault();
  }

  if (state.mode === "settings" && state.editingName) {
    if (key === "escape" || key === "enter") {
      state.editingName = false;
      return;
    }
    if (key === "backspace") {
      state.playerName = state.playerName.slice(0, -1) || "P";
      return;
    }
    if (/^[a-z0-9 ]$/.test(key) && state.playerName.length < 12) {
      state.playerName += key.toUpperCase();
      return;
    }
  }

  if (key === "arrowup") {
    if (state.mode === "menu") state.menuIndex = (state.menuIndex + menuItems.length - 1) % menuItems.length;
    if (state.mode === "settings") state.settingsIndex = (state.settingsIndex + settingsItems.length - 1) % settingsItems.length;
    keys.up = true;
  }
  if (key === "arrowdown") {
    if (state.mode === "menu") state.menuIndex = (state.menuIndex + 1) % menuItems.length;
    if (state.mode === "settings") state.settingsIndex = (state.settingsIndex + 1) % settingsItems.length;
    keys.down = true;
  }
  if (key === "enter") activateSelection();

  if (state.mode === "racing") {
    if (key === "w" || key === "arrowup") keys.accel = true;
    if (key === "s" || key === "arrowdown") keys.brake = true;
    if (key === "a" || key === "arrowleft") keys.left = true;
    if (key === "d" || key === "arrowright") keys.right = true;
    if (key === "escape") state.mode = "menu";
  }
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  if (key === "w" || key === "arrowup") {
    keys.accel = false;
    keys.up = false;
  }
  if (key === "s" || key === "arrowdown") {
    keys.brake = false;
    keys.down = false;
  }
  if (key === "a" || key === "arrowleft") keys.left = false;
  if (key === "d" || key === "arrowright") keys.right = false;
});

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  if (state.mode === "racing") {
    updateRace(dt);
  }

  render();
  requestAnimationFrame(loop);
}

render();
requestAnimationFrame(loop);

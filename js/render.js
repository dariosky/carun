import {
  CHECKPOINT_WIDTH_MULTIPLIER,
  ctx,
  WIDTH,
  HEIGHT,
  CURB_MAX_WIDTH,
  CURB_MIN_WIDTH,
  CURB_STRIPE_LENGTH,
  checkpoints,
  menuItems,
  physicsConfig,
  settingsItems,
  track,
  worldObjects,
} from "./parameters.js";
import {
  appLogo,
  appLogoReady,
  car,
  curbSegments,
  kartSprite,
  kartSpriteReady,
  lapData,
  physicsRuntime,
  skidMarks,
  state,
} from "./state.js";
import { formatTime } from "./utils.js";
import {
  blobRadius,
  drawPath,
  drawStripedCurb,
  pointOnCenterLine,
  pointOnTrackRadius,
  sampleClosedPath,
  trackRadiiAtAngle,
} from "./track.js";
import { drawAsphaltMaterial } from "./material.js";

function drawPixelNoise() {
  for (let i = 0; i < 250; i++) {
    const x = Math.floor(Math.random() * WIDTH);
    const y = Math.floor(Math.random() * HEIGHT);
    ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.03)";
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawDecor() {
  for (const obj of worldObjects) {
    if (obj.type === "tree") {
      ctx.fillStyle = "#4a2f1e";
      ctx.fillRect(obj.x - 4, obj.y + 8, 8, 16);
      ctx.fillStyle = "#2f9c4a";
      const canopy = sampleClosedPath((a) => {
        const radius =
          obj.r *
          (1 + 0.2 * Math.sin(a * 3 + obj.x * 0.02) + 0.12 * Math.sin(a * 5 + obj.y * 0.02));
        return {
          x: obj.x + Math.cos(a) * radius,
          y: obj.y + Math.sin(a) * radius,
        };
      }, 40);
      ctx.beginPath();
      drawPath(canopy);
      ctx.fill();
      ctx.fillStyle = "#3dcf60";
      const highlight = sampleClosedPath((a) => {
        const radius = obj.r * 0.4 * (1 + 0.12 * Math.sin(a * 4 + obj.x * 0.08));
        return {
          x: obj.x - 8 + Math.cos(a) * radius,
          y: obj.y - 6 + Math.sin(a) * radius,
        };
      }, 24);
      ctx.beginPath();
      drawPath(highlight);
      ctx.fill();
    }

    if (obj.type === "pond") {
      ctx.fillStyle = "#7aa1c2";
      const waterPath = sampleClosedPath((a) => {
        const radius = blobRadius(obj.rx, obj.ry, a, obj.seed || 0);
        return {
          x: obj.x + Math.cos(a) * radius,
          y: obj.y + Math.sin(a) * radius,
        };
      }, 64);
      ctx.beginPath();
      drawPath(waterPath);
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
    const p = pointOnCenterLine(t);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawSkidMarks() {
  if (!skidMarks.length) return;

  ctx.save();
  ctx.lineCap = "round";
  for (const mark of skidMarks) {
    ctx.strokeStyle = mark.color;
    ctx.lineWidth = mark.width;
    ctx.beginPath();
    ctx.moveTo(mark.x1, mark.y1);
    ctx.lineTo(mark.x2, mark.y2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCheckpointFlags() {
  for (const cp of checkpoints) {
    const a = cp.angle;
    const radii = trackRadiiAtAngle(a);
    const radialX = Math.cos(a);
    const radialY = Math.sin(a);
    const tangentX = -Math.sin(a);
    const tangentY = Math.cos(a);
    const roadMid = (radii.inner + radii.outer) * 0.5;
    const roadWidth = radii.outer - radii.inner;
    const checkpointSpan = roadWidth * CHECKPOINT_WIDTH_MULTIPLIER;
    const posts = [roadMid - checkpointSpan * 0.5, roadMid + checkpointSpan * 0.5];

    if (physicsConfig.flags.DEBUG_VECTORS) {
      const innerPin = pointOnTrackRadius(a, posts[0]);
      const outerPin = pointOnTrackRadius(a, posts[1]);
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.moveTo(innerPin.x, innerPin.y);
      ctx.lineTo(outerPin.x, outerPin.y);
      ctx.stroke();
      ctx.restore();
    }

    for (const radius of posts) {
      const baseX = track.cx + radialX * radius;
      const baseY = track.cy + radialY * radius;
      const topX = baseX;
      const topY = baseY - 16;
      const side = radius < roadMid ? 1 : -1;
      const flagTipX = topX + tangentX * 10 * side;
      const flagTipY = topY + tangentY * 10 * side;

      ctx.strokeStyle = "#e5e5e5";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(topX, topY);
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(flagTipX, flagTipY + 4);
      ctx.lineTo(topX, topY + 7);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawStartLine() {
  const startAngle = Math.PI * 0.5;
  const radii = trackRadiiAtAngle(startAngle);
  const center = pointOnTrackRadius(startAngle, (radii.outer + radii.inner) * 0.5);
  const span = radii.outer - radii.inner;
  const thickness = 20;
  const cols = Math.max(8, Math.floor(span / 18));
  const rows = 2;
  const cellW = span / cols;
  const cellH = thickness / rows;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(startAngle);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      ctx.fillStyle = (c + r) % 2 ? "#ffffff" : "#111111";
      ctx.fillRect(-span * 0.5 + c * cellW, -thickness * 0.5 + r * cellH, cellW, cellH);
    }
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-span * 0.5, -thickness * 0.5, span, thickness);
  ctx.restore();
}

function drawTrack() {
  ctx.fillStyle = "#2e8c42";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawPixelNoise();

  const outerPath = sampleClosedPath((a) => {
    const radii = trackRadiiAtAngle(a);
    return pointOnTrackRadius(a, radii.outer);
  });
  const innerPath = sampleClosedPath((a) => {
    const radii = trackRadiiAtAngle(a);
    return pointOnTrackRadius(a, radii.inner);
  });

  drawAsphaltMaterial(ctx);

  curbSegments.outer.forEach((segment) =>
    drawStripedCurb(segment, -1, CURB_MIN_WIDTH, CURB_MAX_WIDTH, CURB_STRIPE_LENGTH),
  );
  curbSegments.inner.forEach((segment) =>
    drawStripedCurb(segment, 1, CURB_MIN_WIDTH, CURB_MAX_WIDTH, CURB_STRIPE_LENGTH),
  );

  ctx.fillStyle = "#247637";
  ctx.beginPath();
  drawPath(innerPath);
  ctx.fill();

  drawDecor();
  drawSkidMarks();
  drawRoadDetails();
  drawStartLine();
  drawCheckpointFlags();
}

function drawCar() {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle + Math.PI * 0.5);

  if (kartSpriteReady) {
    const spriteWidth = 30;
    const spriteLength = 56;
    ctx.drawImage(
      kartSprite,
      -spriteWidth * 0.5,
      -spriteLength * 0.5,
      spriteWidth,
      spriteLength,
    );
  } else {
    ctx.fillStyle = "#d22525";
    ctx.fillRect(-car.height / 2, -car.width / 2, car.height, car.width);
    ctx.fillStyle = "#ffd34d";
    ctx.fillRect(-6, -8, 12, 16);
  }

  ctx.restore();
}

function drawDebugVectors() {
  if (!physicsConfig.flags.DEBUG_VECTORS || state.mode !== "racing") return;

  const forwardX = Math.cos(car.angle);
  const forwardY = Math.sin(car.angle);
  const rightX = -forwardY;
  const rightY = forwardX;
  const velMag = Math.hypot(car.vx, car.vy);
  const velDirX = velMag > 0.001 ? car.vx / velMag : 0;
  const velDirY = velMag > 0.001 ? car.vy / velMag : 0;
  const lateralWorldX = rightX * physicsRuntime.debug.vLateral;
  const lateralWorldY = rightY * physicsRuntime.debug.vLateral;
  const scale = 0.08;
  const originX = car.x + forwardX * car.width * 0.38;
  const originY = car.y + forwardY * car.width * 0.38;

  ctx.save();
  ctx.lineWidth = 3;

  ctx.strokeStyle = "#ffe167";
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.lineTo(originX + forwardX * 60, originY + forwardY * 60);
  ctx.stroke();

  ctx.strokeStyle = "#4da6ff";
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.lineTo(originX + velDirX * 70, originY + velDirY * 70);
  ctx.stroke();

  ctx.strokeStyle = "#ff6969";
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.lineTo(originX + lateralWorldX * scale, originY + lateralWorldY * scale);
  ctx.stroke();

  ctx.fillStyle = "rgba(5, 8, 18, 0.84)";
  ctx.fillRect(20, HEIGHT - 116, 310, 92);
  ctx.fillStyle = "#e9f0ff";
  ctx.font = "15px Verdana";
  ctx.fillText(`SURFACE: ${physicsRuntime.debug.surface.toUpperCase()}`, 34, HEIGHT - 86);
  ctx.fillText(`SLIP: ${(physicsRuntime.debug.slipAngle * 57.2958).toFixed(1)} DEG`, 34, HEIGHT - 64);
  ctx.fillText(`Vf: ${physicsRuntime.debug.vForward.toFixed(1)} Vl: ${physicsRuntime.debug.vLateral.toFixed(1)}`, 34, HEIGHT - 42);
  ctx.restore();
}

function drawStartSequenceOverlay() {
  const seq = state.startSequence;
  if (!seq.active && seq.goFlash <= 0) return;

  const cx = track.cx;
  const cy = track.cy;

  if (seq.active) {
    const readyHold = 0.95;
    const readyFadeEnd = 1.8;
    let readyAlpha = 0;
    if (seq.elapsed < readyHold) readyAlpha = 1;
    else readyAlpha = Math.max(0, Math.min(1, 1 - (seq.elapsed - readyHold) / (readyFadeEnd - readyHold)));

    if (readyAlpha > 0) {
      const pulse = 1 + Math.sin(seq.elapsed * 9) * 0.06;
      ctx.save();
      ctx.translate(cx, cy - 82);
      ctx.scale(pulse, pulse);
      ctx.globalAlpha = readyAlpha;
      ctx.fillStyle = "rgba(11, 19, 28, 0.78)";
      ctx.fillRect(-165, -54, 330, 82);
      ctx.fillStyle = "#fff2a6";
      ctx.font = "bold 56px Verdana";
      ctx.fillText("READY?", -145, 4);
      ctx.restore();
    }

    const redCount = Math.min(3, Math.floor(seq.elapsed));
    const plateX = cx - 146;
    const plateY = cy - 18;
    const plateW = 292;
    const plateH = 112;

    ctx.save();
    const plateGradient = ctx.createLinearGradient(plateX, plateY, plateX, plateY + plateH);
    plateGradient.addColorStop(0, "#707985");
    plateGradient.addColorStop(1, "#2b3138");
    ctx.fillStyle = plateGradient;
    ctx.fillRect(plateX, plateY, plateW, plateH);
    ctx.strokeStyle = "#181d21";
    ctx.lineWidth = 4;
    ctx.strokeRect(plateX, plateY, plateW, plateH);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillRect(plateX + 8, plateY + 8, plateW - 16, 18);

    for (let i = 0; i < 3; i++) {
      const x = cx - 92 + i * 92;
      const y = cy + 38;
      const lit = i < redCount;
      const glow = lit ? "rgba(255, 72, 72, 0.5)" : "rgba(0, 0, 0, 0.35)";
      const lamp = ctx.createRadialGradient(x - 6, y - 8, 5, x, y, 29);
      if (lit) {
        lamp.addColorStop(0, "#ffd8d8");
        lamp.addColorStop(0.45, "#fa4747");
        lamp.addColorStop(1, "#640f0f");
      } else {
        lamp.addColorStop(0, "#797f89");
        lamp.addColorStop(0.55, "#444a54");
        lamp.addColorStop(1, "#1e232a");
      }

      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.fillStyle = lamp;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - 7, y - 8, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.fill();
    }
    ctx.restore();
  }

  if (!seq.active && seq.goFlash > 0) {
    const a = Math.max(0, Math.min(1, seq.goFlash / 0.85));
    const pop = 1 + (1 - a) * 0.12;
    ctx.save();
    const plateX = cx - 146;
    const plateY = cy - 18;
    const plateW = 292;
    const plateH = 112;
    const plateGradient = ctx.createLinearGradient(plateX, plateY, plateX, plateY + plateH);
    plateGradient.addColorStop(0, "#707985");
    plateGradient.addColorStop(1, "#2b3138");
    ctx.globalAlpha = Math.min(1, a + 0.2);
    ctx.fillStyle = plateGradient;
    ctx.fillRect(plateX, plateY, plateW, plateH);
    ctx.strokeStyle = "#181d21";
    ctx.lineWidth = 4;
    ctx.strokeRect(plateX, plateY, plateW, plateH);

    for (let i = 0; i < 3; i++) {
      const x = cx - 92 + i * 92;
      const y = cy + 38;
      const lamp = ctx.createRadialGradient(x - 6, y - 8, 5, x, y, 29);
      lamp.addColorStop(0, "#d5ffe3");
      lamp.addColorStop(0.45, "#57e58a");
      lamp.addColorStop(1, "#0f5228");
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(96, 255, 162, 0.45)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.fillStyle = lamp;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - 7, y - 8, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.fill();
    }

    ctx.translate(cx, cy - 18);
    ctx.scale(pop, pop);
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(9, 19, 16, 0.8)";
    ctx.fillRect(-125, -58, 250, 92);
    ctx.fillStyle = "#6af0a8";
    ctx.font = "bold 64px Verdana";
    ctx.fillText("GO!", -85, 12);
    ctx.restore();
  }
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
    const bestLap = lapData.lapTimes.length ? Math.min(...lapData.lapTimes) : 0;
    ctx.fillText(`TOTAL: ${formatTime(total)}`, WIDTH / 2 - 104, HEIGHT / 2 + 20);
    ctx.fillText(`BEST: ${formatTime(bestLap)}`, WIDTH / 2 - 104, HEIGHT / 2 + 46);
    ctx.fillText("ENTER TO RETURN MENU", WIDTH / 2 - 144, HEIGHT / 2 + 72);
  }
}

function drawPauseOverlay() {
  if (!state.paused || state.mode !== "racing") return;

  const panelW = 540;
  const panelH = 310;
  const x = WIDTH * 0.5 - panelW * 0.5;
  const y = HEIGHT * 0.5 - panelH * 0.5;

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "rgba(8, 14, 24, 0.94)";
  ctx.fillRect(x, y, panelW, panelH);
  ctx.strokeStyle = "#c4a13c";
  ctx.lineWidth = 4;
  ctx.strokeRect(x, y, panelW, panelH);

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 54px Verdana";
  ctx.fillText("PAUSED", x + 148, y + 78);

  const pauseItems = ["RESUME RACE", "END RACE"];
  ctx.font = "bold 28px Verdana";
  for (let i = 0; i < pauseItems.length; i++) {
    const rowY = y + 118 + i * 44;
    if (i === state.pauseMenuIndex) {
      ctx.fillStyle = "#ec4f4f";
      ctx.fillRect(x + 130, rowY - 27, 280, 34);
      ctx.fillStyle = "#ffffff";
    } else {
      ctx.fillStyle = "#b9cde3";
    }
    ctx.fillText(pauseItems[i], x + 148, rowY);
  }

  ctx.fillStyle = "#f0f4fb";
  ctx.font = "20px Verdana";
  ctx.fillText("W/S or Up/Down: Accelerate and brake", x + 46, y + 214);
  ctx.fillText("A/D or Left/Right: Steer", x + 46, y + 238);
  ctx.fillText("Space: Handbrake", x + 46, y + 262);
  ctx.fillText("P or Esc: Open pause", x + 46, y + 286);
}

function drawMenu() {
  ctx.fillStyle = "#0f2640";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();

  if (appLogoReady) {
    const maxLogoWidth = 320;
    const maxLogoHeight = 130;
    const ratio = Math.min(maxLogoWidth / appLogo.width, maxLogoHeight / appLogo.height);
    const drawWidth = appLogo.width * ratio;
    const drawHeight = appLogo.height * ratio;
    ctx.drawImage(appLogo, WIDTH * 0.5 - drawWidth * 0.5, 22, drawWidth, drawHeight);
  }

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

export function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  if (state.mode === "menu") drawMenu();
  else if (state.mode === "settings") drawSettings();
  else {
    drawTrack();
    drawCar();
    drawDebugVectors();
    drawStartSequenceOverlay();
    drawHUD();
    drawPauseOverlay();
  }
}

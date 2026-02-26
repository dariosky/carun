import {
  CHECKPOINT_WIDTH_MULTIPLIER,
  ctx,
  WIDTH,
  HEIGHT,
  CURB_MAX_WIDTH,
  CURB_MIN_WIDTH,
  CURB_STRIPE_LENGTH,
  checkpoints,
  getConnectedCenterlinePoints,
  getTrackPreset,
  menuItems,
  physicsConfig,
  settingsItems,
  track,
  trackOptions,
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
  isCenterlineTrack,
  pointOnCenterLine,
  sampleClosedPath,
  trackBoundaryPaths,
  trackFrameAtAngle,
} from "./track.js";
import { drawAsphaltMaterial, getAsphaltPattern } from "./material.js";

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
  const CHECKPOINT_PIN_WIDTH_MULTIPLIER = 1.2;
  for (const cp of checkpoints) {
    const a = cp.angle;
    const frame = trackFrameAtAngle(a, track);
    const center = frame.point;
    const normal = frame.normal;
    const tangent = frame.tangent;
    const roadWidth = frame.roadWidth;
    const checkpointSpan = roadWidth * CHECKPOINT_WIDTH_MULTIPLIER;
    const pinSpan = roadWidth * CHECKPOINT_PIN_WIDTH_MULTIPLIER;
    const posts = [-pinSpan * 0.5, pinSpan * 0.5];

    if (physicsConfig.flags.DEBUG_MODE) {
      const innerPin = {
        x: center.x + normal.x * (checkpointSpan * -0.5),
        y: center.y + normal.y * (checkpointSpan * -0.5),
      };
      const outerPin = {
        x: center.x + normal.x * (checkpointSpan * 0.5),
        y: center.y + normal.y * (checkpointSpan * 0.5),
      };
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
      const baseX = center.x + normal.x * radius;
      const baseY = center.y + normal.y * radius;
      const topX = baseX;
      const topY = baseY - 16;
      const side = radius < 0 ? 1 : -1;
      const flagTipX = topX + tangent.x * 10 * side;
      const flagTipY = topY + tangent.y * 10 * side;

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
  const frame = trackFrameAtAngle(startAngle, track);
  const center = frame.point;
  const span = frame.roadWidth;
  const thickness = 20;
  const cols = Math.max(8, Math.floor(span / 18));
  const rows = 2;
  const cellW = span / cols;
  const cellH = thickness / rows;
  const normalAngle = Math.atan2(frame.normal.y, frame.normal.x);

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(normalAngle);

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

  const boundaries = trackBoundaryPaths(track, 260);
  const outerPath = boundaries.outer;
  const innerPath = boundaries.inner;
  const centerlineTrack = isCenterlineTrack(track);

  if (centerlineTrack) {
    const roadWidth = Math.max(24, track.centerlineHalfWidth || 90) * 2;
    if (boundaries.center.length) {
      const asphaltPattern = getAsphaltPattern(ctx);
      ctx.save();
      ctx.strokeStyle = asphaltPattern || "#7f8c8d";
      ctx.lineWidth = roadWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(boundaries.center[0].x, boundaries.center[0].y);
      for (let i = 1; i < boundaries.center.length; i++) {
        ctx.lineTo(boundaries.center[i].x, boundaries.center[i].y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  } else {
    ctx.save();
    ctx.beginPath();
    drawPath(outerPath);
    drawPath([...innerPath].reverse());
    ctx.clip("evenodd");
    drawAsphaltMaterial(ctx);
    ctx.restore();
  }

  curbSegments.outer.forEach((segment) =>
    drawStripedCurb(segment, -1, CURB_MIN_WIDTH, CURB_MAX_WIDTH, CURB_STRIPE_LENGTH),
  );
  curbSegments.inner.forEach((segment) =>
    drawStripedCurb(segment, 1, CURB_MIN_WIDTH, CURB_MAX_WIDTH, CURB_STRIPE_LENGTH),
  );

  if (!centerlineTrack) {
    ctx.fillStyle = "#247637";
    ctx.beginPath();
    drawPath(innerPath);
    ctx.fill();
  }

  drawDecor();
  drawSkidMarks();
  drawRoadDetails();
  drawStartLine();
  drawCheckpointFlags();
}

function drawCar() {
  const blinkActive = state.checkpointBlink.time > 0;
  let blinkT = 0;
  if (blinkActive) {
    blinkT = state.checkpointBlink.time / Math.max(state.checkpointBlink.duration, 0.0001);
  }

  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle + Math.PI * 0.5);

  if (blinkActive) {
    const pulse = 0.5 + 0.5 * Math.sin((1 - blinkT) * Math.PI * 7);
    const glowStrength = Math.max(0, Math.min(1, blinkT * 0.5 + pulse * 0.5));
    ctx.shadowColor = `rgba(255, 255, 255, ${(0.9 * glowStrength).toFixed(3)})`;
    ctx.shadowBlur = 18 + 24 * glowStrength;
  }

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
  if (!physicsConfig.flags.DEBUG_MODE || state.mode !== "racing") return;

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
  const originX = physicsRuntime.debug.pivotX;
  const originY = physicsRuntime.debug.pivotY;

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
  ctx.fillRect(20, HEIGHT - 134, 330, 110);
  ctx.fillStyle = "#e9f0ff";
  ctx.font = "15px Verdana";
  ctx.fillText(`SURFACE: ${physicsRuntime.debug.surface.toUpperCase()}`, 34, HEIGHT - 104);
  ctx.fillText(`SLIP: ${(physicsRuntime.debug.slipAngle * 57.2958).toFixed(1)} DEG`, 34, HEIGHT - 82);
  ctx.fillText(`Vf: ${physicsRuntime.debug.vForward.toFixed(1)} Vl: ${physicsRuntime.debug.vLateral.toFixed(1)}`, 34, HEIGHT - 60);
  ctx.fillText(`CHECKPOINTS: ${lapData.passed.size}/${checkpoints.length}`, 34, HEIGHT - 38);
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
  ctx.fillText("CARUN", WIDTH / 2 - 245, 250);

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

function drawPreviewLoop(points, mapPoint) {
  if (!points.length) return;
  const first = mapPoint(points[0]);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i++) {
    const p = mapPoint(points[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

function drawTrackPreviewCard(x, y, size, selected, trackDef) {
  ctx.save();
  ctx.fillStyle = selected ? "#244864" : "#1a3347";
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = selected ? "#f2d26c" : "#6c879b";
  ctx.lineWidth = selected ? 5 : 3;
  ctx.strokeRect(x, y, size, size);

  const pad = 18;
  const innerX = x + pad;
  const innerY = y + pad;
  const innerSize = size - pad * 2;

  ctx.beginPath();
  ctx.rect(innerX, innerY, innerSize, innerSize);
  ctx.clip();
  ctx.fillStyle = "#2e8c42";
  ctx.fillRect(innerX, innerY, innerSize, innerSize);

  const boundaries = trackBoundaryPaths(trackDef, 180);
  const outer = boundaries.outer;
  const inner = boundaries.inner;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outer) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const scale = Math.min(innerSize / (maxX - minX), innerSize / (maxY - minY));
  const cardCenterX = innerX + innerSize * 0.5;
  const cardCenterY = innerY + innerSize * 0.5;
  const mapPoint = (p) => ({
    x: cardCenterX + (p.x - centerX) * scale,
    y: cardCenterY + (p.y - centerY) * scale,
  });

  ctx.fillStyle = "#787e86";
  ctx.beginPath();
  drawPreviewLoop(outer, mapPoint);
  drawPreviewLoop([...inner].reverse(), mapPoint);
  ctx.fill("evenodd");

  ctx.fillStyle = "#247637";
  ctx.beginPath();
  drawPreviewLoop(inner, mapPoint);
  ctx.fill();

  const startAngle = Math.PI * 0.5;
  const startFrame = trackFrameAtAngle(startAngle, trackDef);
  const halfRoad = startFrame.roadWidth * 0.5;
  const startInner = mapPoint({
    x: startFrame.point.x - startFrame.normal.x * halfRoad,
    y: startFrame.point.y - startFrame.normal.y * halfRoad,
  });
  const startOuter = mapPoint({
    x: startFrame.point.x + startFrame.normal.x * halfRoad,
    y: startFrame.point.y + startFrame.normal.y * halfRoad,
  });
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(startInner.x, startInner.y);
  ctx.lineTo(startOuter.x, startOuter.y);
  ctx.stroke();

  ctx.restore();
}

function drawTrackSelection() {
  ctx.fillStyle = "#11283e";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPixelNoise();

  ctx.fillStyle = "#ffd25e";
  ctx.font = "bold 70px Verdana";
  ctx.fillText("SELECT TRACK", WIDTH * 0.5 - 248, 148);

  const cardSize = 220;
  const gap = 40;
  const cardY = 198;
  const cardCount = trackOptions.length + 1;
  const totalWidth = cardCount * cardSize + Math.max(0, cardCount - 1) * gap;
  const startX = WIDTH * 0.5 - totalWidth * 0.5;

  for (let i = 0; i < trackOptions.length; i++) {
    const cardX = startX + i * (cardSize + gap);
    const selected = state.trackSelectIndex === i;
    drawTrackPreviewCard(cardX, cardY, cardSize, selected, getTrackPreset(i).track);

    ctx.fillStyle = selected ? "#ffffff" : "#9db6c7";
    ctx.font = "bold 24px Verdana";
    const label = trackOptions[i].name;
    const labelWidth = ctx.measureText(label).width;
    ctx.fillText(label, cardX + cardSize * 0.5 - labelWidth * 0.5, cardY + cardSize + 34);
  }

  const addIndex = trackOptions.length;
  const addX = startX + addIndex * (cardSize + gap);
  const addSelected = state.trackSelectIndex === addIndex;
  ctx.fillStyle = addSelected ? "#244864" : "#1a3347";
  ctx.fillRect(addX, cardY, cardSize, cardSize);
  ctx.strokeStyle = addSelected ? "#f2d26c" : "#6c879b";
  ctx.lineWidth = addSelected ? 5 : 3;
  ctx.strokeRect(addX, cardY, cardSize, cardSize);
  ctx.fillStyle = addSelected ? "#ffffff" : "#b6cad9";
  ctx.font = "bold 102px Verdana";
  ctx.fillText("+", addX + cardSize * 0.5 - 30, cardY + cardSize * 0.5 + 34);
  ctx.font = "bold 22px Verdana";
  const addLabel = "UPLOAD TRACK";
  const addLabelWidth = ctx.measureText(addLabel).width;
  ctx.fillText(addLabel, addX + cardSize * 0.5 - addLabelWidth * 0.5, cardY + cardSize + 34);

  const backY = cardY + cardSize + 106;
  const backIndex = trackOptions.length + 1;
  const backSelected = state.trackSelectIndex === backIndex;
  if (backSelected) {
    ctx.fillStyle = "#ec4f4f";
    ctx.fillRect(WIDTH * 0.5 - 145, backY - 39, 290, 52);
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px Verdana";
  ctx.fillText("BACK", WIDTH * 0.5 - 62, backY);

  ctx.font = "20px Verdana";
  ctx.fillStyle = "#c3d9ec";
  ctx.fillText("Use \u2190 \u2192 to pick, \u2191/\u2193 for BACK, Enter to confirm", WIDTH * 0.5 - 270, HEIGHT - 70);
  ctx.fillText("+ card imports a JSON track file", WIDTH * 0.5 - 172, HEIGHT - 42);
  if (physicsConfig.flags.DEBUG_MODE) {
    ctx.fillText("Press E to edit selected track", WIDTH * 0.5 - 150, HEIGHT - 14);
  }
}

function drawStroke(stroke, color, lineWidth) {
  if (!stroke || stroke.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(stroke[0].x, stroke[0].y);
  for (let i = 1; i < stroke.length; i++) {
    ctx.lineTo(stroke[i].x, stroke[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawEditorOverlay() {
  const preset = getTrackPreset(state.editor.trackIndex);
  const strokes = preset.centerlineStrokes || [];
  const connectedLoop = getConnectedCenterlinePoints(strokes);
  drawStroke(connectedLoop, "rgba(96, 248, 255, 0.78)", 2);
  for (const stroke of strokes) {
    drawStroke(stroke, "rgba(245, 241, 88, 0.9)", 4);
  }
  drawStroke(state.editor.activeStroke, "rgba(255, 255, 255, 0.95)", 3);

  const cx = state.editor.cursorX;
  const cy = state.editor.cursorY;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy);
  ctx.lineTo(cx + 12, cy);
  ctx.moveTo(cx, cy - 12);
  ctx.lineTo(cx, cy + 12);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "rgba(5, 10, 18, 0.75)";
  ctx.fillRect(18, 16, 572, 84);
  ctx.fillStyle = "#d7e8ff";
  ctx.font = "18px Verdana";
  ctx.fillText("EDITOR MODE - Mouse drag: draw centerline", 30, 48);
  ctx.fillText("T: tree  W: water  B: barrel  Space: generate  Esc: back", 30, 76);
}

function drawEditor() {
  drawTrack();
  drawEditorOverlay();
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
    } else if (item === "DEBUG MODE") {
      ctx.fillText(`${item}: ${physicsConfig.flags.DEBUG_MODE ? "ON" : "OFF"}`, WIDTH / 2 - 250, y);
    } else {
      ctx.fillText(item, WIDTH / 2 - 250, y);
    }
  });

  ctx.font = "20px Verdana";
  ctx.fillStyle = "#d7e9f4";
  ctx.fillText("Enter edits/chooses. Esc exits name edit.", WIDTH / 2 - 205, HEIGHT - 80);
}

function drawSnackbar() {
  if (!state.snackbar.text || state.snackbar.time <= 0) return;
  const text = state.snackbar.text;
  const alpha = Math.min(1, state.snackbar.time / 0.25);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "bold 22px Verdana";
  const paddingX = 22;
  const width = ctx.measureText(text).width + paddingX * 2;
  const height = 44;
  const x = WIDTH * 0.5 - width * 0.5;
  const y = HEIGHT - 58;
  ctx.fillStyle = "rgba(8, 16, 24, 0.85)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = "#f2fbff";
  ctx.fillText(text, x + paddingX, y + 30);
  ctx.restore();
}

export function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  if (state.mode === "menu") drawMenu();
  else if (state.mode === "trackSelect") drawTrackSelection();
  else if (state.mode === "editor") drawEditor();
  else if (state.mode === "settings") drawSettings();
  else {
    drawTrack();
    drawCar();
    drawDebugVectors();
    drawStartSequenceOverlay();
    drawHUD();
    drawPauseOverlay();
  }

  drawSnackbar();
}

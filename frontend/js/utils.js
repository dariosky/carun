export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

export function normalizeVec(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

export function signedAngleBetween(v1, v2) {
  return Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y);
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60)
    .toString()
    .padStart(2, "0");
  const ms = Math.floor((t % 1) * 1000)
    .toString()
    .padStart(3, "0");
  return `${m}:${s}.${ms}`;
}

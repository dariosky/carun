export const AUDIO_TUNING = {
  masterGain: 0.86,
  vehicleBusGain: 0.94,
  uiBusGain: 0.9,
  impactBusGain: 0.96,
  smoothing: {
    fast: 0.02,
    medium: 0.05,
    slow: 0.1,
  },
  engine: {
    idleHz: 56,
    topHz: 168,
    toneGain: 0.1,
    overtoneGain: 0.06,
    noiseGain: 0.018,
    idleGain: 0.055,
    moveGain: 0.11,
    cutoffBase: 480,
    cutoffSpeed: 1900,
    cutoffThrottle: 1200,
    waterMuffleMul: 0.52,
    grassMuffleMul: 0.82,
    accelDetuneCents: 18,
    wobbleHz: 9,
    wobbleDepthCents: 4,
    throttleWobbleDepthCents: 10,
  },
  skid: {
    baseGain: 0.001,
    maxGain: 0.18,
    baseFreq: 850,
    topFreq: 3400,
    roadOnlyMul: 1,
    offroadMul: 0.2,
  },
  surface: {
    grassGain: 0.14,
    waterGain: 0.17,
    grassCutoff: 1300,
    waterCutoff: 680,
    waterFlutterHz: 7,
    waterFlutterDepth: 220,
  },
  signal: {
    countdownHz: [760, 880, 1000],
    goHz: [980, 1470],
    countdownDuration: 0.11,
    goDuration: 0.34,
  },
  impact: {
    treeBaseHz: 140,
    barrelBaseHz: 185,
    wallBaseHz: 240,
    durationMin: 0.07,
    durationMax: 0.22,
  },
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeOut(value) {
  return 1 - (1 - value) * (1 - value);
}

export function now(context) {
  return context.currentTime;
}

export function setParam(param, value, time) {
  param.cancelScheduledValues(time);
  param.setValueAtTime(value, time);
}

export function smoothParam(param, value, time, smoothing) {
  param.cancelScheduledValues(time);
  param.setTargetAtTime(value, time, smoothing);
}

export function createGain(context, value = 1) {
  const node = context.createGain();
  node.gain.value = value;
  return node;
}

export function createFilter(context, type, frequency, q = 0.7) {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

export function makeOscillator(context, type, frequency) {
  const osc = context.createOscillator();
  osc.type = type;
  osc.frequency.value = frequency;
  return osc;
}

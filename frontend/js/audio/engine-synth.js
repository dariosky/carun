import {
  AUDIO_TUNING,
  clamp,
  createFilter,
  createGain,
  easeOut,
  makeOscillator,
  now,
  smoothParam,
} from "./shared.js";
import { createNoiseSource } from "./noise.js";

export class EngineSynth {
  constructor(context) {
    this.context = context;
    this.output = createGain(context, 0);

    this.bodyOsc = makeOscillator(context, "triangle", AUDIO_TUNING.engine.idleHz);
    this.overtoneOsc = makeOscillator(context, "sawtooth", AUDIO_TUNING.engine.idleHz * 1.98);
    this.wobbleOsc = makeOscillator(context, "sine", AUDIO_TUNING.engine.wobbleHz);
    this.noiseSource = createNoiseSource(context);

    this.bodyGain = createGain(context, AUDIO_TUNING.engine.toneGain);
    this.overtoneGain = createGain(context, AUDIO_TUNING.engine.overtoneGain);
    this.noiseGain = createGain(context, 0);
    this.engineFilter = createFilter(context, "lowpass", AUDIO_TUNING.engine.cutoffBase, 0.9);
    this.noiseFilter = createFilter(context, "bandpass", 1400, 0.7);
    this.wobbleDepth = createGain(context, 0);

    this.wobbleOsc.connect(this.wobbleDepth);
    this.wobbleDepth.connect(this.bodyOsc.detune);
    this.wobbleDepth.connect(this.overtoneOsc.detune);

    this.bodyOsc.connect(this.bodyGain);
    this.overtoneOsc.connect(this.overtoneGain);
    this.noiseSource.connect(this.noiseFilter);

    this.bodyGain.connect(this.engineFilter);
    this.overtoneGain.connect(this.engineFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.engineFilter);
    this.engineFilter.connect(this.output);

    this.started = false;
  }

  connect(destination) {
    this.output.connect(destination);
  }

  start() {
    if (this.started) return;
    this.bodyOsc.start();
    this.overtoneOsc.start();
    this.wobbleOsc.start();
    this.noiseSource.start();
    this.started = true;
  }

  update({
    speedNormalized = 0,
    throttle = 0,
    acceleration = 0,
    isMoving = false,
    surface = "asphalt",
    airborne = false,
    airborneAmount = 0,
    wheelSpinAmount = 0,
  }) {
    const time = now(this.context);
    const engineCfg = AUDIO_TUNING.engine;
    const speed = clamp(speedNormalized, 0, 1);
    const throttleAmount = clamp(throttle, 0, 1);
    const accelAmount = clamp(acceleration, -1, 1);
    const airAmount = clamp(airborneAmount, 0, 1);
    const wheelSpin = clamp(wheelSpinAmount, 0, 1);
    const speedCurve = easeOut(Math.pow(speed, 0.7));

    const baseHz =
      engineCfg.idleHz +
      speedCurve * (engineCfg.topHz - engineCfg.idleHz) +
      throttleAmount * 10 +
      airAmount * throttleAmount * engineCfg.airbornePitchBoostHz;
    const overtoneHz = baseHz * (1.94 + throttleAmount * 0.05);
    let cutoff =
      engineCfg.cutoffBase +
      speedCurve * engineCfg.cutoffSpeed +
      throttleAmount * engineCfg.cutoffThrottle;
    if (surface === "water") cutoff *= engineCfg.waterMuffleMul;
    if (surface === "grass") cutoff *= engineCfg.grassMuffleMul;

    const movingBlend = isMoving ? 1 : 0;
    const targetGain =
      engineCfg.idleGain + speedCurve * engineCfg.moveGain + throttleAmount * 0.03 * movingBlend;
    const roughness =
      engineCfg.noiseGain *
      (0.2 + throttleAmount * 0.9 + Math.abs(accelAmount) * 0.45) *
      (airborne ? 1 + wheelSpin * (engineCfg.airborneNoiseGainMul - 1) : 1);
    const detune =
      accelAmount * engineCfg.accelDetuneCents +
      throttleAmount * 3 +
      speedCurve * 2 +
      airAmount * throttleAmount * engineCfg.airborneDetuneCents;
    const wobbleDepth =
      engineCfg.wobbleDepthCents + throttleAmount * engineCfg.throttleWobbleDepthCents;

    smoothParam(this.bodyOsc.frequency, baseHz, time, AUDIO_TUNING.smoothing.medium);
    smoothParam(this.overtoneOsc.frequency, overtoneHz, time, AUDIO_TUNING.smoothing.medium);
    smoothParam(this.bodyOsc.detune, detune, time, AUDIO_TUNING.smoothing.fast);
    smoothParam(this.overtoneOsc.detune, detune * 1.15, time, AUDIO_TUNING.smoothing.fast);
    smoothParam(this.engineFilter.frequency, cutoff, time, AUDIO_TUNING.smoothing.slow);
    smoothParam(
      this.noiseFilter.frequency,
      900 + speedCurve * 1200 + throttleAmount * 800,
      time,
      AUDIO_TUNING.smoothing.medium,
    );
    smoothParam(this.noiseGain.gain, roughness, time, AUDIO_TUNING.smoothing.medium);
    smoothParam(this.wobbleDepth.gain, wobbleDepth, time, AUDIO_TUNING.smoothing.slow);
    smoothParam(this.output.gain, targetGain, time, AUDIO_TUNING.smoothing.medium);
  }
}

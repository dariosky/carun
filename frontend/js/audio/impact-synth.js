import {
  AUDIO_TUNING,
  clamp,
  createFilter,
  createGain,
  easeOut,
  makeOscillator,
  now,
} from "./shared.js";
import { createNoiseSource } from "./noise.js";

export class ImpactSynth {
  constructor(context, output) {
    this.context = context;
    this.output = output;
  }

  triggerTreeBump(intensity = 0.5) {
    this.#triggerImpact({
      intensity,
      baseHz: AUDIO_TUNING.impact.treeBaseHz,
      type: "triangle",
      noiseFreq: 520,
      noiseQ: 0.55,
      noiseGain: 0.11,
      toneGain: 0.22,
      pitchDrop: 0.7,
      durationMul: 1.15,
    });
  }

  triggerWallBump(intensity = 0.5) {
    this.#triggerImpact({
      intensity,
      baseHz: AUDIO_TUNING.impact.wallBaseHz,
      type: "square",
      noiseFreq: 1450,
      noiseQ: 1.1,
      noiseGain: 0.16,
      toneGain: 0.18,
      pitchDrop: 0.84,
      durationMul: 0.8,
    });
  }

  triggerBarrelBump(intensity = 0.5) {
    this.#triggerImpact({
      intensity,
      baseHz: AUDIO_TUNING.impact.barrelBaseHz,
      type: "triangle",
      noiseFreq: 980,
      noiseQ: 0.9,
      noiseGain: 0.13,
      toneGain: 0.16,
      pitchDrop: 0.76,
      durationMul: 0.9,
    });
  }

  #triggerImpact({
    intensity,
    baseHz,
    type,
    noiseFreq,
    noiseQ,
    noiseGain,
    toneGain,
    pitchDrop,
    durationMul,
  }) {
    const hit = easeOut(clamp(intensity, 0, 1));
    const time = now(this.context);
    const duration =
      (AUDIO_TUNING.impact.durationMin +
        hit *
          (AUDIO_TUNING.impact.durationMax - AUDIO_TUNING.impact.durationMin)) *
      durationMul;

    const osc = makeOscillator(this.context, type, baseHz * (1 + hit * 0.8));
    const oscGain = createGain(this.context, 0);
    const noise = createNoiseSource(this.context);
    const noiseFilter = createFilter(
      this.context,
      "bandpass",
      noiseFreq + hit * 420,
      noiseQ,
    );
    const noiseMix = createGain(this.context, 0);
    const mix = createGain(this.context, 1);
    const master = createGain(this.context, 1);

    osc.connect(oscGain);
    oscGain.connect(mix);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseMix);
    noiseMix.connect(mix);
    mix.connect(master);
    master.connect(this.output);

    oscGain.gain.setValueAtTime(0.0001, time);
    oscGain.gain.linearRampToValueAtTime(
      toneGain * (0.55 + hit * 0.75),
      time + 0.006,
    );
    oscGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    noiseMix.gain.setValueAtTime(0.0001, time);
    noiseMix.gain.linearRampToValueAtTime(
      noiseGain * (0.45 + hit * 0.8),
      time + 0.004,
    );
    noiseMix.gain.exponentialRampToValueAtTime(0.0001, time + duration * 0.72);

    master.gain.setValueAtTime(0.0001, time);
    master.gain.linearRampToValueAtTime(0.7 + hit * 0.28, time + 0.004);
    master.gain.exponentialRampToValueAtTime(0.0001, time + duration + 0.02);

    osc.frequency.setValueAtTime(baseHz * (1 + hit * 0.8), time);
    osc.frequency.exponentialRampToValueAtTime(
      baseHz * pitchDrop,
      time + duration * 0.7,
    );

    osc.start(time);
    noise.start(time);
    osc.stop(time + duration + 0.05);
    noise.stop(time + duration + 0.05);
  }
}

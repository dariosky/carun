import { AUDIO_TUNING, clamp, createFilter, createGain, now, smoothParam } from "./shared.js";
import { createNoiseSource } from "./noise.js";

export class SkidSynth {
  constructor(context) {
    this.context = context;
    this.output = createGain(context, 0);
    this.source = createNoiseSource(context);
    this.highpass = createFilter(context, "highpass", 600, 0.6);
    this.bandpass = createFilter(context, "bandpass", 1500, 0.9);
    this.toneGain = createGain(context, AUDIO_TUNING.skid.baseGain);

    this.source.connect(this.highpass);
    this.highpass.connect(this.bandpass);
    this.bandpass.connect(this.toneGain);
    this.toneGain.connect(this.output);

    this.started = false;
  }

  connect(destination) {
    this.output.connect(destination);
  }

  start() {
    if (this.started) return;
    this.source.start();
    this.started = true;
  }

  update({ skidAmount = 0, speedNormalized = 0, surface = "asphalt" }) {
    const time = now(this.context);
    const skid = clamp(skidAmount, 0, 1);
    const speed = clamp(speedNormalized, 0, 1);
    const surfaceMul =
      surface === "asphalt" || surface === "curb"
        ? AUDIO_TUNING.skid.roadOnlyMul
        : AUDIO_TUNING.skid.offroadMul;
    const gain =
      AUDIO_TUNING.skid.maxGain * Math.pow(skid, 1.45) * Math.pow(speed, 0.6) * surfaceMul;
    const centerFreq =
      AUDIO_TUNING.skid.baseFreq + skid * (AUDIO_TUNING.skid.topFreq - AUDIO_TUNING.skid.baseFreq);

    smoothParam(this.bandpass.frequency, centerFreq, time, AUDIO_TUNING.smoothing.fast);
    smoothParam(this.highpass.frequency, 350 + skid * 1100, time, AUDIO_TUNING.smoothing.medium);
    smoothParam(this.output.gain, gain, time, AUDIO_TUNING.smoothing.fast);
  }
}

import { AUDIO_TUNING, clamp, createFilter, createGain, now, smoothParam } from "./shared.js";
import { createNoiseSource } from "./noise.js";

export class SurfaceSynth {
  constructor(context) {
    this.context = context;
    this.output = createGain(context, 1);

    this.grassSource = createNoiseSource(context);
    this.grassBand = createFilter(context, "bandpass", 420, 0.75);
    this.grassLowpass = createFilter(context, "lowpass", AUDIO_TUNING.surface.grassCutoff, 0.7);
    this.grassGain = createGain(context, 0);

    this.waterSource = createNoiseSource(context);
    this.waterLowpass = createFilter(context, "lowpass", AUDIO_TUNING.surface.waterCutoff, 0.7);
    this.waterBand = createFilter(context, "bandpass", 260, 0.55);
    this.waterGain = createGain(context, 0);
    this.flutterOsc = context.createOscillator();
    this.flutterOsc.type = "sine";
    this.flutterOsc.frequency.value = AUDIO_TUNING.surface.waterFlutterHz;
    this.flutterDepth = createGain(context, AUDIO_TUNING.surface.waterFlutterDepth);

    this.flutterOsc.connect(this.flutterDepth);
    this.flutterDepth.connect(this.waterBand.frequency);

    this.grassSource.connect(this.grassBand);
    this.grassBand.connect(this.grassLowpass);
    this.grassLowpass.connect(this.grassGain);
    this.grassGain.connect(this.output);

    this.waterSource.connect(this.waterLowpass);
    this.waterLowpass.connect(this.waterBand);
    this.waterBand.connect(this.waterGain);
    this.waterGain.connect(this.output);

    this.started = false;
  }

  connect(destination) {
    this.output.connect(destination);
  }

  start() {
    if (this.started) return;
    this.grassSource.start();
    this.waterSource.start();
    this.flutterOsc.start();
    this.started = true;
  }

  update({ surface = "asphalt", speedNormalized = 0, throttle = 0, isMoving = false }) {
    const time = now(this.context);
    const speed = clamp(speedNormalized, 0, 1);
    const throttleAmount = clamp(throttle, 0, 1);
    const movement = isMoving ? 1 : 0;
    const grassActive = surface === "grass" ? 1 : 0;
    const waterActive = surface === "water" ? 1 : 0;

    const grassGain =
      grassActive *
      movement *
      AUDIO_TUNING.surface.grassGain *
      (0.35 + speed * 0.75 + throttleAmount * 0.15);
    const waterGain =
      waterActive *
      movement *
      AUDIO_TUNING.surface.waterGain *
      (0.45 + speed * 0.65 + throttleAmount * 0.12);

    smoothParam(this.grassBand.frequency, 260 + speed * 260, time, AUDIO_TUNING.smoothing.medium);
    smoothParam(
      this.waterLowpass.frequency,
      AUDIO_TUNING.surface.waterCutoff + speed * 220,
      time,
      AUDIO_TUNING.smoothing.medium,
    );
    smoothParam(this.grassGain.gain, grassGain, time, AUDIO_TUNING.smoothing.medium);
    smoothParam(this.waterGain.gain, waterGain, time, AUDIO_TUNING.smoothing.medium);
  }
}

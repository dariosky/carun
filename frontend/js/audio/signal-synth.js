import { AUDIO_TUNING, createGain, makeOscillator, now, setParam } from "./shared.js";

export class SignalSynth {
  constructor(context, output) {
    this.context = context;
    this.output = output;
  }

  triggerCountdownBeep(step = 1) {
    const index = Math.max(0, Math.min(AUDIO_TUNING.signal.countdownHz.length - 1, step - 1));
    const freq = AUDIO_TUNING.signal.countdownHz[index];
    const time = now(this.context);
    const osc = makeOscillator(this.context, "square", freq);
    const body = createGain(this.context, 0);
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2200 + step * 240;
    filter.Q.value = 0.7;

    osc.connect(filter);
    filter.connect(body);
    body.connect(this.output);

    body.gain.setValueAtTime(0.0001, time);
    body.gain.linearRampToValueAtTime(0.14, time + 0.01);
    body.gain.exponentialRampToValueAtTime(0.0001, time + AUDIO_TUNING.signal.countdownDuration);
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.92, time + 0.09);

    osc.start(time);
    osc.stop(time + AUDIO_TUNING.signal.countdownDuration + 0.03);
  }

  triggerGoSound() {
    const time = now(this.context);
    const duration = AUDIO_TUNING.signal.goDuration;
    const voices = AUDIO_TUNING.signal.goHz;
    for (let i = 0; i < voices.length; i++) {
      const osc = makeOscillator(this.context, i === 0 ? "square" : "triangle", voices[i]);
      const gain = createGain(this.context, 0);
      const filter = this.context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1400 + i * 260;
      filter.Q.value = 0.8;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.output);

      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.18 - i * 0.05, time + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      setParam(osc.frequency, voices[i], time);
      osc.frequency.exponentialRampToValueAtTime(
        voices[i] * (1.18 + i * 0.04),
        time + duration * 0.65,
      );

      osc.start(time);
      osc.stop(time + duration + 0.04);
    }
  }
}

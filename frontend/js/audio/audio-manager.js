import { EngineSynth } from "./engine-synth.js";
import { ImpactSynth } from "./impact-synth.js";
import { SignalSynth } from "./signal-synth.js";
import { SkidSynth } from "./skid-synth.js";
import { SurfaceSynth } from "./surface-synth.js";
import { AUDIO_TUNING, clamp, createGain, now, smoothParam } from "./shared.js";

const DEFAULT_VEHICLE_STATE = {
  speedNormalized: 0,
  throttle: 0,
  acceleration: 0,
  skidAmount: 0,
  surface: "asphalt",
  isMoving: false,
};

function getAudioContextCtor() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

export class AudioManager {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.vehicleBus = null;
    this.uiBus = null;
    this.impactBus = null;
    this.engineSynth = null;
    this.skidSynth = null;
    this.surfaceSynth = null;
    this.signalSynth = null;
    this.impactSynth = null;
    this.started = false;
    this.userGestureBound = false;
    this.lastVehicleState = { ...DEFAULT_VEHICLE_STATE };
  }

  ensureContext() {
    if (this.context) return this.context;
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) return null;

    this.context = new AudioContextCtor();
    this.masterGain = createGain(this.context, 0);
    this.vehicleBus = createGain(this.context, 0);
    this.uiBus = createGain(this.context, AUDIO_TUNING.uiBusGain);
    this.impactBus = createGain(this.context, AUDIO_TUNING.impactBusGain);

    this.masterGain.connect(this.context.destination);
    this.vehicleBus.connect(this.masterGain);
    this.uiBus.connect(this.masterGain);
    this.impactBus.connect(this.masterGain);

    this.engineSynth = new EngineSynth(this.context);
    this.skidSynth = new SkidSynth(this.context);
    this.surfaceSynth = new SurfaceSynth(this.context);
    this.signalSynth = new SignalSynth(this.context, this.uiBus);
    this.impactSynth = new ImpactSynth(this.context, this.impactBus);

    this.engineSynth.connect(this.vehicleBus);
    this.skidSynth.connect(this.vehicleBus);
    this.surfaceSynth.connect(this.vehicleBus);

    this.engineSynth.start();
    this.skidSynth.start();
    this.surfaceSynth.start();

    return this.context;
  }

  async start() {
    const context = this.ensureContext();
    if (!context) return;
    if (context.state === "suspended") await context.resume();
    this.started = true;
    const time = now(context);
    smoothParam(
      this.masterGain.gain,
      AUDIO_TUNING.masterGain,
      time,
      AUDIO_TUNING.smoothing.medium,
    );
    smoothParam(
      this.vehicleBus.gain,
      AUDIO_TUNING.vehicleBusGain,
      time,
      AUDIO_TUNING.smoothing.medium,
    );
    this.#applyVehicleState(this.lastVehicleState);
  }

  stop() {
    if (!this.context || !this.vehicleBus) return;
    this.started = false;
    const time = now(this.context);
    smoothParam(this.vehicleBus.gain, 0, time, AUDIO_TUNING.smoothing.medium);
    this.#applyVehicleState(DEFAULT_VEHICLE_STATE);
  }

  async resume() {
    const context = this.ensureContext();
    if (!context) return;
    if (context.state === "suspended") await context.resume();
  }

  resumeOnUserGesture(target = window) {
    if (this.userGestureBound || !target) return;
    this.userGestureBound = true;
    const unlock = () => {
      void this.resume();
    };
    target.addEventListener("keydown", unlock, { once: true });
    target.addEventListener("mousedown", unlock, { once: true });
    target.addEventListener("touchstart", unlock, { once: true });
  }

  updateVehicleAudio(params) {
    this.lastVehicleState = {
      ...DEFAULT_VEHICLE_STATE,
      ...params,
    };
    if (!this.context || !this.started) return;
    this.#applyVehicleState(this.lastVehicleState);
  }

  playCountdownBeep(step) {
    if (!this.ensureContext() || !this.signalSynth) return;
    this.signalSynth.triggerCountdownBeep(step);
  }

  playGo() {
    if (!this.ensureContext() || !this.signalSynth) return;
    this.signalSynth.triggerGoSound();
  }

  playTreeBump(intensity) {
    if (!this.ensureContext() || !this.impactSynth) return;
    this.impactSynth.triggerTreeBump(intensity);
  }

  playWallBump(intensity) {
    if (!this.ensureContext() || !this.impactSynth) return;
    this.impactSynth.triggerWallBump(intensity);
  }

  playBarrelBump(intensity) {
    if (!this.ensureContext() || !this.impactSynth) return;
    this.impactSynth.triggerBarrelBump(intensity);
  }

  #applyVehicleState(params) {
    if (!this.context) return;
    const normalized = {
      speedNormalized: clamp(params.speedNormalized, 0, 1),
      throttle: clamp(params.throttle, 0, 1),
      acceleration: clamp(params.acceleration, -1, 1),
      skidAmount: clamp(params.skidAmount, 0, 1),
      surface: params.surface || "asphalt",
      isMoving: Boolean(params.isMoving),
    };
    this.engineSynth.update(normalized);
    this.skidSynth.update(normalized);
    this.surfaceSynth.update(normalized);
  }
}

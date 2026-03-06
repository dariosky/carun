import { state } from "./state.js";

const MENU_MUSIC_SRC = "sounds/menu.mp3";
const MENU_MUSIC_VOLUME = 0.42;
const MENU_MUSIC_FADE_IN_SECONDS = 0.8;
const MENU_MUSIC_FADE_OUT_SECONDS = 0.45;

let menuMusic = null;
let audioUnlocked = false;
let targetMenuMusicActive = false;
let currentFade = null;

function cancelFade() {
  if (currentFade !== null) {
    cancelAnimationFrame(currentFade);
    currentFade = null;
  }
}

function ensureMenuMusic() {
  if (menuMusic) return menuMusic;
  const audio = new Audio(MENU_MUSIC_SRC);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0;
  menuMusic = audio;
  return menuMusic;
}

function fadeMenuMusicTo(targetVolume, durationSeconds, onComplete) {
  const audio = ensureMenuMusic();
  cancelFade();

  const startVolume = audio.volume;
  const clampedTarget = Math.max(0, Math.min(MENU_MUSIC_VOLUME, targetVolume));
  const durationMs = Math.max(0, durationSeconds * 1000);
  if (durationMs === 0 || Math.abs(startVolume - clampedTarget) < 0.001) {
    audio.volume = clampedTarget;
    if (typeof onComplete === "function") onComplete();
    return;
  }

  const startAt = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - startAt) / durationMs);
    audio.volume = startVolume + (clampedTarget - startVolume) * progress;
    if (progress >= 1) {
      currentFade = null;
      if (typeof onComplete === "function") onComplete();
      return;
    }
    currentFade = requestAnimationFrame(tick);
  };

  currentFade = requestAnimationFrame(tick);
}

async function startMenuMusic({ immediate = false } = {}) {
  const audio = ensureMenuMusic();
  try {
    if (audio.paused) {
      audio.currentTime = 0;
      await audio.play();
    }
  } catch {
    return;
  }
  fadeMenuMusicTo(
    MENU_MUSIC_VOLUME,
    immediate ? 0 : MENU_MUSIC_FADE_IN_SECONDS,
  );
}

function stopMenuMusic({ immediate = false } = {}) {
  const audio = ensureMenuMusic();
  fadeMenuMusicTo(0, immediate ? 0 : MENU_MUSIC_FADE_OUT_SECONDS, () => {
    if (targetMenuMusicActive) return;
    audio.pause();
    audio.currentTime = 0;
  });
}

function shouldMenuMusicPlayForMode(mode) {
  return mode !== "racing";
}

export function syncMenuMusicForMode(mode, { immediate = false } = {}) {
  targetMenuMusicActive = shouldMenuMusicPlayForMode(mode);
  if (!audioUnlocked) return;
  if (targetMenuMusicActive) {
    void startMenuMusic({ immediate });
    return;
  }
  stopMenuMusic({ immediate });
}

export async function unlockMenuMusic() {
  audioUnlocked = true;
  if (!targetMenuMusicActive) return;
  await startMenuMusic();
}

export function initAudio() {
  targetMenuMusicActive = shouldMenuMusicPlayForMode(state.mode);
  ensureMenuMusic();
}

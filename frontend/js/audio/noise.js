const noiseCache = new WeakMap();

export function getNoiseBuffer(context) {
  if (noiseCache.has(context)) return noiseCache.get(context);
  const durationSeconds = 2;
  const frameCount = Math.max(1, Math.floor(context.sampleRate * durationSeconds));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    channel[i] = Math.random() * 2 - 1;
  }
  noiseCache.set(context, buffer);
  return buffer;
}

export function createNoiseSource(context) {
  const source = context.createBufferSource();
  source.buffer = getNoiseBuffer(context);
  source.loop = true;
  return source;
}

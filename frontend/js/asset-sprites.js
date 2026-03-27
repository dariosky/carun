const ROOSTER_ATLAS_SRC = "assets/animals/atlases/rooster.png";
const ROOSTER_SHADOW_SRC = "assets/animals/shadows/rooster.png";
const SHEEP_ATLAS_SRC = "assets/animals/atlases/sheep.png";
const SHEEP_SHADOW_SRC = "assets/animals/shadows/sheep.png";

const ASSET_DEFS = {
  rooster: {
    kind: "rooster",
    type: "animal",
    label: "Rooster",
    icon: "R",
    atlasSrc: ROOSTER_ATLAS_SRC,
    shadowSrc: ROOSTER_SHADOW_SRC,
    frameWidth: 32,
    frameHeight: 32,
    columns: 6,
    animations: {
      walk: {
        frameCount: 6,
        frameDuration: 0.15,
      },
      idle: {
        frameCount: 6,
        frameDuration: 0.15,
      },
    },
    defaultRadius: 24,
    rows: {
      walk: {
        front: 0,
        back: 1,
        left: 2,
        right: 3,
      },
      idle: {
        front: 4,
        back: 5,
        left: 6,
        right: 7,
      },
    },
    drawSizeForRadius(radius = 12) {
      return Math.max(22, radius * 2.2);
    },
    shadowSizeForDrawSize(drawSize) {
      return {
        width: drawSize * 0.84,
        height: drawSize * 0.42,
        offsetY: drawSize * 0.18,
      };
    },
  },
  sheep: {
    kind: "sheep",
    type: "animal",
    label: "Sheep",
    icon: "S",
    atlasSrc: SHEEP_ATLAS_SRC,
    shadowSrc: SHEEP_SHADOW_SRC,
    frameWidth: 32,
    frameHeight: 32,
    columns: 6,
    animations: {
      walk: {
        frameCount: 6,
        frameDuration: 0.15,
      },
      idle: {
        frameCount: 4,
        frameDuration: 0.15,
      },
    },
    defaultRadius: 30,
    rows: {
      walk: {
        front: 0,
        back: 1,
        left: 2,
        right: 3,
      },
      idle: {
        front: 4,
        back: 5,
        left: 6,
        right: 7,
      },
    },
    drawSizeForRadius(radius = 16) {
      return Math.max(34, radius * 2.1);
    },
    shadowSizeForDrawSize(drawSize) {
      return {
        width: drawSize * 0.96,
        height: drawSize * 0.78,
        offsetY: drawSize * 0.14,
      };
    },
  },
};

function createTrackedImage(src, label) {
  const image = new Image();
  const tracked = { image, ready: false };
  image.addEventListener("load", () => {
    tracked.ready = true;
  });
  image.addEventListener("error", () => {
    console.warn(`Failed to load ${label} at ${src}`);
  });
  image.src = src;
  return tracked;
}

const trackedAssets = Object.fromEntries(
  Object.values(ASSET_DEFS).map((definition) => [
    definition.kind,
    {
      atlas: createTrackedImage(definition.atlasSrc, `${definition.kind} atlas`),
      shadow: createTrackedImage(definition.shadowSrc, `${definition.kind} shadow`),
    },
  ]),
);

export const DEFAULT_ASSET_KIND = "rooster";

export const ASSET_PLACEABLES = [
  {
    id: "asset-rooster",
    kind: "rooster",
    type: "animal",
    label: "Rooster",
    icon: "R",
  },
  {
    id: "asset-sheep",
    kind: "sheep",
    type: "animal",
    label: "Sheep",
    icon: "S",
  },
];

export function getAssetDefinition(kind = DEFAULT_ASSET_KIND) {
  return ASSET_DEFS[kind] || ASSET_DEFS[DEFAULT_ASSET_KIND];
}

export function getAssetPlaceable(kind = DEFAULT_ASSET_KIND) {
  return ASSET_PLACEABLES.find((asset) => asset.kind === kind) || ASSET_PLACEABLES[0];
}

export function getAnimalSpriteImage(kind = DEFAULT_ASSET_KIND) {
  return (
    trackedAssets[getAssetDefinition(kind).kind]?.atlas.image ||
    trackedAssets[DEFAULT_ASSET_KIND].atlas.image
  );
}

export function getAnimalShadowImage(kind = DEFAULT_ASSET_KIND) {
  return (
    trackedAssets[getAssetDefinition(kind).kind]?.shadow.image ||
    trackedAssets[DEFAULT_ASSET_KIND].shadow.image
  );
}

export function isAnimalSpriteReady(kind = DEFAULT_ASSET_KIND) {
  return Boolean(
    trackedAssets[getAssetDefinition(kind).kind]?.atlas.ready ??
    trackedAssets[DEFAULT_ASSET_KIND].atlas.ready,
  );
}

export function isAnimalShadowReady(kind = DEFAULT_ASSET_KIND) {
  return Boolean(
    trackedAssets[getAssetDefinition(kind).kind]?.shadow.ready ??
    trackedAssets[DEFAULT_ASSET_KIND].shadow.ready,
  );
}

export function getAssetDefaultRadius(kind = DEFAULT_ASSET_KIND) {
  return (
    getAssetDefinition(kind).defaultRadius || getAssetDefinition(DEFAULT_ASSET_KIND).defaultRadius
  );
}

export function getAnimalDrawSize(kind = DEFAULT_ASSET_KIND, radius = 12) {
  const definition = getAssetDefinition(kind);
  return definition.drawSizeForRadius(radius);
}

export function pickAnimalDirection(dx, dy, fallback = "front") {
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "back" : "front";
}

export function getAnimalFrame(kind = DEFAULT_ASSET_KIND, options = {}) {
  const definition = getAssetDefinition(kind);
  const animation = options.animation === "walk" ? "walk" : "idle";
  const direction = definition.rows[animation][options.direction] ? options.direction : "front";
  const clip = definition.animations?.[animation] ||
    definition.animations?.idle || {
      frameCount: 6,
      frameDuration: 0.15,
    };
  const frameCount = Math.max(1, clip.frameCount || 1);
  const frameDuration = clip.frameDuration || 0.15;
  const rawFrameIndex =
    Number.isInteger(options.frameIndex) && options.frameIndex >= 0
      ? options.frameIndex
      : Math.floor(Math.max(0, Number(options.elapsed) || 0) / frameDuration);
  const frameIndex = rawFrameIndex % frameCount;
  const row = definition.rows[animation][direction];
  return {
    animation,
    direction,
    frameIndex,
    frameCount,
    frameDuration,
    sx: frameIndex * definition.frameWidth,
    sy: row * definition.frameHeight,
    sw: definition.frameWidth,
    sh: definition.frameHeight,
  };
}

function drawAnimalPlaceholder(ctx, x, y, drawSize, { opacity = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = "rgba(28, 21, 17, 0.18)";
  ctx.beginPath();
  ctx.ellipse(x, y + drawSize * 0.2, drawSize * 0.34, drawSize * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#b55e1e";
  ctx.beginPath();
  ctx.arc(x, y, drawSize * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f1cc5e";
  ctx.fillRect(x + drawSize * 0.18, y - drawSize * 0.02, drawSize * 0.12, drawSize * 0.08);
  ctx.restore();
}

export function drawAnimalSprite(
  ctx,
  {
    kind = DEFAULT_ASSET_KIND,
    x = 0,
    y = 0,
    radius = 12,
    direction = "front",
    animation = "idle",
    elapsed = 0,
    frameIndex = null,
    opacity = 1,
    shadow = true,
  } = {},
) {
  const definition = getAssetDefinition(kind);
  const atlas = getAnimalSpriteImage(kind);
  const shadowImage = getAnimalShadowImage(kind);
  const drawSize = definition.drawSizeForRadius(radius);
  const frame = getAnimalFrame(kind, {
    animation,
    direction,
    elapsed,
    frameIndex,
  });

  ctx.save();
  const originalSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = opacity;

  if (shadow) {
    const shadowLayout = definition.shadowSizeForDrawSize(drawSize);
    if (isAnimalShadowReady(kind)) {
      ctx.drawImage(
        shadowImage,
        x - shadowLayout.width * 0.5,
        y - shadowLayout.height * 0.5 + shadowLayout.offsetY,
        shadowLayout.width,
        shadowLayout.height,
      );
    } else {
      ctx.fillStyle = "rgba(18, 12, 10, 0.18)";
      ctx.beginPath();
      ctx.ellipse(
        x,
        y + shadowLayout.offsetY,
        shadowLayout.width * 0.46,
        shadowLayout.height * 0.46,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  if (isAnimalSpriteReady(kind)) {
    ctx.drawImage(
      atlas,
      frame.sx,
      frame.sy,
      frame.sw,
      frame.sh,
      x - drawSize * 0.5,
      y - drawSize * 0.5,
      drawSize,
      drawSize,
    );
  } else {
    drawAnimalPlaceholder(ctx, x, y, drawSize, { opacity });
  }

  ctx.imageSmoothingEnabled = originalSmoothing;
  ctx.restore();
  return {
    ...frame,
    drawSize,
  };
}

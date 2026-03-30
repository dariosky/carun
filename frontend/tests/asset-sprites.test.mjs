import test from "node:test";
import assert from "node:assert/strict";

import { setupFrontendTestEnv } from "./helpers/frontend-test-env.mjs";

setupFrontendTestEnv();

const { ASSET_PLACEABLES, getAnimalFrame, pickAnimalDirection } =
  await import("../js/asset-sprites.js");

test("asset placeables expose rooster in the grouped asset list", () => {
  assert.ok(ASSET_PLACEABLES.some((asset) => asset.kind === "rooster"));
  assert.ok(ASSET_PLACEABLES.some((asset) => asset.kind === "sheep"));
  assert.ok(ASSET_PLACEABLES.some((asset) => asset.kind === "bull"));
});

test("rooster atlas frame selection uses stable clip rows and frame counts", () => {
  const idleFront = getAnimalFrame("rooster", {
    animation: "idle",
    direction: "front",
    frameIndex: 3,
  });
  const walkLeft = getAnimalFrame("rooster", {
    animation: "walk",
    direction: "left",
    frameIndex: 4,
  });

  assert.deepEqual(idleFront, {
    animation: "idle",
    direction: "front",
    frameIndex: 3,
    frameCount: 6,
    frameDuration: 0.15,
    sx: 96,
    sy: 128,
    sw: 32,
    sh: 32,
  });
  assert.deepEqual(walkLeft, {
    animation: "walk",
    direction: "left",
    frameIndex: 4,
    frameCount: 6,
    frameDuration: 0.15,
    sx: 128,
    sy: 64,
    sw: 32,
    sh: 32,
  });

  const sheepIdleBack = getAnimalFrame("sheep", {
    animation: "idle",
    direction: "back",
    frameIndex: 2,
  });
  assert.deepEqual(sheepIdleBack, {
    animation: "idle",
    direction: "back",
    frameIndex: 2,
    frameCount: 4,
    frameDuration: 0.15,
    sx: 64,
    sy: 160,
    sw: 32,
    sh: 32,
  });

  const sheepIdleWrapped = getAnimalFrame("sheep", {
    animation: "idle",
    direction: "front",
    frameIndex: 5,
  });
  assert.deepEqual(sheepIdleWrapped, {
    animation: "idle",
    direction: "front",
    frameIndex: 1,
    frameCount: 4,
    frameDuration: 0.15,
    sx: 32,
    sy: 128,
    sw: 32,
    sh: 32,
  });

  const bullWalkLeft = getAnimalFrame("bull", {
    animation: "walk",
    direction: "left",
    frameIndex: 5,
  });
  assert.deepEqual(bullWalkLeft, {
    animation: "walk",
    direction: "left",
    frameIndex: 5,
    frameCount: 6,
    frameDuration: 0.14,
    sx: 320,
    sy: 128,
    sw: 64,
    sh: 64,
  });

  const bullIdleBack = getAnimalFrame("bull", {
    animation: "idle",
    direction: "back",
    frameIndex: 6,
  });
  assert.deepEqual(bullIdleBack, {
    animation: "idle",
    direction: "back",
    frameIndex: 2,
    frameCount: 4,
    frameDuration: 0.18,
    sx: 128,
    sy: 320,
    sw: 64,
    sh: 64,
  });
});

test("animal direction picking favors the dominant movement axis", () => {
  assert.equal(pickAnimalDirection(3, 1), "right");
  assert.equal(pickAnimalDirection(-2, 0.25), "left");
  assert.equal(pickAnimalDirection(0.4, 3), "front");
  assert.equal(pickAnimalDirection(0.2, -4), "back");
});

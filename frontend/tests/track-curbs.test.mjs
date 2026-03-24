import test from "node:test";
import assert from "node:assert/strict";

import {
  curbOuterProbePoint,
  makeIntersectionTrackData,
  makeTrackData,
  nearestDistanceToLoop,
  reverseTrackLoop,
  setupFrontendTestEnv,
} from "./helpers/frontend-test-env.mjs";

setupFrontendTestEnv();

const { initCurbSegments, surfaceAtForTrack } = await import("../js/track.js");
const { measureCurbSupportWidth } = await import("../js/render.js");

test("curb generation keeps striped runs on the outer ring for reversed loops", () => {
  const reversedTrack = reverseTrackLoop(makeTrackData());
  const curbs = initCurbSegments(reversedTrack);

  assert.ok(
    curbs.outer.some((segment) => segment.renderStyle === "striped"),
    "expected outer ring to keep striped curb runs",
  );
  assert.equal(
    curbs.inner.some((segment) => segment.renderStyle === "striped"),
    false,
    "expected inner ring to avoid striped curb runs on reversed loops",
  );
});

test("striped curb outward signs point away from the centerline", () => {
  const tracks = [makeTrackData(), reverseTrackLoop(makeTrackData())];

  for (const trackData of tracks) {
    const curbs = initCurbSegments(trackData);
    const probeDist = Math.max(8, trackData.borderSize * 0.75);
    for (const segment of [...curbs.outer, ...curbs.inner]) {
      if (segment.renderStyle !== "striped") continue;
      const points = segment.points || segment;
      const midIdx = Math.floor(points.length / 2);
      const a = points[Math.max(0, midIdx - 1)];
      const b = points[Math.min(points.length - 1, midIdx)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      const outward = segment.outwardSign ?? 1;
      const outwardPoint = {
        x: mx + nx * probeDist * outward,
        y: my + ny * probeDist * outward,
      };
      const inwardPoint = {
        x: mx - nx * probeDist * outward,
        y: my - ny * probeDist * outward,
      };
      assert.ok(
        nearestDistanceToLoop(outwardPoint, trackData.centerlineLoop) >=
          nearestDistanceToLoop(inwardPoint, trackData.centerlineLoop) - 0.001,
        "expected outwardSign to increase distance from the centerline",
      );
    }
  }
});

test("intersection curbs collapse when the outside of the curb is asphalt", () => {
  const trackData = makeIntersectionTrackData();
  const curbs = initCurbSegments(trackData);
  const asphaltProbeDistance = 4;
  let checked = 0;

  for (const side of ["outer", "inner"]) {
    for (const segment of curbs[side]) {
      if (segment.renderStyle !== "striped") continue;
      const sideSign = segment.outwardSign ?? (side === "outer" ? -1 : 1);
      for (let index = 0; index < segment.points.length; index++) {
        const probe = curbOuterProbePoint(segment.points, index, sideSign, asphaltProbeDistance);
        if (surfaceAtForTrack(probe.x, probe.y, trackData, []) !== "asphalt") continue;
        const supportWidth = measureCurbSupportWidth(
          segment.points,
          index,
          sideSign,
          trackData,
          [],
        );
        assert.equal(
          supportWidth,
          0,
          "expected no curb support when the outward probe lands on asphalt",
        );
        checked += 1;
      }
    }
  }

  assert.ok(
    checked > 0,
    "expected intersecting curve samples with no grass support to collapse curb width",
  );
});

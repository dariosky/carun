import test from "node:test";
import assert from "node:assert/strict";

import { setupFrontendTestEnv } from "./helpers/frontend-test-env.mjs";

setupFrontendTestEnv();

const { getFinishRecordDetail } = await import("../js/render.js");

test("finish overlay detail shows improvement against the previous record", () => {
  assert.equal(
    getFinishRecordDetail({
      rewarded: true,
      improvementMs: 600,
      previousMs: 31_000,
      previousHolder: "LUNA",
    }),
    "-0:00.600 vs LUNA 0:31.000",
  );
});

test("finish overlay detail shows the standing record when no new best is set", () => {
  assert.equal(
    getFinishRecordDetail({
      rewarded: false,
      previousMs: 100_000,
      previousHolder: "MARIO",
    }),
    "RECORD MARIO 1:40.000",
  );
});

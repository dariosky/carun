import test from "node:test";
import assert from "node:assert/strict";

import { setupFrontendTestEnv } from "./helpers/frontend-test-env.mjs";

setupFrontendTestEnv();

const { assignAiRoster, state } = await import("../js/state.js");
const { physicsConfig } = await import("../js/parameters.js");
const { prepareSingleRaceAiRoster } = await import("../js/menus.js");

test("single-race roster prep keeps unique rival colors for editor and track starts", () => {
  physicsConfig.flags.AI_OPPONENTS_ENABLED = true;
  physicsConfig.flags.AI_OPPONENT_COUNT = 5;
  state.gameMode = "single";
  state.playerColor = "crimson";

  assignAiRoster([
    { name: "ONE", color: "mint" },
    { name: "TWO", color: "mint" },
    { name: "THREE", color: "mint" },
    { name: "FOUR", color: "mint" },
    { name: "FIVE", color: "mint" },
  ]);

  const roster = prepareSingleRaceAiRoster();

  assert.equal(roster.length, 5);
  assert.ok(roster.every((entry) => entry.color !== state.playerColor));
  assert.equal(new Set(roster.map((entry) => entry.color)).size, roster.length);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  makeTrackData,
  setupFrontendTestEnv,
} from "./helpers/frontend-test-env.mjs";

setupFrontendTestEnv();

const { state } = await import("../js/state.js");
const {
  getTrackPreset,
  importTrackPresetData,
  regenerateTrackFromCenterlineStrokes,
  removeTrackPresetById,
  trackOptions,
} = await import("../js/parameters.js");
const { getTrackWorldScale } = await import("../js/track.js");
const {
  enterEditor,
  getEditorToolbarLayout,
  promptClearEditorTrackRecords,
  promptClearSelectedTrackRecords,
} = await import("../js/menus.js");

test("regenerateTrackFromCenterlineStrokes keeps width profile aligned to stroke order", () => {
  const imported = importTrackPresetData({
    id: "width-align-local",
    name: "WIDTH ALIGN",
    source: "user",
    ownerUserId: "user-1",
    isPublished: false,
    canDelete: false,
    fromDb: false,
    track: makeTrackData({ centerlineSmoothingMode: "raw" }),
    checkpoints: [],
    worldObjects: [],
    centerlineStrokes: [
      [
        { x: 100, y: 100, halfWidth: 44 },
        { x: 200, y: 100, halfWidth: 44 },
        { x: 300, y: 100, halfWidth: 44 },
      ],
      [
        { x: 300, y: 220, halfWidth: 64 },
        { x: 300, y: 320, halfWidth: 64 },
        { x: 300, y: 420, halfWidth: 64 },
      ],
      [
        { x: 180, y: 420, halfWidth: 32 },
        { x: 80, y: 420, halfWidth: 32 },
        { x: 20, y: 360, halfWidth: 32 },
      ],
      [
        { x: 20, y: 260, halfWidth: 52 },
        { x: 60, y: 180, halfWidth: 52 },
        { x: 100, y: 100, halfWidth: 52 },
      ],
    ],
    editStack: [
      { kind: "stroke", strokeIndex: 0 },
      { kind: "stroke", strokeIndex: 1 },
      { kind: "stroke", strokeIndex: 2 },
      { kind: "stroke", strokeIndex: 3 },
    ],
  });
  assert.ok(imported);

  const trackIndex = trackOptions.findIndex(
    (track) => track.id === imported.id,
  );
  assert.ok(trackIndex >= 0);
  assert.equal(regenerateTrackFromCenterlineStrokes(trackIndex), true);

  const rebuilt = getTrackPreset(trackIndex);
  assert.ok(rebuilt.track.centerlineWidthProfile.length > 0);
  assert.ok(Math.abs(rebuilt.track.centerlineWidthProfile[0] - 44) < 4);

  removeTrackPresetById(imported.id, { removePersisted: false });
});

test("editor clear-records command opens confirmation and clears stored best times", async () => {
  const writes = [];
  const originalSetItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (key, value) => {
    writes.push({ key, value });
  };

  try {
    const imported = importTrackPresetData({
      id: "clear-records-local",
      name: "CLEAR RECORDS",
      source: "user",
      ownerUserId: "user-1",
      isPublished: false,
      canDelete: false,
      fromDb: false,
      bestLapMs: 41_250,
      bestLapDisplayName: "LUNA",
      bestRaceMs: 132_900,
      bestRaceDisplayName: "MARIO",
      track: makeTrackData(),
      checkpoints: [],
      worldObjects: [],
      centerlineStrokes: [],
      editStack: [],
    });
    assert.ok(imported);

    const trackIndex = trackOptions.findIndex(
      (track) => track.id === imported.id,
    );
    assert.ok(trackIndex >= 0);
    enterEditor(trackIndex);

    assert.equal(promptClearEditorTrackRecords(), true);
    assert.equal(state.modal.open, true);
    assert.equal(state.modal.title, "Clear Records");
    assert.equal(state.modal.confirmLabel, "Clear");
    assert.equal(typeof state.modal.onConfirm, "function");

    await state.modal.onConfirm();

    const updated = getTrackPreset(trackIndex);
    assert.equal(updated.bestLapMs, null);
    assert.equal(updated.bestLapDisplayName, null);
    assert.equal(updated.bestRaceMs, null);
    assert.equal(updated.bestRaceDisplayName, null);
    assert.ok(writes.length > 0);
    assert.match(writes[writes.length - 1].value, /"bestLapMs":null/);
    assert.match(writes[writes.length - 1].value, /"bestRaceMs":null/);

    removeTrackPresetById(imported.id, { removePersisted: false });
  } finally {
    globalThis.localStorage.setItem = originalSetItem;
  }
});

test("editor clear-records command calls API for DB-backed tracks", async () => {
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          id: "db-clear-records",
          name: "DB CLEAR",
          source: "user",
          is_published: false,
          owner_user_id: "user-1",
          owner_display_name: "OWNER",
          best_lap_ms: null,
          best_lap_display_name: null,
          best_race_ms: null,
          best_race_display_name: null,
          created_at: "2026-03-22T12:00:00Z",
        };
      },
    };
  };

  try {
    state.auth.userId = "user-1";
    const imported = importTrackPresetData({
      id: "db-clear-records",
      name: "DB CLEAR",
      source: "user",
      ownerUserId: "user-1",
      isPublished: false,
      canDelete: true,
      fromDb: true,
      bestLapMs: 41_250,
      bestLapDisplayName: "LUNA",
      bestRaceMs: 132_900,
      bestRaceDisplayName: "MARIO",
      track: makeTrackData(),
      checkpoints: [],
      worldObjects: [],
      centerlineStrokes: [],
      editStack: [],
    });
    assert.ok(imported);

    const trackIndex = trackOptions.findIndex(
      (track) => track.id === imported.id,
    );
    assert.ok(trackIndex >= 0);
    enterEditor(trackIndex);

    assert.equal(promptClearEditorTrackRecords(), true);
    await state.modal.onConfirm();

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "/api/tracks/db-clear-records/records");
    assert.equal(fetchCalls[0].options.method, "DELETE");

    const updated = getTrackPreset(trackIndex);
    assert.equal(updated.bestLapMs, null);
    assert.equal(updated.bestLapDisplayName, null);
    assert.equal(updated.bestRaceMs, null);
    assert.equal(updated.bestRaceDisplayName, null);
    removeTrackPresetById(imported.id, { removePersisted: false });
  } finally {
    globalThis.fetch = originalFetch;
    state.auth.userId = null;
    state.auth.isAdmin = false;
  }
});

test("track selector clear-records command opens confirmation and clears stored best times", async () => {
  const writes = [];
  const originalSetItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (key, value) => {
    writes.push({ key, value });
  };

  try {
    const imported = importTrackPresetData({
      id: "clear-records-track-select",
      name: "TRACK SELECT CLEAR",
      source: "user",
      ownerUserId: "user-1",
      isPublished: false,
      canDelete: false,
      fromDb: false,
      bestLapMs: 39_500,
      bestLapDisplayName: "LUNA",
      bestRaceMs: 128_900,
      bestRaceDisplayName: "MARIO",
      track: makeTrackData(),
      checkpoints: [],
      worldObjects: [],
      centerlineStrokes: [],
      editStack: [],
    });
    assert.ok(imported);

    const trackIndex = trackOptions.findIndex(
      (track) => track.id === imported.id,
    );
    assert.ok(trackIndex >= 0);

    state.mode = "trackSelect";
    state.trackSelectIndex = trackIndex;

    assert.equal(promptClearSelectedTrackRecords(), true);
    assert.equal(state.modal.open, true);
    assert.equal(state.modal.title, "Clear Records");
    assert.equal(state.modal.confirmLabel, "Clear");
    assert.equal(typeof state.modal.onConfirm, "function");

    await state.modal.onConfirm();

    const updated = getTrackPreset(trackIndex);
    assert.equal(updated.bestLapMs, null);
    assert.equal(updated.bestLapDisplayName, null);
    assert.equal(updated.bestRaceMs, null);
    assert.equal(updated.bestRaceDisplayName, null);
    assert.ok(writes.length > 0);
    assert.match(writes[writes.length - 1].value, /"bestLapMs":null/);
    assert.match(writes[writes.length - 1].value, /"bestRaceMs":null/);

    removeTrackPresetById(imported.id, { removePersisted: false });
  } finally {
    globalThis.localStorage.setItem = originalSetItem;
  }
});

test("editor toolbar exposes a pan toggle and track zoom can clamp to 25 percent", () => {
  const imported = importTrackPresetData({
    id: "editor-pan-layout",
    name: "EDITOR PAN",
    source: "user",
    ownerUserId: "user-1",
    isPublished: false,
    canDelete: false,
    fromDb: false,
    track: makeTrackData({ worldScale: 0.1 }),
    checkpoints: [],
    worldObjects: [],
    centerlineStrokes: [],
    editStack: [],
  });
  assert.ok(imported);

  const trackIndex = trackOptions.findIndex(
    (track) => track.id === imported.id,
  );
  assert.ok(trackIndex >= 0);
  enterEditor(trackIndex);

  const layout = getEditorToolbarLayout();
  assert.equal(layout.panToggle.id, "togglePan");
  assert.ok(layout.panToggle.width > 0);
  assert.equal(getTrackWorldScale(getTrackPreset(trackIndex).track), 0.25);

  removeTrackPresetById(imported.id, { removePersisted: false });
});

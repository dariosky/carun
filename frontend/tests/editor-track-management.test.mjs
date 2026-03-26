import test from "node:test";
import assert from "node:assert/strict";

import { makeTrackData, setupFrontendTestEnv } from "./helpers/frontend-test-env.mjs";

setupFrontendTestEnv();

const { skidMarks, state } = await import("../js/state.js");
const {
  getTrackPreset,
  importTrackPresetData,
  regenerateTrackFromCenterlineStrokes,
  removeTrackPresetById,
  trackOptions,
} = await import("../js/parameters.js");
const { getRaceWorldScale, getTrackWorldScale } = await import("../js/track.js");
const { getRaceCameraState } = await import("../js/render.js");
const {
  enterEditor,
  getEditorToolbarLayout,
  panEditorViewBy,
  promptClearEditorTrackRecords,
  promptClearSelectedTrackRecords,
  updateEditorCursorFromScreen,
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

  const trackIndex = trackOptions.findIndex((track) => track.id === imported.id);
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

    const trackIndex = trackOptions.findIndex((track) => track.id === imported.id);
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

    const trackIndex = trackOptions.findIndex((track) => track.id === imported.id);
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

    const trackIndex = trackOptions.findIndex((track) => track.id === imported.id);
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

test("editor toolbar exposes a pan toggle and track zoom can clamp to 10 percent", () => {
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

  const trackIndex = trackOptions.findIndex((track) => track.id === imported.id);
  assert.ok(trackIndex >= 0);
  enterEditor(trackIndex);

  const layout = getEditorToolbarLayout();
  assert.equal(layout.panToggle.id, "togglePan");
  assert.ok(layout.panToggle.width > 0);
  assert.equal(getTrackWorldScale(getTrackPreset(trackIndex).track), 0.1);
  assert.equal(getRaceWorldScale(getTrackPreset(trackIndex).track), 0.5);

  removeTrackPresetById(imported.id, { removePersisted: false });
});

test("editor pan moves the viewport without mutating track geometry", () => {
  const imported = importTrackPresetData({
    id: "editor-camera-pan",
    name: "EDITOR CAMERA PAN",
    source: "user",
    ownerUserId: "user-1",
    isPublished: false,
    canDelete: false,
    fromDb: false,
    track: makeTrackData({ worldScale: 0.1 }),
    checkpoints: [],
    worldObjects: [{ type: "tree", x: 520, y: 310, r: 24, angle: 0, height: 3 }],
    centerlineStrokes: [],
    editStack: [],
  });
  assert.ok(imported);

  const trackIndex = trackOptions.findIndex((track) => track.id === imported.id);
  assert.ok(trackIndex >= 0);
  enterEditor(trackIndex);

  const preset = getTrackPreset(trackIndex);
  const beforeCenter = { x: preset.track.cx, y: preset.track.cy };
  const beforeLoopPoint = { ...preset.track.centerlineLoop[0] };
  const beforeObject = { ...preset.worldObjects[0] };

  panEditorViewBy(120, -80);

  assert.equal(state.editor.viewOffsetX, 120);
  assert.equal(state.editor.viewOffsetY, -80);
  assert.equal(preset.track.editorViewOffsetX, 120);
  assert.equal(preset.track.editorViewOffsetY, -80);
  assert.deepEqual({ x: preset.track.cx, y: preset.track.cy }, beforeCenter);
  assert.deepEqual(preset.track.centerlineLoop[0], beforeLoopPoint);
  assert.deepEqual(preset.worldObjects[0], beforeObject);

  updateEditorCursorFromScreen(640, 360);
  assert.equal(state.editor.cursorX, 640 + (640 - 120 - preset.track.cx) / 0.1);
  assert.equal(state.editor.cursorY, 360 + (360 + 80 - preset.track.cy) / 0.1);

  removeTrackPresetById(imported.id, { removePersisted: false });
});

test("race camera preserves editor pan when zoom is at or above fifty percent", () => {
  const imported = importTrackPresetData({
    id: "editor-camera-race-pan",
    name: "EDITOR CAMERA RACE PAN",
    source: "user",
    ownerUserId: "user-1",
    isPublished: false,
    canDelete: false,
    fromDb: false,
    track: makeTrackData({ worldScale: 0.6 }),
    checkpoints: [],
    worldObjects: [],
    centerlineStrokes: [],
    editStack: [],
  });
  assert.ok(imported);

  const trackIndex = trackOptions.findIndex((track) => track.id === imported.id);
  assert.ok(trackIndex >= 0);
  enterEditor(trackIndex);
  panEditorViewBy(120, -80);

  const preset = getTrackPreset(trackIndex);
  const camera = getRaceCameraState(preset.track);
  assert.equal(camera.scrolling, false);
  assert.equal(camera.worldScale, 0.6);
  assert.equal(camera.viewOffsetX, 120);
  assert.equal(camera.viewOffsetY, -80);

  removeTrackPresetById(imported.id, { removePersisted: false });
});

test("entering the editor restores the pan stored on the track", () => {
  const imported = importTrackPresetData({
    id: "editor-camera-track-pan",
    name: "EDITOR CAMERA TRACK PAN",
    source: "user",
    ownerUserId: "user-1",
    isPublished: false,
    canDelete: false,
    fromDb: false,
    track: makeTrackData({ worldScale: 0.6, editorViewOffsetX: 135, editorViewOffsetY: -70 }),
    checkpoints: [],
    worldObjects: [],
    centerlineStrokes: [],
    editStack: [],
  });
  assert.ok(imported);

  const trackIndex = trackOptions.findIndex((track) => track.id === imported.id);
  assert.ok(trackIndex >= 0);
  enterEditor(trackIndex);

  assert.equal(state.editor.viewOffsetX, 135);
  assert.equal(state.editor.viewOffsetY, -70);

  removeTrackPresetById(imported.id, { removePersisted: false });
});

test("entering the editor clears transient skid marks", () => {
  const imported = importTrackPresetData({
    id: "editor-clear-skids",
    name: "EDITOR CLEAR SKIDS",
    source: "user",
    ownerUserId: "user-1",
    isPublished: false,
    canDelete: false,
    fromDb: false,
    track: makeTrackData(),
    checkpoints: [],
    worldObjects: [],
    centerlineStrokes: [],
    editStack: [],
  });
  assert.ok(imported);

  const trackIndex = trackOptions.findIndex((track) => track.id === imported.id);
  assert.ok(trackIndex >= 0);
  skidMarks.push({
    points: [
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ],
    width: 4,
    life: 1,
    color: "#000",
  });
  state.tournamentRoom.pendingSkidMarks.push({ x1: 0, y1: 0, x2: 1, y2: 1 });

  enterEditor(trackIndex);

  assert.equal(skidMarks.length, 0);
  assert.equal(state.tournamentRoom.pendingSkidMarks.length, 0);

  removeTrackPresetById(imported.id, { removePersisted: false });
});

test("editor toolbar exposes oil placement and preserves imported oil blobs", () => {
  const imported = importTrackPresetData({
    id: "editor-oil-layout",
    name: "EDITOR OIL",
    source: "user",
    ownerUserId: "user-1",
    isPublished: false,
    canDelete: false,
    fromDb: false,
    track: makeTrackData(),
    checkpoints: [],
    worldObjects: [
      {
        type: "oil",
        x: 520,
        y: 310,
        rx: 84,
        ry: 36,
        angle: Math.PI / 8,
        seed: 0.35,
      },
    ],
    centerlineStrokes: [],
    editStack: [],
  });
  assert.ok(imported);

  const trackIndex = trackOptions.findIndex((track) => track.id === imported.id);
  assert.ok(trackIndex >= 0);
  enterEditor(trackIndex);

  const layout = getEditorToolbarLayout();
  assert.ok(layout.objectToolButtons.some((button) => button.id === "oil"));

  const preset = getTrackPreset(trackIndex);
  assert.equal(preset.worldObjects[0]?.type, "oil");
  assert.equal(preset.worldObjects[0]?.rx, 84);
  assert.equal(preset.worldObjects[0]?.ry, 36);

  removeTrackPresetById(imported.id, { removePersisted: false });
});

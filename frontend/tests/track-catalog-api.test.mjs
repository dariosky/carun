import test from "node:test";
import assert from "node:assert/strict";

import {
  makeTrackData,
  setupFrontendTestEnv,
} from "./helpers/frontend-test-env.mjs";

setupFrontendTestEnv();

const { state } = await import("../js/state.js");
const {
  canDeleteTrackPreset,
  importTrackPresetData,
  loadVisibleTracksFromApi,
  removeTrackPresetById,
  saveTrackPresetToDb,
  trackOptions,
} = await import("../js/parameters.js");
const { getTrackSelectRenderModel, syncTrackSelectWindow } =
  await import("../js/menus.js");

test("canDeleteTrackPreset allows admins to delete any unpublished db track", () => {
  const currentUserId = "user-1";
  assert.equal(
    canDeleteTrackPreset(
      { fromDb: true, ownerUserId: currentUserId, isPublished: false },
      currentUserId,
    ),
    true,
  );
  assert.equal(
    canDeleteTrackPreset(
      { fromDb: true, ownerUserId: currentUserId, isPublished: true },
      currentUserId,
    ),
    false,
  );
  assert.equal(
    canDeleteTrackPreset(
      { fromDb: true, ownerUserId: "user-2", isPublished: false },
      currentUserId,
    ),
    false,
  );
  assert.equal(
    canDeleteTrackPreset(
      { fromDb: true, ownerUserId: "user-2", isPublished: false },
      currentUserId,
      true,
    ),
    true,
  );
  assert.equal(
    canDeleteTrackPreset(
      { fromDb: false, ownerUserId: currentUserId, isPublished: false },
      currentUserId,
    ),
    false,
  );
});

test("track selector render model windows large catalogs and exposes admin actions", () => {
  const addedIds = [];
  for (let i = 0; i < 5; i++) {
    const imported = importTrackPresetData({
      id: `selector-${i}`,
      name: `SELECTOR ${i}`,
      source: "user",
      ownerUserId: i === 2 ? "admin-1" : "user-2",
      isPublished: i !== 2,
      canDelete: false,
      fromDb: true,
      track: makeTrackData(),
      checkpoints: [],
      worldObjects: [],
      centerlineStrokes: [],
      editStack: [],
    });
    addedIds.push(imported.id);
  }

  state.auth.userId = "admin-1";
  state.auth.isAdmin = true;
  const selector4Index = trackOptions.findIndex(
    (track) => track.id === "selector-4",
  );
  state.trackSelectIndex = selector4Index;
  state.trackSelectViewOffset = 0;

  const model = getTrackSelectRenderModel();
  assert.ok(model.gridCells.length > 0);
  assert.equal(model.totalCount, trackOptions.length);
  assert.equal(model.selectedTrackCanPublish, true);
  assert.equal(model.selectedTrackCanRename, true);
  assert.equal(model.selectedTrackCanDelete, false);

  const selector2Index = trackOptions.findIndex(
    (track) => track.id === "selector-2",
  );
  state.trackSelectIndex = selector2Index;
  const draftModel = getTrackSelectRenderModel();
  assert.equal(draftModel.selectedTrackCanDelete, true);

  for (const id of addedIds)
    removeTrackPresetById(id, { removePersisted: false });
});

test("track selector sync keeps a deep-linked track visible in the grid", () => {
  const addedIds = [];
  for (let i = 0; i < 24; i++) {
    const imported = importTrackPresetData({
      id: `grid-sync-${i}`,
      name: `GRID SYNC ${i}`,
      source: "user",
      ownerUserId: "user-1",
      isPublished: true,
      canDelete: false,
      fromDb: true,
      track: makeTrackData(),
      checkpoints: [],
      worldObjects: [],
      centerlineStrokes: [],
      editStack: [],
    });
    addedIds.push(imported.id);
  }

  const deepLinkedIndex = trackOptions.findIndex(
    (track) => track.id === "grid-sync-23",
  );
  state.trackSelectIndex = deepLinkedIndex;
  state.trackSelectViewOffset = 0;

  syncTrackSelectWindow();
  const model = getTrackSelectRenderModel();
  const selectedColumn = Math.floor(deepLinkedIndex / model.rows);
  const expectedOffset = Math.max(0, selectedColumn - model.visibleColumns + 1);

  assert.equal(model.viewColumnOffset, expectedOffset);
  assert.equal(
    model.gridCells.some((cell) => cell.trackIndex === deepLinkedIndex),
    true,
  );

  for (const id of addedIds)
    removeTrackPresetById(id, { removePersisted: false });
});

test("visible tracks from API replace local presets and keep published flags", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path) => {
    if (path !== "/api/tracks") throw new Error(`Unexpected path: ${path}`);
    return {
      ok: true,
      async json() {
        return [
          {
            id: "11111111-1111-1111-1111-111111111111",
            name: "NEVE 2",
            source: "system",
            is_published: true,
            owner_user_id: null,
            share_token: null,
            created_at: "2026-03-01T00:00:00Z",
            track_payload_json: {
              id: "neve2",
              name: "NEVE 2",
              track: makeTrackData({ cx: 640, cy: 360 }),
              checkpoints: [],
              worldObjects: [],
            },
          },
          {
            id: "22222222-2222-2222-2222-222222222222",
            name: "USER TRACK",
            source: "user",
            is_published: true,
            owner_user_id: "user-1",
            share_token: "abc",
            created_at: "2026-03-01T00:00:00Z",
            track_payload_json: {
              id: "user-track",
              name: "USER TRACK",
              track: makeTrackData({ cx: 630, cy: 350 }),
              checkpoints: [],
              worldObjects: [],
            },
          },
        ];
      },
    };
  };

  try {
    await loadVisibleTracksFromApi({ currentUserId: "user-1" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    trackOptions.some((t) => t.id === "bootstrap"),
    false,
  );
  assert.equal(
    trackOptions.some((t) => t.id === "11111111-1111-1111-1111-111111111111"),
    true,
  );
  assert.equal(
    trackOptions.some((t) => t.id === "22222222-2222-2222-2222-222222222222"),
    true,
  );

  const systemTrack = trackOptions.find(
    (t) => t.id === "11111111-1111-1111-1111-111111111111",
  );
  const userTrack = trackOptions.find(
    (t) => t.id === "22222222-2222-2222-2222-222222222222",
  );
  assert.equal(systemTrack?.isPublished, true);
  assert.equal(userTrack?.isPublished, true);
});

test("saveTrackPresetToDb sends the submitted track name", async () => {
  const imported = importTrackPresetData({
    id: "save-name-local",
    name: "OLD NAME",
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

  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (path, options = {}) => {
    if (path !== "/api/tracks") throw new Error(`Unexpected path: ${path}`);
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          id: "33333333-3333-3333-3333-333333333333",
          name: requestBody.name,
          source: "user",
          owner_user_id: "user-1",
          owner_display_name: "USER 1",
          best_lap_ms: null,
          best_lap_display_name: null,
          best_race_ms: null,
          best_race_display_name: null,
          is_published: false,
          share_token: null,
        };
      },
    };
  };

  try {
    const saved = await saveTrackPresetToDb(
      trackOptions.findIndex((track) => track.id === "save-name-local"),
      {
        currentUserId: "user-1",
        name: "NEW NAME",
      },
    );
    assert.equal(requestBody?.name, "NEW NAME");
    assert.equal(saved?.name, "NEW NAME");
  } finally {
    globalThis.fetch = originalFetch;
    removeTrackPresetById("save-name-local", { removePersisted: false });
    removeTrackPresetById("33333333-3333-3333-3333-333333333333", {
      removePersisted: false,
    });
  }
});

test("saveTrackPresetToDb updates existing db tracks instead of creating duplicates", async () => {
  const imported = importTrackPresetData({
    id: "44444444-4444-4444-4444-444444444444",
    name: "EXISTING TRACK",
    source: "user",
    ownerUserId: "user-1",
    isPublished: false,
    canDelete: true,
    fromDb: true,
    track: makeTrackData(),
    checkpoints: [],
    worldObjects: [],
    centerlineStrokes: [],
    editStack: [],
  });
  assert.ok(imported);

  const originalFetch = globalThis.fetch;
  let requestPath = null;
  let requestMethod = null;
  let requestBody = null;
  globalThis.fetch = async (path, options = {}) => {
    requestPath = path;
    requestMethod = options.method;
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          id: "44444444-4444-4444-4444-444444444444",
          name: requestBody.name,
          source: "user",
          owner_user_id: "user-1",
          owner_display_name: "USER 1",
          best_lap_ms: null,
          best_lap_display_name: null,
          best_race_ms: null,
          best_race_display_name: null,
          is_published: false,
          share_token: null,
        };
      },
    };
  };

  try {
    const saved = await saveTrackPresetToDb(
      trackOptions.findIndex(
        (track) => track.id === "44444444-4444-4444-4444-444444444444",
      ),
      {
        currentUserId: "user-1",
        name: "UPDATED TRACK",
      },
    );
    assert.equal(
      requestPath,
      "/api/tracks/44444444-4444-4444-4444-444444444444",
    );
    assert.equal(requestMethod, "PATCH");
    assert.equal(requestBody?.name, "UPDATED TRACK");
    assert.equal(saved?.id, "44444444-4444-4444-4444-444444444444");
    assert.equal(saved?.name, "UPDATED TRACK");
  } finally {
    globalThis.fetch = originalFetch;
    removeTrackPresetById("44444444-4444-4444-4444-444444444444", {
      removePersisted: false,
    });
  }
});

import test from "node:test";
import assert from "node:assert/strict";

function setupDomStubs() {
  const noop = () => {};
  const fakeCtx = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    lineWidth: 0,
    globalAlpha: 1,
    save: noop,
    restore: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop,
    measureText: (text) => ({ width: String(text).length * 10 }),
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    clip: noop,
    rect: noop,
    arc: noop,
    translate: noop,
    scale: noop,
    drawImage: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    setLineDash: noop,
  };
  const fakeCanvas = {
    width: 1280,
    height: 720,
    getContext: () => fakeCtx,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1280,
      height: 720,
    }),
  };
  globalThis.window = {
    location: { href: "http://localhost:8080/" },
    history: { replaceState: noop },
    addEventListener: noop,
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = noop;
  globalThis.localStorage = {
    getItem: () => null,
    setItem: noop,
  };
  globalThis.document = {
    getElementById: () => fakeCanvas,
    createElement: () => fakeCanvas,
  };
  globalThis.Image = class {
    addEventListener() {}
    set src(_) {}
  };
  globalThis.Audio = class {
    constructor() {
      this.loop = false;
      this.preload = "";
      this.volume = 0;
      this.paused = true;
      this.currentTime = 0;
      this.muted = false;
    }
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  };
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return fakeCtx;
    }
  };
}

setupDomStubs();

const { assignAiRoster, keys, state } = await import("../js/state.js");
const {
  canDeleteTrackPreset,
  getTrackPreset,
  importTrackPresetData,
  loadVisibleTracksFromApi,
  physicsConfig,
  regenerateTrackFromCenterlineStrokes,
  removeTrackPresetById,
  saveTrackPresetToDb,
  trackOptions,
} = await import("../js/parameters.js");
const {
  enterEditor,
  getEditorToolbarLayout,
  getLoginProviderRenderModel,
  getMainMenuRenderModel,
  pauseActiveRace,
  prepareSingleRaceAiRoster,
  promptClearEditorTrackRecords,
  getSettingsRenderLayout,
  getSettingsHeaderRenderModel,
  getTrackSelectRenderModel,
  syncTrackSelectWindow,
} = await import("../js/menus.js");
const { getTrackWorldScale, initCurbSegments, surfaceAtForTrack } =
  await import("../js/track.js");
const { measureCurbSupportWidth } = await import("../js/render.js");

function makeTrackData({
  cx = 640,
  cy = 360,
  halfWidth = 60,
  borderSize = 22,
  worldScale = 1,
  centerlineSmoothingMode = "light",
} = {}) {
  return {
    cx,
    cy,
    borderSize,
    centerlineHalfWidth: halfWidth,
    centerlineWidthProfile: new Array(8).fill(halfWidth),
    centerlineSmoothingMode,
    worldScale,
    startAngle: 0,
    centerlineLoop: [
      { x: cx - 220, y: cy - 120 },
      { x: cx - 80, y: cy - 180 },
      { x: cx + 90, y: cy - 170 },
      { x: cx + 210, y: cy - 70 },
      { x: cx + 220, y: cy + 120 },
      { x: cx + 80, y: cy + 180 },
      { x: cx - 90, y: cy + 170 },
      { x: cx - 210, y: cy + 70 },
    ],
  };
}

function reverseTrackLoop(trackData) {
  return {
    ...trackData,
    centerlineLoop: [...trackData.centerlineLoop].reverse(),
    centerlineWidthProfile: [...trackData.centerlineWidthProfile],
  };
}

function makeIntersectionTrackData() {
  return {
    cx: 640,
    cy: 360,
    borderSize: 22,
    centerlineHalfWidth: 58,
    centerlineWidthProfile: new Array(8).fill(58),
    centerlineSmoothingMode: "light",
    worldScale: 1,
    startAngle: 0,
    centerlineLoop: [
      { x: 340, y: 210 },
      { x: 560, y: 320 },
      { x: 870, y: 210 },
      { x: 760, y: 360 },
      { x: 870, y: 510 },
      { x: 560, y: 400 },
      { x: 340, y: 510 },
      { x: 450, y: 360 },
    ],
  };
}

function curbOuterProbePoint(points, index, sideSign, width) {
  const point = points[index];
  let nx = 0;
  let ny = 0;
  if (index > 0) {
    const dx = point.x - points[index - 1].x;
    const dy = point.y - points[index - 1].y;
    const len = Math.hypot(dx, dy) || 1;
    nx -= dy / len;
    ny += dx / len;
  }
  if (index < points.length - 1) {
    const dx = points[index + 1].x - point.x;
    const dy = points[index + 1].y - point.y;
    const len = Math.hypot(dx, dy) || 1;
    nx -= dy / len;
    ny += dx / len;
  }
  const nlen = Math.hypot(nx, ny) || 1;
  return {
    x: point.x + (nx / nlen) * sideSign * width,
    y: point.y + (ny / nlen) * sideSign * width,
  };
}

test("main menu model switches items by auth state", () => {
  state.auth.authenticated = false;
  state.menuIndex = 1;
  const loggedOut = getMainMenuRenderModel((text) => text.length * 10);
  assert.deepEqual(loggedOut.menuItems, [
    "LOGIN",
    "RACE ANONYMOUSLY",
    "SETTINGS",
  ]);
  assert.equal(loggedOut.selectedMenuIndex, 1);

  state.auth.authenticated = true;
  state.menuIndex = 0;
  const loggedIn = getMainMenuRenderModel((text) => text.length * 10);
  assert.deepEqual(loggedIn.menuItems, ["RACE", "SETTINGS"]);
  assert.equal(loggedIn.selectedMenuIndex, 0);
});

test("main menu highlight width grows for longest label", () => {
  state.auth.authenticated = false;
  const model = getMainMenuRenderModel((text) => text.length * 10);
  // "RACE ANONYMOUSLY" = 16 chars => 160 + 96 padding.
  assert.equal(model.highlightWidth, 256 > 460 ? 256 : 460);

  const widerModel = getMainMenuRenderModel((text) =>
    text === "RACE ANONYMOUSLY" ? 500 : text.length * 10,
  );
  assert.equal(widerModel.highlightWidth, 596);
});

test("login providers model exposes provider options and selected row", () => {
  state.loginProviderIndex = 1;
  const model = getLoginProviderRenderModel((text) => text.length * 10);
  assert.deepEqual(model.loginItems, [
    "LOGIN WITH GOOGLE",
    "LOGIN WITH FACEBOOK",
    "BACK",
  ]);
  assert.equal(model.selectedLoginIndex, 1);
  assert.equal(
    model.highlightWidth,
    Math.max(540, "LOGIN WITH FACEBOOK".length * 10 + 120),
  );
});

test("settings render layout uses longest rendered row label", () => {
  state.auth.authenticated = true;
  state.playerName = "SUPERLONGNAME";
  state.playerColor = "sky";
  state.editingName = false;
  physicsConfig.flags.AI_OPPONENTS_ENABLED = true;
  physicsConfig.flags.AI_OPPONENT_COUNT = 3;
  physicsConfig.flags.DEBUG_MODE = true;

  const layout = getSettingsRenderLayout((text) => text.length * 10);
  assert.deepEqual(layout.settingsItems, [
    "PLAYER NAME",
    "PLAYER COLOR",
    "MENU MUSIC",
    "AI OPPONENTS",
    "DEBUG MODE",
    "LOGOUT",
    "BACK",
  ]);
  assert.equal(layout.rowGap, 56);
  assert.equal(layout.startY, 314);

  const longestRow = "PLAYER NAME: SUPERLONGNAME";
  const expected = Math.max(720, longestRow.length * 10 + 92);
  assert.equal(layout.highlightWidth, expected);
});

test("settings render layout shows AI count even when AI are disabled", () => {
  state.auth.authenticated = false;
  state.playerColor = "mint";
  physicsConfig.flags.AI_OPPONENTS_ENABLED = false;
  physicsConfig.flags.AI_OPPONENT_COUNT = 4;

  const layout = getSettingsRenderLayout((text) => text.length * 10);
  assert.deepEqual(layout.settingsItems, [
    "PLAYER NAME",
    "PLAYER COLOR",
    "MENU MUSIC",
    "AI OPPONENTS",
    "DEBUG MODE",
    "BACK",
  ]);
  assert.equal(layout.rowLabels[1], "PLAYER COLOR: MINT");
  assert.equal(layout.rowLabels[3], "AI OPPONENTS: 4 (AI OFF)");
});

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
        const probe = curbOuterProbePoint(
          segment.points,
          index,
          sideSign,
          asphaltProbeDistance,
        );
        if (surfaceAtForTrack(probe.x, probe.y, trackData, []) !== "asphalt")
          continue;
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

test("settings header model defines centered title", () => {
  const header = getSettingsHeaderRenderModel();
  assert.equal(header.text, "SETTINGS");
  assert.equal(header.textAlign, "center");
  assert.equal(header.xRatio, 0.5);
});

test("pauseActiveRace pauses a local race and clears held inputs", () => {
  state.mode = "racing";
  state.paused = false;
  state.pauseMenuIndex = 1;
  state.tournamentRoom.active = false;
  keys.accel = true;
  keys.left = true;
  keys.handbrake = true;

  const paused = pauseActiveRace();

  assert.equal(paused, true);
  assert.equal(state.paused, true);
  assert.equal(state.pauseMenuIndex, 0);
  assert.equal(keys.accel, false);
  assert.equal(keys.left, false);
  assert.equal(keys.handbrake, false);
});

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

  // Grid model exposes cells rather than flat visibleTracks
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

test("editor clear-records command opens confirmation and clears stored best times", () => {
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

    state.modal.onConfirm();

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

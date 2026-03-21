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
    shadowColor: "",
    shadowBlur: 0,
    save: noop,
    restore: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fillText: noop,
    measureText: (text) => ({ width: String(text).length * 10 }),
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    clip: noop,
    rect: noop,
    arc: noop,
    ellipse: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    drawImage: noop,
    roundRect: noop,
    quadraticCurveTo: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    setLineDash: noop,
    fill: noop,
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

const {
  applyTrackPreset,
  checkpoints,
  importTrackPresetData,
  physicsConfig,
  removeTrackPresetById,
  trackOptions,
} = await import("../js/parameters.js");
const {
  aiCar,
  aiCars,
  aiLapData,
  aiLapDataList,
  assignAiRoster,
  car,
  lapData,
  state,
} = await import("../js/state.js");
const { getRacePosition, getRaceStandings, resetRace } =
  await import("../js/physics.js");
const { checkpointProgress, trackFrameAtProgress } =
  await import("../js/track.js");

function enableAiOpponents() {
  physicsConfig.flags.AI_OPPONENTS_ENABLED = true;
  physicsConfig.flags.AI_OPPONENT_COUNT = aiCars.length;
  if (state.aiRoster.length !== aiCars.length) assignAiRoster();
}

function makeRacePositionTrackData() {
  return {
    cx: 640,
    cy: 360,
    borderSize: 22,
    centerlineHalfWidth: 60,
    centerlineWidthProfile: new Array(8).fill(60),
    centerlineSmoothingMode: "light",
    worldScale: 1,
    startAngle: 0,
    centerlineLoop: [
      { x: 260, y: 240 },
      { x: 450, y: 150 },
      { x: 850, y: 150 },
      { x: 1020, y: 280 },
      { x: 1020, y: 510 },
      { x: 840, y: 610 },
      { x: 430, y: 610 },
      { x: 250, y: 480 },
    ],
  };
}

let racePositionPresetCounter = 0;

function withRacePositionTrack(callback) {
  const originalTrackIndex = state.selectedTrackIndex;
  const presetId = `race-position-spec-${racePositionPresetCounter++}`;
  importTrackPresetData(
    {
      id: presetId,
      name: "RACE POSITION SPEC",
      track: makeRacePositionTrackData(),
      checkpoints: [{ progress: 0.2 }, { progress: 0.46 }, { progress: 0.74 }],
      worldObjects: [],
      centerlineStrokes: [],
      editStack: [],
    },
    { persist: false },
  );
  const presetIndex = trackOptions.findIndex(
    (preset) => preset.id === presetId,
  );
  assert.ok(presetIndex >= 0);
  state.selectedTrackIndex = presetIndex;
  applyTrackPreset(presetIndex);
  resetRace();

  try {
    return callback();
  } finally {
    removeTrackPresetById(presetId, { removePersisted: false });
    state.selectedTrackIndex = originalTrackIndex;
    applyTrackPreset(originalTrackIndex);
    resetRace();
  }
}

function wrapProgress(progress) {
  return ((progress % 1) + 1) % 1;
}

function progressDeltaForward(from, to) {
  return wrapProgress(to - from);
}

function interpolateProgressForward(from, to, t) {
  return wrapProgress(from + progressDeltaForward(from, to) * t);
}

function placeVehicleAtProgress(vehicle, progress) {
  const frame = trackFrameAtProgress(progress);
  vehicle.x = frame.point.x;
  vehicle.y = frame.point.y;
}

function setLapState(targetLapData, { lap, passed, nextCheckpointIndex }) {
  targetLapData.lap = lap;
  targetLapData.passed = new Set(passed);
  targetLapData.nextCheckpointIndex = nextCheckpointIndex;
  targetLapData.finished = false;
  targetLapData.finishTime = 0;
  targetLapData.finalPosition = 0;
}

test("race standings rank completed laps ahead of local checkpoint position", () => {
  enableAiOpponents();
  resetRace();
  lapData.lap = 2;
  aiLapData.lap = 1;
  car.x = 120;
  car.y = 120;
  aiCar.x = 640;
  aiCar.y = 360;

  assert.equal(getRacePosition("player"), 1);
  assert.ok(getRacePosition("ai") > 1);
});

test("race standings rank more passed checkpoints ahead of later local segment position", () => {
  enableAiOpponents();
  withRacePositionTrack(() => {
    const checkpoint1 = checkpointProgress(checkpoints[1]);
    const checkpoint2 = checkpointProgress(checkpoints[2]);
    const checkpoint3 = checkpointProgress(checkpoints[3]);

    setLapState(lapData, {
      lap: 1,
      passed: [0, 1, 2],
      nextCheckpointIndex: 3,
    });
    setLapState(aiLapData, {
      lap: 1,
      passed: [0, 1],
      nextCheckpointIndex: 2,
    });

    placeVehicleAtProgress(
      car,
      interpolateProgressForward(checkpoint2, checkpoint3, 0.1),
    );
    placeVehicleAtProgress(
      aiCar,
      interpolateProgressForward(checkpoint1, checkpoint2, 0.95),
    );

    const standings = getRaceStandings();
    assert.equal(standings[0].id, "player");
    assert.equal(getRacePosition("player"), 1);
    assert.ok(getRacePosition("ai") > 1);
  });
});

test("race standings rank same-checkpoint racers by progress through the active segment", () => {
  enableAiOpponents();
  withRacePositionTrack(() => {
    const checkpoint1 = checkpointProgress(checkpoints[1]);
    const checkpoint2 = checkpointProgress(checkpoints[2]);

    setLapState(lapData, {
      lap: 1,
      passed: [0, 1],
      nextCheckpointIndex: 2,
    });
    setLapState(aiLapData, {
      lap: 1,
      passed: [0, 1],
      nextCheckpointIndex: 2,
    });

    placeVehicleAtProgress(
      car,
      interpolateProgressForward(checkpoint1, checkpoint2, 0.8),
    );
    placeVehicleAtProgress(
      aiCar,
      interpolateProgressForward(checkpoint1, checkpoint2, 0.3),
    );

    assert.equal(getRacePosition("player"), 1);
    assert.ok(getRacePosition("ai") > 1);
  });
});

test("race standings handle wraparound progress on the final checkpoint segment", () => {
  enableAiOpponents();
  withRacePositionTrack(() => {
    const startCheckpoint = checkpointProgress(checkpoints[0]);
    const lastCheckpoint = checkpointProgress(checkpoints[3]);

    setLapState(lapData, {
      lap: 1,
      passed: [0, 1, 2, 3],
      nextCheckpointIndex: 0,
    });
    setLapState(aiLapData, {
      lap: 1,
      passed: [0, 1, 2, 3],
      nextCheckpointIndex: 0,
    });

    placeVehicleAtProgress(
      car,
      interpolateProgressForward(lastCheckpoint, startCheckpoint, 0.8),
    );
    placeVehicleAtProgress(
      aiCar,
      interpolateProgressForward(lastCheckpoint, startCheckpoint, 0.2),
    );

    assert.equal(getRacePosition("player"), 1);
    assert.ok(getRacePosition("ai") > 1);
  });
});

test("finish order stays locked once a racer completes the race", () => {
  enableAiOpponents();
  resetRace();
  lapData.finished = true;
  lapData.finishTime = 92;
  lapData.finalPosition = 1;
  state.finished = true;
  state.raceStandings.playerFinishOrder = 1;
  state.raceStandings.finishOrders.player = 1;
  state.raceStandings.finishOrders["ai-1"] = 0;
  state.raceStandings.nextFinishOrder = 2;
  aiLapData.finished = false;
  aiLapData.lap = 3;
  aiCar.x = 900;
  aiCar.y = 220;

  assert.equal(getRacePosition("player"), 1);
  assert.ok(getRacePosition("ai") > 1);

  aiLapData.finished = true;
  aiLapData.finishTime = 97;
  aiLapData.finalPosition = 2;
  state.raceStandings.finishOrders["ai-1"] = 2;

  const standings = getRaceStandings();
  assert.equal(standings[0].id, "player");
  assert.ok(standings.some((entry) => entry.id === "ai-1"));
  assert.equal(getRacePosition("player"), 1);
});

test("finished racers keep their final position while others continue racing", () => {
  enableAiOpponents();
  resetRace();

  lapData.finished = true;
  lapData.finishTime = 90;
  lapData.finalPosition = 2;
  state.raceStandings.playerFinishOrder = 2;
  state.raceStandings.finishOrders.player = 2;

  aiLapDataList[1].finished = true;
  aiLapDataList[1].finishTime = 84;
  aiLapDataList[1].finalPosition = 1;
  state.raceStandings.finishOrders["ai-2"] = 1;
  state.raceStandings.nextFinishOrder = 3;

  aiCars[0].x = 1000;
  aiCars[0].y = 200;
  aiCars[2].x = 1040;
  aiCars[2].y = 220;
  aiCars[3].x = 1080;
  aiCars[3].y = 240;
  aiCars[4].x = 1120;
  aiCars[4].y = 260;

  assert.equal(getRacePosition("ai-2"), 1);
  assert.equal(getRacePosition("player"), 2);

  aiCars[0].x = 400;
  aiCars[0].y = 650;
  aiCars[2].x = 1180;
  aiCars[2].y = 80;
  aiCars[3].x = 640;
  aiCars[3].y = 120;
  aiCars[4].x = 220;
  aiCars[4].y = 620;

  assert.equal(getRacePosition("ai-2"), 1);
  assert.equal(getRacePosition("player"), 2);
});

test("race standings keep a deterministic order for exact active-racer ties", () => {
  enableAiOpponents();
  withRacePositionTrack(() => {
    const checkpoint1 = checkpointProgress(checkpoints[1]);
    const checkpoint2 = checkpointProgress(checkpoints[2]);
    const tiedProgress = interpolateProgressForward(
      checkpoint1,
      checkpoint2,
      0.5,
    );

    setLapState(lapData, {
      lap: 1,
      passed: [0, 1],
      nextCheckpointIndex: 2,
    });
    setLapState(aiLapData, {
      lap: 1,
      passed: [0, 1],
      nextCheckpointIndex: 2,
    });

    placeVehicleAtProgress(car, tiedProgress);
    placeVehicleAtProgress(aiCar, tiedProgress);

    const standings = getRaceStandings();
    assert.equal(standings[0].id, "player");
    assert.equal(standings[1].id, "ai-1");
  });
});

test("race standings include the full five-ai field", () => {
  enableAiOpponents();
  resetRace();

  const standings = getRaceStandings();

  assert.equal(standings.length, 6);
  assert.deepEqual(standings.map((entry) => entry.id).sort(), [
    "ai-1",
    "ai-2",
    "ai-3",
    "ai-4",
    "ai-5",
    "player",
  ]);
});

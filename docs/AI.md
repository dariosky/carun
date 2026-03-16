# AI Racers

This document describes the current AI racer system in CaRun.

## Field Size

- A race can include up to 5 AI opponents plus the human player.
- In single race mode, the AI roster is regenerated when a race starts.
- In tournament mode, one AI roster is generated at tournament start and reused for every race in that tournament.

## Roster Model

Each AI racer has a persistent profile for the current event:

- `name`
- `style`
- `topSpeedMul`
- `laneOffset`

Current styles:

- `precise`
- `long`
- `bump`

## Roster Constraints

Random roster generation follows these rules:

- Exactly 1 `precise` driver is created.
- That `precise` driver always has `topSpeedMul = 1.0`.
- At least 2 `bump` drivers are created.
- Remaining drivers are `long`.
- Names are unique within the generated 5-driver roster.

## Style-Specific Name Pools

`precise` names:

- `Nitro Nick`
- `Drift King`
- `Burnout Ben`
- `Max Oversteer`
- `Lenny Launch`
- `Polly Piston`

`bump` names:

- `Skidmark Steve`
- `Burnout Ben`
- `Bumpy Bumper`
- `Cpt. Sideways`
- `Squeaky Brakes`
- `Greasy Gears`
- `Ollie Oilspill`
- `Crashy Carl`

`long` names:

- `Chuck Chicane`
- `Pete Stop`
- `Turbo Tina`
- `Loopy Lap`

## Driving Parameters

### Top Speed Handicap

- AI target speed is scaled by `topSpeedMul`.
- `topSpeedMul` is in the range `0.80` to `1.00`.
- This is applied through AI target speed selection, not by giving the AI different core car physics.

### Style Behavior

All styles use the same time-based path planner. Personality differences come from target-following and control, not from different planning costs.

`precise`

- Follows the shortest-time planned route to the next checkpoint.
- Uses no lane offset — drives the optimal racing line directly.
- Keeps the default path-following behavior.

`long`

- Uses a persistent lateral lane offset applied to the target preview.
- This makes the car follow a slightly longer line than the optimal route.
- Current random offsets are typically in the `14` to `22` pixel range, left or right.
- The path planner still finds the fastest path; the offset shifts execution.

`bump`

- Reduces normal yielding behavior around nearby rivals.
- Adds steering bias toward close cars to lean into contact.
- Can use small handbrake input in close side-by-side situations.
- Path planning is identical to `precise`; aggression is in control, not route.

## Planning Contract

- The planning destination is always the next unpassed checkpoint.
- **Checkpoints are mandatory waypoints.** The A\* planner must reach the next checkpoint — it cannot skip over it. Junction edges whose forward-progress arc encompasses the goal checkpoint are rejected.
- Replanning does not change the objective to a later checkpoint.
- After reaching the next checkpoint goal window, the AI appends a short continuation so steering remains stable through the gate.
- Solid obstacles are hard blockers.

### Time-Based Path Planning

The A\* planner finds the **fastest path** (minimum travel time) to the next checkpoint, not the shortest geometric distance or the path most aligned with the centerline.

**Edge cost = estimated traversal time:**

```
effectiveSpeed = min(curvatureSpeed, maxCarSpeed × surfaceSpeedRatio)
timeCost = edgeDistance / effectiveSpeed
```

Where `surfaceSpeedRatio` is derived directly from the physics parameters:

| Surface  | engineMul | longDragMul | Speed Ratio |
|----------|-----------|-------------|-------------|
| Asphalt  | 1.00      | 1.00        | 1.000       |
| Curb     | 1.00      | 1.02        | 0.980       |
| Grass    | 0.36      | 2.35        | 0.153       |
| Water    | 0.22      | 3.30        | 0.067       |

This means:
- A 20 px grass shortcut vs. a 200 px asphalt route → grass takes ~0.37 s, asphalt ~0.57 s → **grass wins.**
- A 200 px grass shortcut vs. a 120 px asphalt route → grass takes ~3.73 s, asphalt ~0.34 s → **asphalt wins.**

The planner makes this comparison automatically — no additive penalty tuning needed.

**Admissible heuristic:** Euclidean distance / max speed. This guarantees A\* finds the optimal path.

**No regression penalty.** The only structural constraint is checkpoint-skip rejection. The planner is free to explore edges in any direction; travel-time cost naturally guides it forward.

### Checkpoint-Skip Rejection

When A\* expands a junction edge from node A → B, it computes the forward-progress arc. If any goal checkpoint node's progress value falls inside that arc, the edge is rejected — it would bypass the mandatory checkpoint. This is applied per-query (not at graph construction time) because the active checkpoint changes during the race.

### Surface-Aware Shortcuts

Because edge costs are time-based, grass and water shortcuts are evaluated correctly:
- Short cuts through penalty surfaces **are taken** when they save time.
- Long detours through penalty surfaces **are avoided** because the time cost is enormous.
- No manual tuning of additive penalty weights required — the physics parameters drive the decision.

### Spring / Jump Awareness

Springs affect AI cars exactly like the player:

- **AI spring launching:** `updateAiVehicle` checks `findSpringTrigger` every frame. When an AI car drives over a spring, `launchAiFromSpring` launches it with the same apex height calculation as the player (speed-dependent, capped at `maxJumpHeight`).
- **Airborne physics:** While flying, AI cars use the same reduced-control airborne physics as the player: reduced throttle/brake effect, minimal drag, gravity on z-axis, bounce on landing, and height-aware collision resolution (`aiCar.z` is passed to `resolveObjectCollisions` so flying cars clear low obstacles).
- **Path planning:** Nav nodes near springs get a `nearSpring` flag. Edges from spring nodes use a surface speed ratio of 1.0 (the car will be airborne). This means the planner will route through springs when doing so skips obstacles or penalty surfaces.
- **Runtime bypass:** Sightline and preview-walk checks are bypassed while the AI car is flying, so the car follows its planned path through the air without clamping to ground-level targets.

### Inner-Loop Handling

On tracks with inner loops (each containing a checkpoint), the planner enters each loop only far enough to reach the checkpoint, then exits via the shortest-time path. It does **not** follow the entire loop or the centerline. This falls out naturally from time-based costs — the centerline has no special status.

### Backward Edges (Bidirectional Roads)

Roads are not one-way. The navigation graph includes backward edges (each node connects to the previous slice in the same lane) so the AI can reverse direction when that's faster than completing a full loop:

- **Use case:** AI finishes a checkpoint inside a loop and needs to reach the next checkpoint outside it. With backward edges, it reverses to the junction and exits. Without them, it would repeat the entire loop.
- **Reversal penalty:** Each backward edge carries a 0.35 s time penalty to model braking and re-acceleration. This makes backward paths more expensive per-edge than forward ones, but still far cheaper than a full extra loop.
- **Route builder exclusion:** Backward edges are tagged `kind: "backward"` and are filtered out by the best-lap route builder and the checkpoint continuation walk. Only the A\* pathfinder uses them.

### Checkpoint-Triggered Replanning

When the AI passes a checkpoint and `nextCheckpointIndex` advances, `updateAiRaceControl` detects the mismatch between the current checkpoint target and the plan's `planCheckpointIndex`. This forces an **immediate** replan for the new checkpoint, discarding the old plan's continuation nodes that would lead deeper into the old loop.

## Recovery

Recovery uses a replan-first approach — the reverse-forward wiggle is reserved for genuinely wall-blocked situations:

- **Replan-first:** When the stuck timer fires (low speed + no progress), the AI forces a replan instead of entering recovery. The planner finds the best path from the current position — which may be across more grass, back to road, or through a different route entirely.
- **Reverse-forward recovery:** Only triggers when the car is repeatedly colliding with a wall (`repeatedCollisionTimer >= repeatedCollisionTime`). This is the only case where replanning alone can't help because the car is physically blocked.
- **Off-road timer:** Only accumulates when the car is off-road AND far from its planned path. It compounds the stuck timer slightly faster but never triggers recovery independently. Following a planner-chosen grass shortcut does not contribute.
- **Recovery exit:** The AI exits recovery when making progress at reasonable speed, regardless of surface.
- **Airborne immunity:** Flying cars (after a spring launch) never accumulate stuck or off-road timers.

## Speed Control

`computeAiTargetSpeed` determines how fast the AI should drive. Speed is derived from **actual path geometry**, not from centerline curvature stored on nodes:

- **Path-curvature based:** The function walks the planned path ahead and computes the turning angle between consecutive segments (dot product of direction vectors). On a straight planned path with short segments, the dot product is ~1.0 (no turn) so full speed is maintained — even if the centerline underneath is curved.
- **Blended with centerline curvature:** 50 % of the node's centerline curvature is blended in so the AI still respects tight corners that the planned path can't fully smooth out.
- **Physics-based braking:** Speed limits are back-propagated using `v_allowed = sqrt(v_node² + 2 × brakeDecel × brakingEfficiency × distance)`, so the AI can carry maximum speed into corners while guaranteeing it can brake in time.
- **Result:** On a straight road, AI goes full throttle regardless of how many path nodes it crosses. Speed only drops when the path actually turns.

## Physics Contract

- AI cars use the **exact same** underlying driving model as the player: surface drag, grip, drift, skid marks, collision rules, spring launching, airborne physics, gravity, and landing bounce.
- `resolveObjectCollisions` receives the AI car's actual z-height, so flying AI cars clear low obstacles just like the player.
- AI advantages come from planning and control choices, not hidden grip or acceleration buffs.

## Race Position Rules

- Live race positions are computed from:
  - finished state
  - finish order
  - completed laps
  - lap progress
- Each racer stores a `finalPosition` when they finish.
- That finishing place is frozen immediately and does not change while the rest of the field is still racing.
- The race clock continues running after the player finishes if any AI racers are still active, so AI opponents can still complete laps and finish properly.

## HUD

- AI HUD tiles in the race top bar are sorted by current race position, left to right.
- Each tile shows compact AI information:
  - name
  - position
  - lap
  - best lap

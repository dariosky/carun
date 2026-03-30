# NPCs

This document describes the current ambient NPC system in CaRun.

## Scope

- NPCs are authored ambient animals placed in `worldObjects` through the track editor.
- They are not racers and do not participate in lap logic, checkpoints, or standings.
- Current supported NPC kinds:
  - `rooster`
  - `sheep`
  - `bull`

## Authored Object Format

Ambient NPCs use the shared world-object shape:

```js
{ type: "animal", kind, x, y, r, angle }
```

Fields:

- `kind`: NPC species identifier.
- `x`, `y`: spawn and home position.
- `r`: collision / authored size radius.
- `angle`: initial facing / preferred move direction.

## Runtime Model

Each authored NPC is rebuilt into an ambient runtime actor at race start.

Shared runtime rules:

- Every NPC has a fixed home position based on the authored spawn.
- NPC movement is surface-aware and object-collision-aware.
- Water is always avoided.
- Calm movement stays biased toward preferred terrain.
- Nearby cars can trigger a threat response.
- NPCs render through the shared sprite-atlas path in `frontend/js/asset-sprites.js`.
- Behavior updates live in `frontend/js/ambient-animals.js`.
- Car impact resolution lives in `frontend/js/physics.js`.

Common runtime fields:

- `mode`: current behavior state.
- `modeTimer`: remaining time in the current state.
- `moveAngle`: current travel heading.
- `speed` / `targetSpeed`: current and desired movement speed.
- `homeX`, `homeY`: authored home position.
- `contactCooldown`: short anti-repeat timer after impact.

## Calm Surface Preference

- `rooster`: prefers `grass` and `curb`.
- `sheep`: prefers `grass` and `curb`.
- `bull`: prefers `grass` only.

If an NPC is calm and off its preferred surface, it enters a grass-seeking state to drift back to safer terrain.

## Threat Detection

Threat checks run against the player car and AI racers.

- `rooster` and `sheep` are skittish:
  - immediate nearby cars always scare them.
  - farther cars only count as threats when approaching with enough speed.
  - their response is `flee`.
- `bull` is aggressive:
  - proximity alone is enough to trigger.
  - the car does not need to be approaching quickly.
  - its response is `charge`.

## Per-NPC Behavior

### Rooster

- Small, light, fast-reacting NPC.
- Calm states:
  - idles briefly.
  - wanders often.
  - seeks grass/curb when stranded on harsher terrain.
- Threat response:
  - quickly flees away from the nearest threatening car.
- Collision contract:
  - killable.
  - lightest car slowdown of the three NPCs.
  - produces blood carry / blood splash.
  - plays rooster splash audio.

### Sheep

- Heavier, slower calm movement than rooster.
- Calm states:
  - longer idles.
  - slower wandering.
  - seeks grass/curb when calm and misplaced.
- Threat response:
  - flees rather than attacks.
- Collision contract:
  - killable.
  - stronger slowdown than rooster.
  - produces blood carry / blood splash.
  - plays sheep splash audio.

### Bull

- Large ambient NPC intended to feel territorial rather than skittish.
- Calm states:
  - spends most of its time idling or slowly wandering on grass.
  - if it drifts off grass, it tries to return before settling again.
- Threat response:
  - charges when a car enters its proximity radius.
  - charge speed is higher than any other animal movement mode.
  - after a collision it briefly recoils in `recover`, then can charge again.
- Collision contract:
  - not killable.
  - does not produce blood carry or blood splash.
  - plays `bull-splash.mp4` on collision.
  - hitting a bull shoves the car backward, with stronger knockback when the bull is moving faster.

## Behavior States

Not every NPC uses every state, but the runtime supports these states:

- `idle`: stationary calm state.
- `wander`: short calm roaming.
- `grassSeek`: return-to-preferred-surface state.
- `flee`: skittish escape state used by rooster and sheep.
- `charge`: aggressive pursuit state used by bull.
- `recover`: short post-impact recoil state used by bull.

## Editor Contract

- NPCs are placed from the grouped asset palette in the track editor.
- The palette entries are defined in `frontend/js/asset-sprites.js`.
- Authored NPC size is stored in the same `r` field used by runtime normalization.
- The editor must support larger radii for heavier NPCs like the bull.

## Adding Another NPC

To add a new ambient NPC kind safely:

1. Add sprite/shadow metadata and palette entry in `frontend/js/asset-sprites.js`.
2. Add behavior config and state transitions in `frontend/js/ambient-animals.js`.
3. Define collision behavior in `frontend/js/physics.js`.
4. Add coverage for sprite selection, editor palette presence, runtime rebuild, and collision behavior.
5. Update this document with the new NPC contract.

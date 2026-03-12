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

`precise`

- Follows the shortest / fastest planned route to the next checkpoint.
- Uses no lane offset.
- Keeps the default path-following behavior.

`long`

- Uses a persistent lateral lane offset.
- This makes the car follow a slightly longer line than the fastest route.
- Current random offsets are typically in the `14` to `22` pixel range, left or right.

`bump`

- Reduces normal yielding behavior around nearby rivals.
- Adds steering bias toward close cars to lean into contact.
- Can use small handbrake input in close side-by-side situations.

## Planning Contract

- The planning destination is always the next unpassed checkpoint.
- Replanning does not change the objective to a later checkpoint.
- After reaching the next checkpoint goal window, the AI appends a short continuation so steering remains stable through the gate.
- Solid obstacles are hard blockers.
- Intersections and alternate branches are allowed if they are faster for reaching the next checkpoint.

## Recovery

- Brief grass contact on a valid shortcut should not trigger reverse recovery by itself.
- Recovery is intended for genuinely stuck states: low progress, repeated collisions, or prolonged off-road travel.
- When recovery or replanning happens, the next unpassed checkpoint remains the destination.

## Physics Contract

- AI cars use the same underlying driving model as the player.
- Surface drag, grip, drift, skid marks, and collision rules are shared.
- AI advantages should come from planning and control choices, not hidden grip or acceleration buffs.

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

# AI Planning Notes

This document captures the current planning contract for AI racers in CaRun.

## Core Destination Rule

- The AI planning destination is always the next unpassed checkpoint.
- The destination does not switch to centerline progress, best-lap route, or later checkpoints.
- Hitting an obstacle, touching grass, or replanning after displacement must not change the destination away from that same next checkpoint.

## Path Shape

- The planner should find the fastest valid path to the next checkpoint.
- The path may use shortcuts.
- Asphalt is preferred, but grass is allowed when it is faster.
- Water and solid obstacles are hard blockers.
- The planner should avoid unnecessary long detours and should not bias toward the centerline just for comfort.

## Checkpoint Margin

- The path should not stop exactly at the next checkpoint node.
- After reaching the next checkpoint goal window, the planner should append a short continuation beyond it.
- That continuation exists only to preserve steering/lookahead near the checkpoint.
- The objective still remains the next checkpoint until it is crossed.

## Recovery

- Brief grass contact on a valid shortcut should not trigger reverse recovery.
- Recovery should trigger only when the AI is actually stuck, trapped, blocked, or off the planned corridor for too long.
- When replanning after contact with an obstacle, the destination remains the next unpassed checkpoint.

## Physics

- AI cars use the same driving physics as the player.
- Surface slowdowns, skid marks, and drift/slip behavior should match player physics.
- The AI should not get hidden speed or grip buffs.

## Driving Style

- This is an arcade racer.
- Throttle should be effectively 100% whenever the near-future path allows it.
- Slowing down is acceptable only to take faster lines through real corners or avoid real blockers.
- At intersections, the AI should choose the branch that gives the fastest route to the next checkpoint.

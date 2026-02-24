# AGENTS.md - CaRun Contributor Guide

This file defines implementation rules for human and AI contributors working on CaRun.

## Mission

Deliver a professional-feeling indie arcade racer POC in HTML5 canvas, with strong retro style and fun-first driving.

## Product Requirements (Canonical)

- Game title: `Carun` (project/repo name: `CaRun`)
- Main menu with:
- big start action
- settings page
- Menu navigation with keyboard arrows and `Enter`
- Settings must include player name input; keep architecture open for future options (car selection, etc.)
- First track:
- elliptical base but with irregular/non-perfect boundaries
- gray asphalt drive area
- red/white curb border with more grip
- slower grass zones
- additional irregular details (trees, ponds, props)
- World details should affect driving (friction/top speed/collision behavior)
- Car spawn must be tangent to track direction at race start
- Arcade drifting is required (inertia and lateral slip during fast cornering)
- Race system:
- visible start/finish line
- checkpoints
- lap timing always visible
- previous laps visible
- 3 laps for the current POC
- Entire track must remain visible on screen (no scrolling camera)

## Physics Direction

- Target arcade fun, not realism.
- Keep controls responsive with predictable slide behavior.
- Use surface-dependent parameters (grip, drag, top speed).
- Drift should emerge from lateral velocity + grip blending, not random forces.
- Collisions must be deterministic and easy to tune.

## Rendering Direction

- Retro-inspired, colorful, slightly pixelated presentation.
- Use crisp edges and high contrast for readability.
- Prefer handcrafted irregular shapes over pure geometric primitives.
- Keep UI/HUD legible at a glance during motion.

## Engineering Rules

- Keep code dependency-light (vanilla JS unless explicitly needed).
- Preserve full-track visibility in gameplay scenes.
- Avoid large rewrites without clear gameplay gain.
- Separate concerns where practical:
- input/state flow
- physics/surfaces/collisions
- rendering/HUD
- race progression/timing
- When adding new surfaces/objects, define both:
- visual representation
- physical behavior

## Definition of Done for Gameplay Changes

- Game starts and runs in browser without build tooling.
- Menu and settings remain fully keyboard-operable.
- Lap/checkpoint logic still works and cannot be trivially skipped.
- HUD continues to show current and prior lap times.
- New props/surfaces have tested collision or friction behavior.
- No regressions in spawn orientation or full-track visibility.

## Near-Term Priorities

- Car selection in settings (placeholder assets acceptable)
- Multiple track presets with irregular handcrafted layouts
- Better collision boundaries for non-circular props
- Simple AI opponent prototype
- Persisted best laps and player settings

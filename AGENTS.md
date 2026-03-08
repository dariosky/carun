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
- For Python tooling/scripts, run commands directly from the local `.venv` (for example `source .venv/bin/activate`), not via `uv run`, to avoid unintended `uv.lock` changes.
- Preserve full-track visibility in gameplay scenes.
- Avoid large rewrites without clear gameplay gain.
- Keep modular ES-module structure (no monolithic `game.js` reintroduction).
- Separate concerns where practical:
- input/state flow
- physics/surfaces/collisions
- rendering/HUD
- race progression/timing
- When adding new surfaces/objects, define both:
- visual representation
- physical behavior

## Performance Notes

- Aim for smooth real-time play on common laptop hardware; 60 FPS is the target where browser/display allow it.
- Avoid per-frame allocations and random sampling in hot render paths; prefer cached textures/patterns and reusable geometry.
- Recompute heavy track geometry only when track data changes (preset swap, editor generation), not every frame.
- Keep debug overlays informative but lightweight; they must not become a primary frame-time cost.
- For visual effects, prefer prebuilt/offscreen assets and simple blits over rebuilding procedural details each frame.

## Current Code Layout

- `frontend/index.html`: main canvas app shell + module entry script
- `frontend/styles.css`: global app styling
- `frontend/js/main.js`: startup wiring, bootstrap, and main loop setup
- `frontend/js/parameters.js`: config, presets, static parameters, and menu option data
- `frontend/js/state.js`: mutable runtime state
- `frontend/js/menus.js`: menu/settings/editor flow + keyboard/mouse handlers
- `frontend/js/physics.js`: car physics, checkpoints, laps, and race progression
- `frontend/js/track.js`: track geometry, surfaces, props, and collision helpers
- `frontend/js/render.js`: world rendering, menu rendering, and HUD drawing
- `frontend/js/game-loop.js`: frame loop timing
- `frontend/js/audio.js`: menu music control
- `frontend/js/game-audio.js`: race audio wiring
- `frontend/js/audio/`: synths, shared audio utilities, and audio manager
- `frontend/js/api.js`: frontend API client for auth, tracks, and leaderboard data
- `frontend/js/snackbar.js`: transient UI notifications
- `frontend/js/particles.js`: confetti and particle effects
- `frontend/assets/`: static images and branding assets
- `frontend/sounds/`: music and sound assets
- `frontend/tests/`: frontend unit tests
- `backend/app/main.py`: FastAPI app entrypoint
- `backend/app/api/`: backend HTTP routes
- `backend/app/models/`: SQLAlchemy models
- `backend/app/schemas/`: API schema definitions
- `backend/alembic/`: database migrations
- `backend/tests/`: backend and integration tests
- `docs/`: project documentation for menus/editor and related flows
- `scripts/`: local tooling and deployment helpers

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
- Persist the best laps and player settings

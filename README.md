# CaRun

CaRun is an HTML5 arcade racing game prototype inspired by colorful 90s pixel-era racers.

## Vision

Build a fun-first, indie-style top-down racing game where:

- Cars are small, expressive sprites with sharp/pixel-ish presentation.
- Tracks are fully visible on screen (no camera scroll).
- Surfaces and world details have gameplay impact.
- Physics prioritize arcade handling and satisfying drift over strict realism.

## Current POC Features

- Main menu with keyboard navigation (`ArrowUp`/`ArrowDown` + `Enter`)
- Game title screen: `Carun`
- Settings screen with editable player name
- Single fully visible irregular oval track
- Multiple surfaces with different behavior:
- `asphalt` (default drive surface)
- `curb` red/white border (higher grip)
- `grass` (slower, less grip)
- `pond` (very slow, slippery)
- Decorative and collidable world objects (trees, barrels)
- Collision response against obstacles
- Arcade-style drift behavior (lateral slip and grip blending)
- Start/finish line and 4 checkpoints
- Lap tracking with checkpoint validation
- 3-lap race test flow
- HUD with:
- current lap time
- per-lap history
- finish screen and total time
- Car spawns tangent to the track direction at race start

## Controls

### Menu / Settings

- `ArrowUp` / `ArrowDown`: move selection
- `Enter`: select/activate
- In player-name edit mode:
- type letters/numbers/space
- `Backspace`: delete
- `Enter`: confirm
- `Esc`: cancel edit mode

### Racing

- `W` or `ArrowUp`: accelerate
- `S` or `ArrowDown`: brake/reverse
- `A` or `ArrowLeft`: steer left
- `D` or `ArrowRight`: steer right
- `Space`: handbrake
- `P`: pause/resume (shows controls modal and freezes race timers)
- `Esc`: return to menu

## Run Locally

This is a static HTML/CSS/JS project.

1. Open `index.html` directly in your browser, or
2. Serve the folder with a simple static server (recommended), for example:

```bash
npx serve .
```

Then open the local URL shown by the server.

## Project Structure

- `index.html`: canvas app shell
- `styles.css`: full-screen presentation and responsive layout
- `js/main.js`: startup wiring
- `js/parameters.js`: constants/config/static parameters
- `js/state.js`: mutable runtime state
- `js/menus.js`: menu/settings flow + keyboard handlers
- `js/physics.js`: car physics + race progression
- `js/track.js`: track geometry, surfaces, and collision helpers
- `js/render.js`: world/UI rendering
- `js/game-loop.js`: frame loop timing
- `js/utils.js`: shared helpers

## Next Roadmap

- Selectable cars with different handling profiles
- More track themes and handcrafted irregular layouts
- Better sprite art pipeline (cars, props, UI)
- AI opponents
- Local multiplayer modes
- Online multiplayer architecture
- Audio (engine, skid, collisions, UI SFX, music)
- Save/load settings and best lap records

## Design Principles

- Keep gameplay readable and instantly fun.
- Favor responsiveness over simulation realism.
- Make every visual detail potentially meaningful for driving.
- Preserve retro-inspired look while keeping code modular for expansion.

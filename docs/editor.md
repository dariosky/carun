# Editor And Track Pipeline

This document maps the current track drawing pipeline, the editor data flow, the runtime variants, and the editor UI as implemented today.

## Scope

Relevant files:

- `frontend/js/parameters.js`: track preset data, editor stroke storage, centerline regeneration, persistence, API import/export.
- `frontend/js/track.js`: boundary construction, surface queries, curb generation, collision-facing geometry helpers.
- `frontend/js/render.js`: world rendering, editor overlays, track previews, toolbar and top bar drawing.
- `frontend/js/menus.js`: editor interaction model, keyboard/mouse bindings, toolbar actions, save/build/race flow.
- `frontend/js/state.js`: editor runtime state.

## Track Representation

Visible tracks are DB-backed payloads, and the supported rendering/runtime model is the centerline track format.

This format is:

- `centerlineStrokes[]`: raw authoring input from the editor.
- `track.centerlineLoop[]`: smoothed, resampled closed loop used at runtime.
- `track.centerlineWidthProfile[]`: half-width samples along that closed loop.
- `track.centerlineHalfWidth`: fallback/default width.
- `track.centerlineSmoothingMode`: `raw`, `light`, or `smooth`.
- `track.startAngle`: currently forced to `0` for generated tracks.

At runtime, the important source of truth is the generated centerline data:

- `pointOnCenterLine()` samples the loop directly.
- `trackFrameAtAngle()` derives tangent/normal from the loop.
- `trackBoundaryPaths()` offsets the loop into outer and inner road boundaries.
- `surfaceAt()` and checkpoint span calculations use loop progress along the loop.

## Editor Data Model

### Preset structure

Each preset contains:

- `id`, `name`, metadata fields
- `track`
- `checkpoints`
- `worldObjects`
- `centerlineStrokes`
- `editStack`

### What a "segment" means in the editor

The UI label says "segment", but the selectable road unit is actually one stroke in `centerlineStrokes[]`, not one sampled geometry segment.

Each stroke is an array of points:

- `x`
- `y`
- `halfWidth`

When the user changes road size in the toolbar, the code updates `halfWidth` for every point in the selected stroke. The toolbar displays full road width as `halfWidth * 2`.

## Generation Pipeline

The editor pipeline starts in `frontend/js/parameters.js`.

### Step 1. Raw stroke capture

In editor mode:

- `mousedown` on the canvas with tool `road` starts `state.editor.activeStroke`.
- `mousemove` appends points while the cursor moves more than 4 px.
- `mouseup` stores the stroke into `preset.centerlineStrokes`.

Important current behavior:

- Adding a new stroke does not rebuild track geometry automatically.
- The new stroke becomes visible in the editor overlay immediately.
- The actual drivable track updates only after `Build`, `Space`, or another action that calls `rebuildEditorTrackGeometry()`.

### Step 2. Connect strokes into one closed authoring loop

`getConnectedCenterlinePoints(strokes)`:

- keeps only non-empty strokes
- starts from the first stroke
- bridges gaps between consecutive strokes with `appendBridge(...)`
- bridges the last point back to the first point

This means disjoint strokes are treated as ordered pieces of one closed loop, not independent splines.

### Step 3. Simplify and smooth

`regenerateTrackFromCenterlineStrokes(index)` runs:

1. `simplifyClosedLoop(...)`
2. `pruneTinyMovesClosed(...)`
3. `laplacianSmoothClosed(...)`
4. `chaikinSmoothClosed(...)`
5. `resampleClosedLoop(..., 220)`

The smoothing recipe comes from `CENTERLINE_SMOOTHING_CONFIG`:

- `raw`: least smoothing
- `light`: default
- `smooth`: strongest cleanup

This is controlled by `track.centerlineSmoothingMode`.

### Step 4. Rebuild width profile

`resampleCenterlineHalfWidths(rawLoop, loopPoints.length)` projects the authoring widths onto the resampled loop.

Outputs:

- `track.centerlineWidthProfile`
- `track.centerlineHalfWidth` fallback value

The fallback width is not taken directly from a stroke. It is re-estimated from span and perimeter and clamped between `24` and `72`.

### Step 5. Store runtime centerline track data

The generated preset writes:

- `track.cx`, `track.cy`
- `track.centerlineLoop`
- `track.centerlineWidthProfile`
- `track.centerlineHalfWidth`
- `track.startAngle = 0`

It also rotates the loop so index `0` is the sample closest to the first raw stroke point. That keeps the generated loop anchored to authoring order.

## Runtime Boundary Pipeline

This work lives in `frontend/js/track.js`.

### Boundary generation

`trackBoundaryPaths(trackDef, segments)` builds the drivable ribbon from the centerline:

- samples `centerlineLoop`
- samples width series with `sampleCenterlineWidthSeries(...)`
- offsets the centerline with `offsetLoopVariable(...)`
- returns:
  - `center`
  - `outer`
  - `inner`

This is the core source for:

- rendering
- curb generation
- bounds/preview calculations

### Surface classification

`getSurface(x, y, trackDef)` classifies points against the centerline ribbon:

- projects a point onto loop progress
- finds nearest distance to the centerline
- compares against sampled half-width and `borderSize`
- returns `asphalt`, `curb`, `grass`, or `innerGrass`

`surfaceAt()` normalizes `innerGrass` into `grass` for physics.

## Curb Pipeline

Curbs are derived in `track.js`, not in the editor code.

### Main path

`initCurbSegments(trackDef)`:

- tries `buildCurbSegments(...)`
- falls back to `buildFullCurbSegments(...)` if generation fails

### Centerline curb generation

For centerline tracks:

- it starts from `trackBoundaryPaths(trackDef, 280)`
- computes candidate curb paths by offsetting the sampled centerline near the border
- scores curvature and turning hardness
- builds contiguous curb runs instead of full continuous curbs

Later in `render.js`, curb rendering is refined again:

- `buildCurbWidthCaps(...)`
- `splitCurbRenderRuns(...)`
- `shouldRenderCurbSubsection(...)`

This prevents curbs from visually pushing into invalid areas and can replace marginal runs with dotted guide sections.

### Fallback path

If the selective curb builder fails, `buildFullCurbSegments(...)` creates full-loop curbs for outer and inner edges.

## Drawing Pipeline

The actual world draw lives in `frontend/js/render.js`.

### Main runtime draw

`drawTrack()` uses cached boundary data and cached curb data:

- `trackBoundaryPaths(...)`
- `initCurbSegments(...)`

Then `drawTrackSurface(...)`:

1. clips to the asphalt ring
2. fills asphalt material
3. draws curb runs if enabled
4. decor, start line, checkpoints, skid marks, etc. are drawn in surrounding helpers

### Asphalt draw detail

`drawTrackSurface(...)` prefers a strip-wise clip when:

- `center.length === outer.length === inner.length`

That avoids relying entirely on an `evenodd` fill for complex road tubes.

### Preview path

Track cards use `getPreviewTrackData(preset)`:

- `trackBoundaryPaths(preset.track, TRACK_SEGMENTS)`
- `initCurbSegments(preset.track)`

The preview path is separate from main-world caching through `previewTrackDataCache`.

## Editor UI

The editor UI is split between `menus.js` layout/hit-testing and `render.js` drawing.

### Top bar

Rendered by `drawEditorTitleBar()`.

Buttons:

- `Race` with shortcut `R`
- `Build` with shortcut `Space`

Other visible hints:

- `S save`
- `C curbs`
- `Esc back`

Mouse hit-testing uses `editorTopBarActionAt(...)`.

### Toolbar

Layout comes from `getEditorToolbarLayout()`.

It is draggable by its title bar and its position is persisted in local storage:

- key: `carun.editorToolbarPosition`

Sections:

#### Objects

Tool buttons:

- `Water` (`pond` internally)
- `Barrel`
- `Tree`

Selection row:

- previous object
- next object
- selected object display

Object actions:

- delete
- size down
- size up
- rotate left
- rotate right

Object size changes depend on object type:

- pond: changes `rx` and `ry`
- tree: changes `r`
- barrel: changes `r`

#### Road

Selection row:

- previous stroke
- next stroke
- selected stroke display

Road actions:

- delete selected stroke
- width down
- width up

Road width editing:

- works on the selected stroke only
- changes all points in that stroke
- uses a step of `4` half-width units
- clamps each point between `24` and `120`
- rebuilds geometry immediately

The road width label shown in the UI is full width in pixels.

#### Smoothing

Controls:

- previous smoothing mode
- next smoothing mode

Modes:

- `RAW`
- `LIGHT`
- `SMOOTH`

Changing smoothing updates `track.centerlineSmoothingMode` and rebuilds geometry immediately.

#### Zoom

Controls:

- zoom out
- zoom in

This edits `preset.track.worldScale`, clamped to `0.5` through `1.75`.

Zoom affects rendering scale only. It does not regenerate track geometry.

## Editor Controls

### Keyboard

In editor mode:

- `T`: toggle tree placement tool
- `W`: toggle water/pond placement tool
- `B`: toggle barrel placement tool
- `C`: show/hide curbs
- `R`: race the current edited track
- `S`: save track
- `Space`: build track geometry from strokes
- `Backspace`: delete selected stroke or selected object
- `Esc`: leave editor and return to track select

### Mouse

- left click on toolbar buttons triggers their action
- left drag on toolbar title bar moves the toolbar
- left click on canvas with object tool places an object
- left drag on canvas with road tool records a stroke

### Cursor coordinates

The editor world sits below the fixed top bar. `updateEditorCursorFromEvent(...)` converts screen coordinates into world coordinates and compensates for top-bar height and `worldScale`.

## Selection And Edit Order

The editor keeps `latestEditTarget` in state and also an `editStack` in the preset.

The stack is used to recover a sensible last-edited selection when possible:

- latest object
- latest stroke

Insert/delete operations reindex the stack so references stay valid.

New strokes are inserted:

- after the currently selected stroke, if one is selected
- otherwise at the end

## Save, Load, And Persistence

### Local persistence

Track edits are stored in local storage under:

- `carun.trackEdits.v1`

Saved payload includes:

- `track`
- `checkpoints`
- `worldObjects`
- `centerlineStrokes`
- `editStack`
- metadata copied by `clonePresetData(...)`

### Database persistence

Editor save flow:

- `promptSaveEditorTrack()`
- `saveEditorTrack()`
- `saveTrackPresetToDb(...)`

New local tracks can be promoted into DB tracks. Existing DB tracks update in place.

### Entering editor

From track select:

- `E`: edit selected track
- `N`: create empty track and edit it

`enterEditor(trackIndex)`:

- applies the preset
- regenerates runtime curb segments from current track data
- resets editor mode state
- restores toolbar position
- syncs latest selection
- updates URL to `/tracks/edit/:id`

## Current Limitations And Behaviors Worth Knowing

- New road strokes are not auto-built into the drivable track. The user must press `Build` or `Space`, or trigger another rebuild-producing action.
- Stroke ordering matters because disconnected strokes are bridged in authoring order.
- "Segment" in the toolbar means stroke, not a sub-segment of the generated loop.
- Checkpoints remain angle-based in preset data; for centerline tracks, runtime checkpoint frames are still resolved through `trackFrameAtAngle(...)`, which maps angle to progress on the loop.

## Fix Applied While Reviewing

The editor top-bar click hit test was offset by the top-bar height twice on mouse down, which could make `Race` and `Build` fail to respond correctly. The click path now uses the already normalized editor screen coordinates directly in `frontend/js/menus.js`.

## Likely Optimization Targets

The most obvious places for future optimization work are:

- repeated boundary sampling and offsetting in `track.js`
- selective curb generation and subdivision
- preview cache invalidation granularity
- rebuild frequency after editor operations

Those are the right places to profile before changing the editor model.

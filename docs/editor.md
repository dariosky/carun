# Editor Track Generation (Centerline -> Asphalt -> Borders -> Curbs)

## High-Level Principle
Generate the asphalt as a robust polygon first. Then derive borders and curbs from that polygon.

Do not treat curbs as another offset of the centerline. Treat curbs as inset/outset operations from the final asphalt boundaries.

This is the deterministic guarantee that curbs cannot appear in the middle of the road.

## Step 0 - Inputs
- `centerlineStrokes[]` from the editor.
- Connected loop points from `getConnectedCenterlinePoints` (named `centerlineLoopRaw` in this spec).
- Parameters:
- `halfWidth`
- `borderSize`
- `CURB_OUTSET`
- sampling target `N >= 280`

## Step 1 - Build a Stable Centerline Polyline
1. Connect strokes into one closed loop (`centerlineLoopRaw`).
2. Build a smooth closed representation (Catmull-Rom is acceptable).
3. Resample by arc length to uniform spacing.
4. Output `center[]` with length `N`, evenly spaced along the loop.
5. Compute per sample:
- tangent `t[i]` from normalized forward difference
- normal `n[i] = rotate90(t[i])`
6. Enforce one consistent normal orientation from loop winding.

Acceptance for Step 1:
- Normals do not flip sign between consecutive samples (except impossible tangent flips).

## Step 2 - Build Asphalt Tube from Centerline Rails
Avoid miter-join offset construction at this stage.

Construct rails pointwise:
- `L[i] = center[i] - n[i] * halfWidth`
- `R[i] = center[i] + n[i] * halfWidth`

Build initial asphalt polygon:
- `asphaltPoly = [R[0..N-1], reverse(L[0..N-1])]` (closed)

This avoids corner-miter spikes by construction.

## Step 3 - Validate and Repair Asphalt Polygon
Mandatory repair stage:
1. Detect self-intersections in `asphaltPoly`.
2. If intersections exist:
- Preferred: run polygon boolean cleanup to produce a simple asphalt polygon.
- Fallback: increase sampling, then optionally apply local width clamp (Step 3b).

### Step 3b - Optional Local Width Clamp
For each sample, estimate curvature radius `r[i]`.

If `halfWidth > k * r[i]` (recommended `k = 0.8`), clamp locally:
- `halfWidthEff[i] = min(halfWidth, k * r[i])`

Rebuild rails and `asphaltPoly` with `halfWidthEff[i]`.

Acceptance for Step 3:
- Asphalt polygon is simple (no self-intersections) for normal editor-authored tracks.

## Step 4 - Derive Borders from Asphalt Boundaries (Not Centerline)
Extract asphalt boundary loops:
- `asphaltOuterBoundary`
- `asphaltInnerBoundary`

For a clean tube these map closely to `R` and `L`; after repair they may differ.

Derive borders from these boundaries:
- Outer border line = inset from outer boundary by `borderSize`.
- Inner border line = outset from inner boundary by `borderSize`.

Use winding-aware offset sign conventions in implementation.

## Step 5 - Derive Curb Bases from Border-Adjacent Geometry
Curbs remain border-adjacent by design:
- `outerCurbBase = offset(outerBoundary, -borderSize + CURB_OUTSET)`
- `innerCurbBase = offset(innerBoundary, +borderSize - CURB_OUTSET)`

If curb base loops self-intersect, run the same repair policy as Step 3.

## Step 6 - Curb Run Selection (Turn Hardness)
Run hardness is computed on uniformly resampled `center[]`:
1. Compute signed turn:
- `signedTurn[i] = signedAngle(t[i-1], t[i+1])`
2. Compute curvature magnitude:
- `curv[i] = abs(signedTurn[i]) / ds`
3. Pick threshold from percentile `p` in `[0.60, 0.68]`.
4. Mark hard-turn samples: `isHardTurn[i] = curv[i] > threshold`.
5. Expand by `expandBy` samples (`2` to `3`).
6. Form contiguous runs (minimum run length `>= 4` samples).
7. Apply runs onto both curb bases.

Future option:
- emphasize outside curb only using turn sign.

## Recommended Defaults
- `N >= 280`
- `p = 0.62` (typical)
- `expandBy = 2`
- `minRun = 4`
- `k = 0.8` for local width clamp

## Deterministic Acceptance Criteria
1. Asphalt is built first as a simple valid polygon.
2. Borders and curbs are derived from asphalt boundaries, never directly from centerline offsets for final curb placement.
3. Curbs cannot appear in the road interior on valid repaired geometry.
4. Curb runs appear primarily in high-curvature regions and remain contiguous.
5. Full track remains visible and existing lap/checkpoint/spawn behavior stays intact.

# @kolu/solid-canvas-viewport

Pan/zoom 2D canvas viewport for SolidJS. Wheel/trackpad zoom toward
cursor, click-drag pan, shift-drag and middle-button pan, animated
center-on-rect, `prefers-reduced-motion` honored. Decomposed by
volatility along three axes: gesture input, transform math, CSS
output.

## Encapsulated axes

- **Gesture input** (`gestures.ts`, `capturePointerGesture.ts`)
  — how wheel + pointer events translate to pan/zoom deltas. Has
  already evolved (shift-drag for Figma-style pan, wheel-yield to
  let xterm consume scroll in active tiles).
- **Transform math** (`transforms.ts`, `coordinates.ts`,
  `animatedPan.ts`) — algebra of zoom-toward-point, snap-to-grid,
  center-on-rect, easing for animated pans.
- **CSS generation** (`coordinates.ts`'s `tileTransformCSS`) —
  how viewport state becomes per-tile CSS transform strings.

`useCanvasViewport({ ... })` is the orchestrator that wires
SolidJS reactive inputs (refs, signals) to the three modules and
returns one `CanvasViewport` interface with stable methods.

## Exports

Single barrel:

- `useCanvasViewport({ canvasRef, contentRef })` —
  returns `{ panZoom, panToGrid, centerOnRect, ... }`.
- `capturePointerGesture(...)` — multi-pointer drag capture
  helper used by both the viewport and Kolu's minimap.
- `tileTransformCSS(layout, panZoom)` — per-tile CSS transform
  string. Takes any `Rect`.
- `installGestures(...)` / `animatePan(...)` / transform helpers
  re-exported for advanced consumers.

## Why a package

Single in-tree consumer today (`packages/client/src/canvas/`), but
the encapsulation is shaped around "2D pannable/zoomable
viewport" — a pattern any spatial UI (whiteboard, node graph,
floor plan) repeats. The Surface and `@kolu/solid-pierre`
extractions cleared the same bar. The viewport's volatility has
already manifested as repeated rework (per-tile transform vs
wrapper transform per issue #988); naming it as a package
contains the next round.

Depends on `@kolu/canvas-layout/geometry` for `GRID_SIZE` /
`snapToGrid` (the constants are tile-space and viewport-space's
shared coordinate system).

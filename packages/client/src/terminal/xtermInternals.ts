/** The one null-guarded place for xterm's private `_core.*` shape.
 *
 *  Every reach into xterm's undocumented internals — render service,
 *  buffer service, DEC private modes — lives here, behind accessors that
 *  return null (or a null-shaped result) when the shape isn't what we
 *  expect. This is the single volatility axis: when the pinned
 *  `@xterm/xterm` beta bumps and renames a `_core` field, exactly one
 *  module needs editing, and every consumer degrades to a no-op / "unknown"
 *  probe instead of crashing.
 *
 *  Consumers:
 *   - `renderRecovery.ts` uses `renderService`/`readDecPrivateMode` for its
 *     forced sync repaint + render-pipeline probes.
 *   - `Terminal.tsx` uses `readBufferBytes` for the Diagnostic dialog's
 *     per-terminal byte counts. */

import type { Terminal as XTerm } from "@xterm/xterm";

/** Unchecked cast onto xterm's private `_core`. The shape is described
 *  structurally at each call site below; the guards there are what keep us
 *  safe, since this cast asserts nothing. */
function core<T>(term: XTerm): T | undefined {
  return (term as unknown as { _core?: T })._core;
}

/** xterm's private render internals we reach through. Every field optional —
 *  the cast is unchecked, so the guards in the accessors are what keep us safe. */
export interface RenderInternals {
  refreshRows?: (start: number, end: number, sync?: boolean) => void;
  _renderDebouncer?: { _animationFrame?: number };
  _isPaused?: boolean;
}

/** xterm's `_core._renderService`, or null if its shape changed under us. */
export function renderService(term: XTerm): RenderInternals | null {
  const rs = core<{ _renderService?: RenderInternals }>(term)?._renderService;
  return rs ?? null;
}

/** A DEC private mode (e.g. DEC 2026 synchronized-output): true/false if we
 *  can read it; null if xterm's shape changed under us. */
export function readDecPrivateMode(
  term: XTerm,
  field: "synchronizedOutput",
): boolean | null {
  const modes = core<{
    _coreService?: { decPrivateModes?: Record<string, unknown> };
  }>(term)?._coreService?.decPrivateModes;
  if (!modes || !(field in modes)) return null;
  return modes[field] === true;
}

/** Sum `byteLength` of every BufferLine's `Uint32Array` in xterm's primary
 *  and alternate buffers. Reaches through private `_core._bufferService`,
 *  so every access is null-guarded — if xterm renames these fields in a
 *  future version, the probe reports `null` and the UI labels it "unknown"
 *  instead of crashing. Uses `length` + `get(i)` rather than iterating the
 *  private list array, because `CircularList.length` is the public view
 *  into a ring buffer with an arbitrary internal start offset. */
export function readBufferBytes(
  term: XTerm,
): { primary: number; alternate: number } | null {
  const bufSvc = core<{
    _bufferService?: {
      buffers?: {
        normal?: {
          lines?: {
            length: number;
            get(i: number): { _data?: Uint32Array } | undefined;
          };
        };
        alt?: {
          lines?: {
            length: number;
            get(i: number): { _data?: Uint32Array } | undefined;
          };
        };
      };
    };
  }>(term)?._bufferService;
  if (!bufSvc?.buffers) return null;

  function sum(lines: {
    length: number;
    get(i: number): { _data?: Uint32Array } | undefined;
  }) {
    let total = 0;
    for (let i = 0; i < lines.length; i++) {
      const data = lines.get(i)?._data;
      if (data) total += data.byteLength;
    }
    return total;
  }

  const primary = bufSvc.buffers.normal?.lines;
  const alternate = bufSvc.buffers.alt?.lines;
  if (!primary || !alternate) return null;
  return { primary: sum(primary), alternate: sum(alternate) };
}

/** An effective scale within this band of 1 takes the cheap no-op path in
 *  `unscaleEventPoint`, keeping the common untransformed case (non-canvas /
 *  zoom-1) a strict identity. Not correctness-critical: scale is measured as
 *  `rect.width / offsetWidth`, and because `offsetWidth` is integer-rounded
 *  while `.xterm-screen`'s width is fractional (`css.canvas.width`), the
 *  measured scale sits slightly off 1 even at true zoom 1 — by up to
 *  `0.5 / offsetWidth`, which exceeds this band only for sub-500px terminals.
 *  When it does, the applied correction is still bounded to ≈0.5px at the far
 *  edge (the scale deviation cancels against the offset) — sub-cell, well
 *  inside xterm's half-cell selection tolerance. So a missed band is harmless;
 *  the band just avoids pointless math when clearly untransformed. */
const TRANSFORM_EPSILON = 1e-3;

/** Map a viewport pixel `(clientX, clientY)` into `element`'s *pre-transform*
 *  coordinate space, given the element's transform-inclusive bounding `rect`
 *  and its transform-free layout size (`offsetWidth/Height`).
 *
 *  xterm hit-tests the mouse by subtracting the screen element's
 *  `getBoundingClientRect()` — which already folds in ancestor CSS transforms —
 *  then dividing by the element's *untransformed* CSS cell size. Under the
 *  canvas `scale(zoom)` tile transform (`tileTransformCSS`) the two disagree,
 *  so the computed column/row drifts by the zoom factor in both axes, growing
 *  with distance from the tile origin (#1400). Pre-dividing the event offset by
 *  the element's effective scale makes xterm's own unchanged math land on the
 *  right cell. The border-box top-left is a fixed point of the map (offset 0 →
 *  0), so a pure pan (translate, scale 1) needs no correction and is returned
 *  unchanged.
 *
 *  The border-box top-left is the fixed point ONLY while the ancestor transform
 *  uses `transform-origin: 0 0` (CanvasTile.tsx sets this for `tileTransformCSS`,
 *  documented in canvas/viewport/coordinates.ts); a non-0/0 origin would move
 *  the fixed point and invalidate inverting about `rect.left`/`rect.top`. The
 *  round-trip test in `xtermInternals.test.ts` composes that documented
 *  scale-about-(0,0) forward map and asserts this inverse recovers the point, so
 *  the two can't silently drift from the `transform-origin: 0 0` contract.
 *
 *  Pure (no DOM) so the geometry is unit-testable; the DOM read lives in
 *  `patchTransformAwareMouseCoords`. Returns the input unchanged when there is
 *  no effective scale, so untransformed terminals (split / sub-panels,
 *  zoom = 1) get a strict identity.
 *
 *  Reciprocal of `Terminal.tsx`'s `fileRefAtPoint` (touch tap → file ref): both
 *  enforce the one pointer→cell invariant under zoom, but from opposite ends of
 *  the same canvas scale. xterm OWNS its internal divisor (the UNtransformed CSS
 *  cell size), so its path can't change the divisor and must correct the INPUT
 *  point here. kolu OWNS the touch divisor and derives the cell size from the
 *  POST-transform rect (`rect.width / cols`), so its tap path is correct by
 *  construction and needs no correction. Two separately-owned divisors, one
 *  invariant — do not merge them; keep both in step if you touch one. */
export function unscaleEventPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  layoutWidth: number,
  layoutHeight: number,
): { clientX: number; clientY: number } {
  const scaleX = layoutWidth > 0 ? rect.width / layoutWidth : 1;
  const scaleY = layoutHeight > 0 ? rect.height / layoutHeight : 1;
  const nearIdentity =
    Math.abs(scaleX - 1) < TRANSFORM_EPSILON &&
    Math.abs(scaleY - 1) < TRANSFORM_EPSILON;
  // Common untransformed case (split / sub-panel, zoom 1): skip the math.
  if (nearIdentity) return { clientX, clientY };
  return {
    clientX: rect.left + (clientX - rect.left) / scaleX,
    clientY: rect.top + (clientY - rect.top) / scaleY,
  };
}

/** Minimal structural view of xterm's private `_core._mouseCoordsService`. Both
 *  methods read only `clientX/clientY` off the event (modifiers/buttons are
 *  read off the original event by `MouseService` before it calls in), so a
 *  corrected `{ clientX, clientY }` stand-in is a sufficient first argument. */
interface MouseCoordsShape {
  getCoords(
    event: { clientX: number; clientY: number },
    element: HTMLElement,
    colCount: number,
    rowCount: number,
    isSelection?: boolean,
  ): [number, number] | undefined;
  getMouseReportCoords(
    event: { clientX: number; clientY: number },
    element: HTMLElement,
  ): { col: number; row: number; x: number; y: number } | undefined;
  /** Set once we've wrapped this instance so a re-entrant call is a no-op. */
  __koluTransformPatched?: boolean;
}

/** Make xterm's mouse hit-testing aware of ancestor CSS transforms so text
 *  selection, link hover, and TUI mouse reporting land on the cell under the
 *  pointer when a canvas tile is zoomed (#1400).
 *
 *  Both coordinate entry points xterm exposes — `getCoords` (selection + links,
 *  via `SelectionService`) and `getMouseReportCoords` (mouse reporting to apps
 *  like opencode, via `MouseService`) — live on the single private
 *  `_core._mouseCoordsService` and both funnel through
 *  `getCoordsRelativeToElement`, which reads the transform-inclusive
 *  `getBoundingClientRect()`. We wrap each to inverse-scale the event point
 *  first (`unscaleEventPoint`) and delegate the rest to xterm's own math, so
 *  there is no cell metric to keep in sync.
 *
 *  Not covered (and uncoverable by wrapping the service): xterm's
 *  `SelectionService._getMouseEventScrollAmount` calls the free
 *  `getCoordsRelativeToElement` directly, not via the service, to size the
 *  drag-past-the-edge auto-scroll. Under zoom its trigger band/speed stay off
 *  by the zoom factor — but that affects only *how fast* the buffer auto-scrolls
 *  while drag-selecting beyond a zoomed tile, never *which* cell is selected
 *  (the anchor/extent go through the wrapped `getCoords`). Left as a known
 *  residual for #1400.
 *
 *  Idempotent and null-guarded: if a future beta renames the service or its
 *  methods, this degrades to a no-op (selection keeps xterm's default, possibly
 *  zoom-offset, behavior) instead of throwing. Call once after `term.open()` —
 *  that is when `_core._mouseCoordsService` is constructed. */
export function patchTransformAwareMouseCoords(term: XTerm): void {
  const svc = core<{ _mouseCoordsService?: MouseCoordsShape }>(
    term,
  )?._mouseCoordsService;
  if (!svc || svc.__koluTransformPatched) return;
  const getCoords = svc.getCoords;
  const getMouseReportCoords = svc.getMouseReportCoords;
  if (
    typeof getCoords !== "function" ||
    typeof getMouseReportCoords !== "function"
  ) {
    return;
  }
  const corrected = (
    event: { clientX: number; clientY: number },
    element: HTMLElement,
  ) =>
    unscaleEventPoint(
      event.clientX,
      event.clientY,
      element.getBoundingClientRect(),
      element.offsetWidth,
      element.offsetHeight,
    );
  svc.getCoords = (event, element, colCount, rowCount, isSelection) =>
    getCoords.call(
      svc,
      corrected(event, element),
      element,
      colCount,
      rowCount,
      isSelection,
    );
  svc.getMouseReportCoords = (event, element) =>
    getMouseReportCoords.call(svc, corrected(event, element), element);
  svc.__koluTransformPatched = true;
}

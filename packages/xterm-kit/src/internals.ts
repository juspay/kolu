import type { Terminal as XTerm } from "@xterm/xterm";

type BufferLines = {
  length: number;
  get(i: number): { _data?: Uint32Array } | undefined;
};

interface CoreInternals {
  _renderService?: RenderInternals;
  _charSizeService?: { width?: unknown };
  _writeBuffer?: {
    _writeBuffer?: unknown[];
    _callbacks?: unknown[];
    _pendingData?: number;
    _bufferOffset?: number;
  };
  _coreService?: { decPrivateModes?: Record<string, unknown> };
  _bufferService?: {
    buffers?: {
      normal?: { lines?: BufferLines };
      alt?: { lines?: BufferLines };
    };
  };
  _mouseCoordsService?: MouseCoordsShape;
}

function core(term: XTerm): CoreInternals | undefined {
  return (term as unknown as { _core?: CoreInternals })._core;
}

export interface RenderInternals {
  refreshRows?: (start: number, end: number, sync?: boolean) => void;
  /** Drop what the renderer believes is on screen. `@xterm/addon-fit` called
   *  this before every `resize()` ("force a full render"), and the grid path
   *  that replaced it keeps doing so: the WebGL renderer DIFFS each frame
   *  against `_model`, and `RenderModel.resize` only reallocates when
   *  `cols * rows` changes — so a reflow that keeps the cell COUNT (120×30 →
   *  90×40) would otherwise be diffed against a model describing the old
   *  layout and leave stale glyphs behind. */
  clear?: () => void;
  _renderDebouncer?: { _animationFrame?: number };
  _isPaused?: boolean;
}

/** xterm's `_core._renderService`, or null if its shape changed under us. */
export function renderService(term: XTerm): RenderInternals | null {
  const rs = core(term)?._renderService;
  return rs ?? null;
}

/** Resize the terminal — the ONE place the kit calls `terminal.resize`.
 *
 *  The public `resize` and the private `clear` are paired here because they are
 *  one act: the renderer DIFFS each frame against a model `RenderModel.resize`
 *  only reallocates when `cols * rows` changes, so a reflow that keeps the cell
 *  COUNT (120×30 → 90×40) leaves stale glyphs behind unless what it believes is
 *  on screen is dropped first (see {@link RenderInternals.clear}). Splitting
 *  them is how the pairing gets lost at the second call site.
 *
 *  Same-size is a NO-OP, and deliberately: `terminal.resize` re-measures the
 *  character size, and this runs on the divider-drag hot path.
 *
 *  Note what `resize` itself does, because the kit's ordering rests on it: it
 *  calls `WriteBuffer.flushSync()` FIRST, so bytes still queued are parsed at
 *  the OLD grid before the reflow. Writing a run and then resizing therefore
 *  lands those bytes at the width they were written for, with nothing to
 *  schedule or await (CONTRACT PIN in `internals.test.ts`). */
export function resizeTerminal(term: XTerm, cols: number, rows: number): void {
  if (term.cols === cols && term.rows === rows) return;
  renderService(term)?.clear?.();
  term.resize(cols, rows);
}

/** xterm's own character-width measurement, in CSS pixels and UNROUNDED —
 *  `CharSizeService.width`, the width of one 'W' through `measureText` (or an
 *  offsetWidth fallback), divided by nothing.
 *
 *  Private because xterm exposes only what its renderers MADE of it:
 *  `terminal.dimensions` carries each renderer's own cell width and the two
 *  disagree, which is the whole reason kolu measures its own grid — the rule
 *  is stated in `solid/grid.ts`. Shape pinned by `internals.test.ts` against
 *  the shipped `@xterm/xterm`.
 *
 *  **Fail-loud**, like `clearWriteQueue` and for the same reason: there is no
 *  honest degraded answer. Returning null would silently leave every pane
 *  unmeasured and therefore unattached — a dead app with no signal. Valid only
 *  after `terminal.open()`, which is when `_charSizeService` is constructed;
 *  before the first measure it legitimately reads 0 (the caller treats that as
 *  "not measurable yet"). */
export function measuredCharWidth(term: XTerm): number {
  const width = core(term)?._charSizeService?.width;
  if (typeof width !== "number") {
    throw new Error(
      "measuredCharWidth: xterm CharSizeService private shape missing or incomplete; cannot size the terminal grid",
    );
  }
  return width;
}

/** Drop unparsed chunks in xterm's WriteBuffer without parsing them.
 *
 *  `term.write` is async (queued on WriteBuffer + setTimeout). A synchronous
 *  `term.reset()` only clears the screen buffer — queued chunks still parse
 *  afterward and contaminate a fresh-snapshot re-attach.
 *
 *  **Fail-loud** (unlike diagnostic probes): a private-shape mismatch would
 *  silently re-open the contamination bug, so this throws rather than no-op. */
export function clearWriteQueue(term: XTerm): void {
  const wb = core(term)?._writeBuffer;
  if (
    !wb ||
    !Array.isArray(wb._writeBuffer) ||
    !Array.isArray(wb._callbacks) ||
    typeof wb._pendingData !== "number" ||
    typeof wb._bufferOffset !== "number"
  ) {
    throw new Error(
      "clearWriteQueue: xterm WriteBuffer private shape missing or incomplete; cannot guarantee a clean snapshot reset",
    );
  }
  wb._writeBuffer.length = 0;
  wb._callbacks.length = 0;
  wb._pendingData = 0;
  wb._bufferOffset = 0;
}

/** A DEC private mode (e.g. DEC 2026 synchronized-output): true/false if we
 *  can read it; null if xterm's shape changed under us. */
export function readDecPrivateMode(
  term: XTerm,
  field: "synchronizedOutput",
): boolean | null {
  const modes = core(term)?._coreService?.decPrivateModes;
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
  const bufSvc = core(term)?._bufferService;
  if (!bufSvc?.buffers) return null;

  function sum(lines: BufferLines) {
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

const NEAR_IDENTITY_BAND = 1e-3;

function isNearIdentityScale(scaleX: number, scaleY: number): boolean {
  return (
    Math.abs(scaleX - 1) < NEAR_IDENTITY_BAND &&
    Math.abs(scaleY - 1) < NEAR_IDENTITY_BAND
  );
}

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
 *  round-trip test in `internals.test.ts` composes that documented
 *  scale-about-(0,0) forward map and asserts this inverse recovers the point, so
 *  the two can't silently drift from the `transform-origin: 0 0` contract.
 *
 *  Pure (no DOM) so the geometry is unit-testable; the DOM read lives in
 *  `patchTransformAwareMouseCoords`. Returns the input unchanged when there is
 *  no effective scale, so untransformed terminals (split / sub-panels,
 *  zoom = 1) get a strict identity.
 *
 *  This correction is the ONE pointer→cell divisor. Selection, link hover, TUI
 *  mouse reporting, AND the touch tap (`cellAtPoint`, via this same wrapped
 *  `getCoords`) all resolve through it — there is no second, separately-owned
 *  divisor to keep in step. (A touch tap once hand-rolled its own
 *  `rect.width / cols`; PR-2 deleted that parallel and routed it here.) */
export function unscaleEventPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  layoutWidth: number,
  layoutHeight: number,
): { clientX: number; clientY: number } {
  const scaleX =
    layoutWidth > 0 && rect.width > 0 ? rect.width / layoutWidth : 1;
  const scaleY =
    layoutHeight > 0 && rect.height > 0 ? rect.height / layoutHeight : 1;
  if (isNearIdentityScale(scaleX, scaleY)) return { clientX, clientY };
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
 *  This is a known-but-unfixed gap in xterm's OWN coordinate path, not a kolu
 *  quirk. xterm #2488 (xtermjs/xterm.js PR #4366, shipped 5.3.0) made char
 *  *measurement* transform-agnostic — `CharSizeService` now measures via
 *  `measureText` / `offsetWidth`, so `css.cell.width` ignores an ancestor
 *  `scale()` — but the hit-test was never reconciled: `getCoordsRelativeToElement`
 *  still divides a *post-transform* `getBoundingClientRect()` offset by that
 *  now-*unscaled* cell, the exact asymmetry we correct. xterm #3242 ("selection
 *  affected by CSS scaling transforms") was closed as a duplicate of #2488 on
 *  the assumption the measurement fix covered selection; it did not. Still
 *  present on `@xterm/xterm` master as of 2026-06, so a pnpm-overrides pin bump
 *  won't retire this wrap — only an upstream coord-path fix would, at which point
 *  it becomes a no-op and can be deleted.
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
  const svc = core(term)?._mouseCoordsService;
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

/** Resolve a viewport pixel `(clientX, clientY)` to the 0-based `{ col, row }`
 *  cell under it — `col` a buffer column, `row` a VIEWPORT row (add
 *  `buffer.active.viewportY` for an absolute buffer line) — through xterm's OWN
 *  `_core._mouseCoordsService`, the single authority that places the glyphs.
 *
 *  This is the one home for pointer→cell. xterm's selection, link hover, and TUI
 *  mouse reporting all resolve through this same service (transform-corrected by
 *  `patchTransformAwareMouseCoords`), so a touch tap routing here shares their
 *  divisor instead of hand-rolling a parallel `rect.width / cols`. That parallel
 *  agrees with the authority only when the screen's layout width happens to equal
 *  `cols × cssCellWidth` — which nothing guarantees: integer-rounded
 *  `offsetWidth`, sub-pixel font metrics, or screen padding make them diverge,
 *  and a zoomed tile magnifies the gap near a cell boundary and far from the tile
 *  origin (#1400). One authority, no metric to keep in sync.
 *
 *  Cosmetic read — degrades to null: a missing service / `.xterm-screen` /
 *  method, or a point xterm can't map, returns null and the caller (a tap)
 *  simply resolves no ref. A wrong cell here is a mis-tap, never buffer
 *  corruption, so null is the correct failure, not a throw. Call after
 *  `term.open()` + `patchTransformAwareMouseCoords(term)`.
 *
 *  `getCoords` returns xterm's 1-based `[col, row]` (col ∈ [1, cols], row ∈
 *  [1, rows]); we hand back 0-based. `isSelection` is omitted deliberately — a
 *  tap is a point hit, not a selection endpoint (which would add a half-cell of
 *  precision and a `cols + 1` clamp to cover the span's end). */
export function cellAtPoint(
  term: XTerm,
  clientX: number,
  clientY: number,
): { col: number; row: number } | null {
  const svc = core(term)?._mouseCoordsService;
  const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
  if (!svc || typeof svc.getCoords !== "function" || !screen) return null;
  const coords = svc.getCoords(
    { clientX, clientY },
    screen,
    term.cols,
    term.rows,
  );
  if (!coords) return null;
  return { col: coords[0] - 1, row: coords[1] - 1 };
}

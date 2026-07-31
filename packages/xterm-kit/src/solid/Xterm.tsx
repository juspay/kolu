/** `<Xterm>` — the whole xterm hazard set as one JSX element.
 *
 *  It composes the kit's primitives (lifecycle, WebGL, scroll lock + wiring,
 *  render recovery, soft keyboard, touch) and owns their reactive lifetime, so a
 *  consumer writes only its POLICY in `onReady`: which bytes, when, for whom —
 *  the stream, keybindings, the PTY, diagnostics. `onReady` runs inside the
 *  component's reactive owner, so policy cleanups (a link provider, an e2e
 *  bridge) actually run.
 *
 *  It renders the mount `<div>` and SPREADS any extra props (class, `data-*`)
 *  onto it, so a consumer keeps its own attributes — grid selectors, an e2e
 *  bridge target — on the element verbatim, without the kit learning them. */

import { makeEventListener } from "@solid-primitives/event-listener";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type { SerializeAddon } from "@xterm/addon-serialize";
import type { ITheme, Terminal as XTerm } from "@xterm/xterm";
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  splitProps,
} from "solid-js";
import { sameGrid, type TerminalGrid } from "./grid";
import { clearWriteQueue } from "../internals";
import { createOutputCoalesce } from "./outputCoalesce";
import { createRenderRecovery, type RenderRecovery } from "./renderRecovery";
import { createScrollLock } from "./scrollLock";
import { wireScrollIntent } from "./scrollLockWiring";
import { enableSoftKeyboardInput } from "./softKeyboardInput";
import { wireTouchScroll, wireTouchTaps } from "./touch";
import {
  attachWebGL,
  type WebglHandle,
  type WebglLifecycleHooks,
} from "./webgl";
import { createXtermLifecycle, type XtermCore } from "./xtermLifecycle";

/** The scroll-lock latch instance shape (structural — no exported nominal). */
export type ScrollLock = ReturnType<typeof createScrollLock>;

// The grid value + its equality (`./grid`), re-exported here so `TerminalGrid`
// still reads as the component's own vocabulary at every import site.
export { sameGrid, type TerminalGrid } from "./grid";

/** `@xterm/addon-fit`'s own clamp floor (`MINIMUM_COLS` / `MINIMUM_ROWS`).
 *  `proposeDimensions()` never returns anything below it, so a proposal AT the
 *  floor carries no information about the box — see `applyFit`. */
const FIT_ADDON_MIN_COLS = 2;
const FIT_ADDON_MIN_ROWS = 1;

/** What `<Xterm onReady>` hands the consumer — the live terminal plus every
 *  mechanism it wires policy against, all inside the component's reactive owner. */
export interface XtermHandle {
  terminal: XTerm;
  /** The mount element (also the consumer's own attribute host). */
  container: HTMLElement;
  addons: { fit: FitAddon; search: SearchAddon; serialize: SerializeAddon };
  scrollLock: ScrollLock;
  /** Single write door: unfocused rate-coalesce → scroll-lock → term.write.
   *  `onParsed` fires when the chunk lands in xterm. */
  write: (data: string, onParsed?: () => void) => void;
  /** Drop coalesced + scroll-lock pending bytes without writing (fresh snapshot). */
  clearPendingOutput: () => void;
  webgl: WebglHandle;
  recovery: RenderRecovery;
  /** Debounced fit — one call per animation frame (ResizeObserver fires fast). */
  refit: () => void;
  /** The grid this pane has actually MEASURED against its own box — `null`
   *  until it has one, and the ONE door this fact leaves the kit through.
   *
   *  Read this before doing anything that depends on the grid being REAL.
   *  `terminal.cols/rows` is never null: an unmeasured xterm reports the 80×24
   *  its constructor invents, and a hidden pane (`display:none`, a 0×0 box) can
   *  never be measured, so it keeps reporting that invented grid indefinitely.
   *  Rendering host-serialized bytes against it paints a screen laid out for a
   *  width the terminal does not have. Gating on `grid()` makes that
   *  unrepresentable: no grid, no bytes.
   *
   *  Compared by value, so it notifies once per REAL grid change and never for
   *  a re-fit that measured nothing new — which is what lets a consumer drive
   *  its PTY-resize publish straight off this signal. */
  grid: Accessor<TerminalGrid | null>;
  /** Run `fn` ONCE, with the first genuinely measured grid — immediately if one
   *  already exists, otherwise the moment the box first measures.
   *
   *  The kit owns this latch so no consumer re-derives "no grid, no bytes" by
   *  hand out of `grid()` plus a mutable boolean. Call it from `onReady` (it
   *  registers a reactive computation in the caller's owner). */
  onceMeasured: (fn: (grid: TerminalGrid) => void) => void;
}

interface XtermOwnProps {
  /** Live re-theme (clears the texture atlas). */
  theme: ITheme;
  /** Live refit + atlas clear. */
  fontSize: number;
  /** Reveal gate — scroll-lock reset + scroll-to-bottom + refit on show, and
   *  the render-recovery gate. NOT the fit gate: whether this pane can be
   *  measured is read off its own box inside `applyFit`, so a `visible` that
   *  disagrees with the layout (a `true` pane under a `display:none` ancestor)
   *  can no longer decide it. */
  visible: boolean;
  /** Renderer gate — an accessor, never a snapshot: WHICH panes hold a GPU
   *  context is the consumer's budget policy. */
  webgl: Accessor<boolean>;
  /** The scroll-lock enable gate (e.g. a preference) — an accessor. */
  scrollLockEnabled: Accessor<boolean>;
  /** Full-rate paint gate (e.g. focused tile). Unfocused panes coalesce PTY
   *  writes. Defaults to always-full-rate when omitted. */
  fullRate?: Accessor<boolean>;
  /** The face awaited before construction, and xterm's `fontFamily`. */
  fontFamily: string;
  /** Extra xterm constructor options (scrollback, cursor, allowProposedApi …).
   *  `theme`/`fontSize`/`fontFamily` are set from the props above. */
  terminalOptions?: Omit<
    ReturnType<Parameters<typeof createXtermLifecycle>[1]>["terminalOptions"],
    "theme" | "fontSize" | "fontFamily"
  >;
  /** Keystrokes out (query-response filtering / sticky modifiers are policy). */
  onData: (data: string) => void;
  /** The live handle, inside the reactive owner — wire policy here. */
  onReady: (handle: XtermHandle) => void;
  /** Touch tap resolver: return true if the tap was consumed (e.g. a ref was
   *  followed), else the soft keyboard is summoned. */
  onTap: (clientX: number, clientY: number) => boolean;
  /** Optional GPU-context lifecycle hooks (diagnostics). */
  webglHooks?: WebglLifecycleHooks;
  /** Injected web-link click handler — generic seam only (see
   *  {@link XtermLifecycleOptions.webLinkHandler}). When absent, the addon's
   *  default open runs. */
  webLinkHandler?: (event: MouseEvent, uri: string) => void;
}

/** Props consumed by the component; everything else is spread onto the mount div. */
const OWN_KEYS = [
  "theme",
  "fontSize",
  "visible",
  "webgl",
  "scrollLockEnabled",
  "fullRate",
  "fontFamily",
  "terminalOptions",
  "onData",
  "onReady",
  "onTap",
  "webglHooks",
  "webLinkHandler",
] as const satisfies readonly (keyof XtermOwnProps)[];

export const Xterm: Component<
  // Omit any HTML attribute the component's own props shadow, so the kit's typed
  // prop wins instead of intersecting into an unusable handler; everything else
  // (including the DOM `onResize` UIEvent handler, which the kit no longer
  // shadows) spreads onto the div.
  XtermOwnProps & Omit<JSX.HTMLAttributes<HTMLDivElement>, keyof XtermOwnProps>
> = (props) => {
  const [own, rest] = splitProps(props, OWN_KEYS);
  let container!: HTMLDivElement;
  let fitRaf = 0;

  // The measured grid (see `XtermHandle.grid`). Compared by value so a fit that
  // lands on the same cols×rows doesn't notify — consumers gate real work on
  // this, and a re-fit that measured nothing new is not an event.
  const [grid, setGrid] = createSignal<TerminalGrid | null>(null, {
    equals: (a, b) => (a && b ? sameGrid(a, b) : a === b),
  });

  /** Fit to the container's current box, and record the grid IF one could be
   *  genuinely measured.
   *
   *  Two ways the addon answers without measuring anything, and BOTH are
   *  declined here — a fabricated grid is precisely what `grid()` promises never
   *  to contain, and since the attach now carries the grid and the host performs
   *  a real resize, publishing a fabrication would SIGWINCH a live PTY to it.
   *
   *  ① No box at all. Gated on `clientWidth/clientHeight`, NOT
   *  `getBoundingClientRect()`: the addon reads the LAYOUT box off
   *  `getComputedStyle(parentElement)`, which CSS transforms do not scale, while
   *  the bounding rect is the VISUAL box, which they do. kolu's canvas tiles
   *  render under a transform, so the two are different facts — gating the
   *  addon's decision on a quantity the addon never reads lets the guard and the
   *  measurement disagree.
   *
   *  ② A present-but-degenerate box (a split dragged nearly closed, a panel
   *  mid-collapse, a tile mid-layout-transition). `proposeDimensions()` returns
   *  undefined only when there is no renderer/element at all; for a sliver box
   *  it still returns a grid, because the addon CLAMPS its answer up to its own
   *  {@link FIT_ADDON_MIN_COLS}×{@link FIT_ADDON_MIN_ROWS} floor. A clamped
   *  answer is the addon's floor, not a measurement, so it is refused in the
   *  same class as a 0×0 box.
   *
   *  (`fit()` no-ops on an unmeasurable box too; asking separately is what lets
   *  us tell "measured" from "declined to measure", which `fit()`'s void return
   *  cannot.) */
  const applyFit = () => {
    if (!core) return;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
    const proposed = core.addons.fit.proposeDimensions();
    if (
      !proposed ||
      !Number.isFinite(proposed.cols) ||
      !Number.isFinite(proposed.rows) ||
      proposed.cols <= FIT_ADDON_MIN_COLS ||
      proposed.rows <= FIT_ADDON_MIN_ROWS
    )
      return;
    // Only call `fit()` when the proposal actually differs from what the
    // terminal already has: `fit()` re-runs `proposeDimensions()` internally and
    // then no-ops on unchanged dims, so an unguarded call resolves styles twice
    // per animation frame per visible pane on the resize / divider-drag hot path
    // to reach the same outcome.
    if (
      proposed.cols !== core.terminal.cols ||
      proposed.rows !== core.terminal.rows
    )
      core.addons.fit.fit();
    // Read the grid back off the terminal rather than trusting `proposed`: fit()
    // is the one authority on what it applied, so the fact we publish is the
    // grid the terminal actually HAS.
    setGrid({ cols: core.terminal.cols, rows: core.terminal.rows });
  };

  const refit = () => {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(applyFit);
  };

  // See `XtermHandle.onceMeasured`. The one-shot-ness is latched in the DATA,
  // not in a mutable boolean the reader has to correlate with the effect body:
  // once the memo holds a grid it returns that same object by reference, so it
  // never notifies again.
  const onceMeasured = (fn: (measured: TerminalGrid) => void) => {
    const first = createMemo<TerminalGrid | null>((prev) => prev ?? grid());
    createEffect(
      on(first, (measured) => {
        if (measured) fn(measured);
      }),
    );
  };

  // The constructed core (terminal + addons), built asynchronously and read by
  // the theme/fontSize/visible effects below (which run in this same owner but
  // may tick before construction — hence the null guards). Its atlas-clear is
  // sourced from the WebGL handle, so it stays a separate ref.
  let core: XtermCore | null = null;
  let clearAtlas: (() => void) | null = null;

  // This component's OWN retained refs, released synchronously on disposal so no
  // leaked owner closure keeps the xterm graph reachable (#606). The lifecycle
  // disposes term+addons and attachWebGL releases the GPU context (its own
  // LIFO-earlier onCleanup); here we (1) cancel a pending refit rAF — an external
  // browser root that would otherwise stay parked in a background tab and fire
  // `fit()` on a disposed terminal — and (2) null `core`/`clearAtlas`, whose
  // `addons.fit` holds a `_terminal` back-pointer FitAddon.dispose() never
  // clears, so a retained `core` alone re-forms the #606 retainer chain.
  onCleanup(() => {
    cancelAnimationFrame(fitRaf);
    core = null;
    clearAtlas = null;
  });

  // The scroll lock is solid-reactive, so it's created in the component owner.
  const scrollLock = createScrollLock(own.scrollLockEnabled);

  createXtermLifecycle(
    () => container,
    // A thunk, not a snapshot: the lifecycle re-reads this AFTER the font await,
    // so a `theme`/`fontSize` that changed mid-load builds with the latest value.
    () => ({
      terminalOptions: {
        ...(own.terminalOptions ?? {}),
        theme: own.theme,
        fontSize: own.fontSize,
        fontFamily: own.fontFamily,
      },
      webLinkHandler: own.webLinkHandler,
    }),
    (c: XtermCore) => {
      core = c;
      const term = c.terminal;

      const webgl = attachWebGL(term, own.webgl, own.webglHooks);
      clearAtlas = webgl.clearTextureAtlas;
      const recovery = createRenderRecovery(term, () => own.visible);
      // App-switch return fires `focus` (not `visibilitychange`); force a sync
      // repaint so a parked-rAF frame doesn't stay frozen.
      makeEventListener(window, "focus", () => recovery.recover());

      scrollLock.attachToTerminal(term);
      // Wheel + pointer-held scroll inputs arm the latch (#1272).
      wireScrollIntent(container, scrollLock);

      // Single write door: rate coalesce (fullRate policy) → scroll-lock → term.
      const fullRate = () => own.fullRate?.() ?? true;
      const coalesce = createOutputCoalesce(fullRate, (data, onParsed) =>
        scrollLock.writeData(term, data, onParsed),
      );
      onCleanup(() => coalesce.dispose());
      createEffect(
        on(
          fullRate,
          (fr) => {
            if (fr) coalesce.flush();
          },
          { defer: true },
        ),
      );

      // Touch: xterm 6.0 ships no touch path. The soft-keyboard input surface is
      // null off a coarse pointer, so tap routing is desktop-inert; the scroll
      // bridge is always wired (harmless without touch events).
      const screen = enableSoftKeyboardInput(term);
      if (screen) {
        wireTouchTaps(screen, {
          onTap: own.onTap,
          onFocus: () => term.focus(),
        });
      }
      wireTouchScroll(container, term, scrollLock);

      // Click-to-focus on the host div's own padding only — xterm focuses body
      // clicks itself (and on touch the tap path owns focus). Scoping to
      // `e.target === container` fires solely for the wrapper padding.
      makeEventListener(container, "click", (e) => {
        if (e.target === container) term.focus();
      });
      // Prevent the browser context menu so right-click reaches the terminal.
      makeEventListener(container, "contextmenu", (e: Event) =>
        e.preventDefault(),
      );

      // Keystrokes out — the consumer's callback owns any filtering/rewriting.
      term.onData(own.onData);
      // No `own.visible` gate: `applyFit` already declines an unmeasurable box
      // (display:none reports a 0 client box), so a second, weaker predicate
      // for the same question could only ever disagree with the real one.
      createResizeObserver(() => container, refit);

      const handle: XtermHandle = {
        terminal: term,
        container,
        addons: c.addons,
        scrollLock,
        write: (data, onParsed) => coalesce.write(data, onParsed),
        clearPendingOutput: () => {
          // Outer buffers first, then xterm's own async write queue — otherwise
          // a coalesced batch already past `term.write` still parses after
          // `terminal.reset()` and contaminates the replacement snapshot.
          coalesce.clear();
          scrollLock.dropPending();
          clearWriteQueue(term);
        },
        webgl,
        recovery,
        refit,
        grid,
        onceMeasured,
      };
      // Initial fit BEFORE onReady, so `grid` already carries this pane's real
      // measurement by the time the consumer wires policy against it. A hidden
      // pane measures NOTHING here and `grid()` stays null — which is the point:
      // the consumer then has no grid to attach against and waits, instead of
      // attaching at the invented 80×24. Nothing is published imperatively: the
      // grid signal is the one door this fact leaves through, so the consumer's
      // own effect over `grid` covers the initial sizing and every later one
      // with no ordering to get right.
      applyFit();

      own.onReady(handle);
    },
  );

  // Live theme switching.
  createEffect(
    on(
      () => own.theme,
      (theme) => {
        if (!core) return;
        core.terminal.options.theme = theme;
        clearAtlas?.();
      },
      { defer: true },
    ),
  );
  // Live font-size: apply + refit + clear atlas.
  createEffect(
    on(
      () => own.fontSize,
      (size) => {
        if (!core) return;
        core.terminal.options.fontSize = size;
        refit();
        clearAtlas?.();
      },
      { defer: true },
    ),
  );
  // Re-fit when the pane becomes visible (display:none → visible).
  createEffect(
    on(
      () => own.visible,
      (visible) => {
        if (!visible || !core) return;
        scrollLock.reset();
        core.terminal.scrollToBottom();
        refit();
      },
      { defer: true },
    ),
  );

  return <div ref={container} {...rest} />;
};

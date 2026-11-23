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
import { BIRTH_GRID } from "../birthGrid";
import { gridForBox, sameGrid, type TerminalGrid } from "./grid";
import { clearWriteQueue } from "../internals";
import { measureGridBox } from "./measureBox";
import { createOutputCoalesce, type OutputCoalesce } from "./outputCoalesce";
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

/** What `<Xterm onReady>` hands the consumer — the live terminal plus every
 *  mechanism it wires policy against, all inside the component's reactive owner. */
export interface XtermHandle {
  terminal: XTerm;
  /** The mount element (also the consumer's own attribute host). */
  container: HTMLElement;
  addons: { search: SearchAddon; serialize: SerializeAddon };
  scrollLock: ScrollLock;
  /** Single write door: unfocused rate-coalesce → scroll-lock → term.write.
   *  `onParsed` fires when the chunk lands in xterm. */
  write: (data: string, onParsed?: () => void) => void;
  /** The TERMINAL just changed size — apply it HERE, in stream order.
   *
   *  The one way this pane's xterm ever changes size, and it travels the SAME
   *  door as {@link write}: after every byte already written and before every
   *  byte written next, including bytes the coalescer or an engaged scroll lock
   *  is still holding. That ordering is the whole content of the fact — a
   *  resize applied early reflows a screen out of bytes that were laid out for
   *  the size it just left.
   *
   *  Nothing measured drives this. The box decides what the pane ASKS for
   *  ({@link wantedGrid}); the stream decides what the terminal IS. */
  resize: (grid: TerminalGrid) => void;
  /** Drop everything the door is holding — coalesced bytes and any queued
   *  resize — without applying it (fresh snapshot). */
  clearPendingOutput: () => void;
  webgl: WebglHandle;
  recovery: RenderRecovery;
  /** Debounced fit — one call per animation frame (ResizeObserver fires fast). */
  refit: () => void;
  /** The grid this pane's BOX can hold — what it WANTS to be, measured against
   *  its own element. `null` until it has a measurement, and the ONE door that
   *  fact leaves the kit through.
   *
   *  Read this before doing anything that depends on having a real measurement:
   *  stating a size to the host, gating an attach. `terminal.cols/rows` is never
   *  null — an unmeasured xterm reports the 80×24 its constructor invents, and a
   *  hidden pane (`display:none`, a 0×0 box) can never be measured, so it keeps
   *  reporting that invented grid indefinitely. Gating on `wantedGrid()` makes
   *  that unrepresentable: no grid, no bytes.
   *
   *  It is NOT what the terminal is. The two differ for about a settle window
   *  plus a round trip after the box moves — longer while another viewer holds
   *  the terminal at its own size — and during that window the terminal is
   *  drawn at ITS size, aligned to the bottom-left of the box and clipped by it.
   *
   *  Compared by value, so it notifies once per REAL measurement change and
   *  never for a re-fit that measured nothing new — which is what lets a
   *  consumer drive its PTY-resize publish straight off this signal. */
  wantedGrid: Accessor<TerminalGrid | null>;
  /** The grid the xterm actually HAS — what the bytes in its buffer are laid
   *  out for. Moves only when {@link resize} applies a size the stream stated.
   *  Never null: a terminal always has a size, even the invented one it starts
   *  at. For diagnostics and for a consumer that has to draw the gap between
   *  the two. */
  termGrid: Accessor<TerminalGrid>;
  /** Run `fn` ONCE, with the first genuinely measured grid — immediately if one
   *  already exists, otherwise the moment the box first measures.
   *
   *  The kit owns this latch so no consumer re-derives "no grid, no bytes" by
   *  hand out of `wantedGrid()` plus a mutable boolean. Call it from `onReady`
   *  (it registers a reactive computation in the caller's owner). */
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
  /** Is the box this pane sits in the one its owner's LAYOUT DECIDED?
   *
   *  A fact the OWNER states — never something this component infers from
   *  timing or from the DOM settling. A pane mounts inside a tile that may not
   *  yet know its own shape (a split whose second pane's record has not
   *  arrived; a tile parked behind a maximized sibling), and the box it has in
   *  the meantime is a stand-in. Measuring it is not harmless: the measurement
   *  is what the consumer states to the host, and the host resizes a live PTY
   *  to it.
   *
   *  So this gates {@link applyFit} itself rather than gating a consumer's use
   *  of the result. While it is false the pane MEASURES NOTHING — `wantedGrid`
   *  keeps whatever it last held (null before the first decided measurement) —
   *  and the wrong size is not merely unpublished, it is never computed. When
   *  it turns true the pane measures once, synchronously in that same update,
   *  so the first reading a consumer can act on is a reading of the decided
   *  box. */
  boxDecided: boolean;
  /** Renderer gate — an accessor, never a snapshot: WHICH panes hold a GPU
   *  context is the consumer's budget policy. */
  webgl: Accessor<boolean>;
  /** The scroll-lock enable gate (e.g. a preference) — an accessor. */
  scrollLockEnabled: Accessor<boolean>;
  /** Full-rate paint gate (e.g. focused tile). Required — omitting it would
   *  silently restore pre-fix full-rate painting on every tile. */
  fullRate: Accessor<boolean>;
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
  "boxDecided",
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

  // The two grids this component keeps apart, and the whole of why it does.
  //
  // `wantedGrid` is what the BOX can hold — a measurement, which moves the
  // instant a divider is dragged or the font is zoomed. `termGrid` is what the
  // xterm IS — which moves only when the attach stream says the pty's mirror
  // moved. They used to be one signal, and one fact standing for two is exactly
  // what the bug was: the pane resized itself the moment its box changed, while
  // the pty resized a settle window plus a round trip later, so everything the
  // program wrote in between was laid out for one grid and parsed at the other
  // (kolu#2362).
  //
  // Value-compared so a fit that lands on the same cols×rows doesn't notify —
  // consumers gate real work on this, and a re-fit that measured nothing new is
  // not an event.
  const gridEquals = (a: TerminalGrid | null, b: TerminalGrid | null) =>
    a && b ? sameGrid(a, b) : a === b;
  const [wantedGrid, setWantedGrid] = createSignal<TerminalGrid | null>(null, {
    equals: gridEquals,
  });
  // Seeded with the constructor's invented 80×24 (`BIRTH_GRID`) and corrected
  // the moment a terminal exists — honest, because an unmeasured xterm really
  // is that size. It is never null, which is what separates it from
  // `wantedGrid`: the question "has this pane measured?" has exactly one
  // answer, and this is not it.
  const [termGrid, setTermGrid] = createSignal<TerminalGrid>(
    { ...BIRTH_GRID },
    { equals: sameGrid },
  );

  /** Measure the container's current box and record what it could HOLD —
   *  `measureGridBox` + `gridForBox`, kolu's own measurement rather than the
   *  renderer's (`./grid` states why).
   *
   *  It does not touch the terminal. A fit is a reading of this pane's box, and
   *  the pane's box has no authority over how big the terminal is: that is the
   *  pty's, and it arrives on the attach stream (see {@link XtermHandle.resize}).
   *  What the consumer does with this reading is state it to the host and wait.
   *
   *  `gridForBox` returns null for a box that cannot be measured, and that
   *  null is honoured rather than patched: a fabricated grid is precisely what
   *  `wantedGrid()` promises never to contain, and since the attach carries the
   *  grid and the host performs a real resize, publishing one would SIGWINCH a
   *  live PTY to it.
   *
   *  The one thing decided HERE is the no-box gate, and it is
   *  `clientWidth/clientHeight` rather than `getBoundingClientRect()`: the
   *  measurement reads the LAYOUT box off `getComputedStyle(container)`, which
   *  CSS transforms do not scale, while the bounding rect is the VISUAL box,
   *  which they do. kolu's canvas tiles render under a transform, so gating on
   *  a quantity the measurement never reads would let the guard and the
   *  measurement disagree. */
  const applyFit = () => {
    if (!core) return;
    // The OWNER's gate, read first: a box its layout has not decided is a
    // stand-in, and a measurement of it is a size this pane would go on to
    // state. See {@link XtermOwnProps.boxDecided}.
    if (!own.boxDecided) return;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
    const box = measureGridBox(core.terminal, container);
    const next = box && gridForBox(box);
    if (!next) return;
    setWantedGrid(next);
  };

  /** Apply a grid the STREAM stated, at this point in the stream — the ONE
   *  path by which this terminal ever changes size (see
   *  {@link XtermHandle.resize}).
   *
   *  Through the coalescer, not straight to the terminal: bytes may be sitting
   *  in the unfocused batch or in an engaged scroll lock's buffer, and they
   *  were written for the size the terminal has NOW. The door walks them out
   *  first and resizes behind them. */
  const applyStreamGrid = (next: TerminalGrid) => {
    if (!core) return;
    // Fail loud rather than silently skipping: a resize that does not travel
    // the write door is a resize that can overtake bytes, which is the whole
    // defect, and a quiet `return` would hide it behind a correct-looking pane.
    if (!coalesce) {
      throw new Error(
        "Xterm resize: coalesce missing while core is live — write-door invariant broken",
      );
    }
    coalesce.resize(next.cols, next.rows);
    // `termGrid` is NOT set here: under an engaged scroll lock the terminal has
    // applied nothing yet, and it is the terminal's own `onResize` that says
    // when it did. One writer, so the signal cannot claim a size the buffer
    // does not have.
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
    const first = createMemo<TerminalGrid | null>(
      (prev) => prev ?? wantedGrid(),
    );
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
  // Write-door coalesce — same owner as applyFit so a resize can flush old-grid
  // bytes before `terminal.resize` mutates cols/rows (see applyFit).
  let coalesce: OutputCoalesce | null = null;

  // This component's OWN retained refs, released synchronously on disposal so no
  // leaked owner closure keeps the xterm graph reachable (#606). The lifecycle
  // disposes term+addons and attachWebGL releases the GPU context (its own
  // LIFO-earlier onCleanup); here we (1) cancel a pending refit rAF — an external
  // browser root that would otherwise stay parked in a background tab and fire
  // a measurement at a disposed terminal — and (2) null `core`/`clearAtlas`,
  // whose addons hold `_terminal` back-pointers their own `dispose()` never
  // clears, so a retained `core` alone re-forms the #606 retainer chain.
  onCleanup(() => {
    cancelAnimationFrame(fitRaf);
    core = null;
    clearAtlas = null;
    coalesce = null;
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
      // Bytes and stream resizes BOTH go through it, in the order they arrived
      // — which is what makes a resize mean "the pty's mirror moved HERE"
      // rather than "the pty's mirror moved, roughly, around now".
      const fullRate = () => own.fullRate();
      const outputCoalesce = createOutputCoalesce(fullRate, {
        write: (data, onParsed) => scrollLock.writeData(term, data, onParsed),
        resize: (cols, rows) => scrollLock.resizeInOrder(cols, rows),
      });
      // The terminal is the authority on its own size, so the signal follows
      // its event rather than the call that asked: a resize held by an engaged
      // scroll lock has not happened until the flush, and this fires then.
      term.onResize(({ cols, rows }) => setTermGrid({ cols, rows }));
      setTermGrid({ cols: term.cols, rows: term.rows });
      coalesce = outputCoalesce;
      onCleanup(() => {
        outputCoalesce.dispose();
        // Same lifetime as core: assigned in this ready callback, nulled here
        // and in the component-level onCleanup. createXtermLifecycle fires
        // ready once — no second-ready identity guard.
        coalesce = null;
      });
      createEffect(
        on(
          fullRate,
          (fr) => {
            if (fr) outputCoalesce.flush();
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
          onTap: (...args) => own.onTap?.(...args),
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
      term.onData((data) => own.onData(data));
      // No `own.visible` gate: `applyFit` already declines an unmeasurable box
      // (a detached or zero-size host cannot fit), so a second, weaker predicate
      // for the same question could only ever disagree with the real one.
      createResizeObserver(() => container, refit);

      const handle: XtermHandle = {
        terminal: term,
        container,
        addons: c.addons,
        scrollLock,
        write: (data, onParsed) => outputCoalesce.write(data, onParsed),
        resize: applyStreamGrid,
        clearPendingOutput: () => {
          // Outer buffers first, then xterm's own async write queue — otherwise
          // a coalesced batch already past `term.write` still parses after
          // `terminal.reset()` and contaminates the replacement snapshot.
          outputCoalesce.clear();
          scrollLock.dropPending();
          clearWriteQueue(term);
        },
        webgl,
        recovery,
        refit,
        wantedGrid,
        termGrid,
        onceMeasured,
      };
      // Initial measurement BEFORE onReady, so `wantedGrid` already carries this
      // pane's real reading by the time the consumer wires policy against it. A
      // hidden pane measures NOTHING here and `wantedGrid()` stays null — which
      // is the point: the consumer then has no grid to attach against and waits,
      // instead of attaching at the invented 80×24. Nothing is published
      // imperatively: the signal is the one door this fact leaves through, so
      // the consumer's own effect over it covers the initial sizing and every
      // later one with no ordering to get right.
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
  // Re-fit against current geometry on reveal without changing the user's scroll position.
  createEffect(
    on(
      () => own.visible,
      (visible) => {
        if (!visible || !core) return;
        refit();
      },
      { defer: true },
    ),
  );
  // The box became DECIDED: measure it NOW, in this update, rather than on the
  // next animation frame `refit` would wait for.
  //
  // This is what makes the gate's promise hold. The owner flips the fact in the
  // same flush that put the decided geometry on the DOM — Solid applies a style
  // binding in a render effect, which runs BEFORE user effects — and
  // `measureGridBox` reads `getComputedStyle`, which forces layout. So the
  // reading taken here is of the decided box, and the FIRST value `wantedGrid`
  // can ever hold is that reading. A debounced re-fit would instead leave a
  // frame in which the gate is open and the measurement is still the stand-in's
  // — exactly the window this gate exists to close.
  createEffect(
    on(
      () => own.boxDecided,
      (decided) => {
        if (!decided || !core) return;
        cancelAnimationFrame(fitRaf);
        applyFit();
      },
      { defer: true },
    ),
  );

  // The mount box and the terminal inside it are now two different HEIGHTS for a
  // settle window plus a round trip after any box change (see
  // `XtermHandle.wantedGrid`), so the kit has to say where the terminal sits in
  // the gap. At the BOTTOM, at natural size, clipped by the box — never scaled,
  // which would blur every glyph for a quarter of a second on every divider
  // drag. Bottom because that is where the prompt and the newest output are: a
  // box that just grew shows a blank band at the TOP until the resize lands, and
  // a box that just shrank clips rows off the top the program is about to reflow
  // away anyway.
  //
  // A COLUMN, and the `align-items` default (`stretch`) left alone, because the
  // horizontal layout must not move at all. `.xterm` is `position: relative`
  // with no width of its own and its only in-flow child (`.xterm-screen`) has an
  // explicit pixel width, so as a ROW flex item it would shrink to the text's
  // width — taking the scrollbar with it, since `.xterm-viewport` is absolutely
  // positioned to `.xterm`'s own right edge. The last columns' worth of pixels
  // that `./grid` deliberately keeps free for that scrollbar would then sit
  // outside it. A column stretches the cross axis instead, which is the block
  // behaviour this replaces, and `justify-content: flex-end` anchors the one
  // axis that is meant to move.
  //
  // The leftover strip — a box that is not a whole number of rows high — moves
  // to the TOP and stays there, which is a change from the block layout that
  // left it below the last row. One anchor for both states: the last row's
  // bottom edge is the box's bottom edge whether or not the grids agree, so a
  // resize landing never jumps the text vertically.
  //
  // After the spread, deliberately: this is the kit's own invariant about the
  // relationship between the box and the terminal, not a default a consumer's
  // `style` may quietly override.
  return (
    <div
      ref={container}
      {...rest}
      style={{
        display: "flex",
        "flex-direction": "column",
        "justify-content": "flex-end",
        overflow: "hidden",
      }}
    />
  );
};

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
  createSignal,
  type JSX,
  on,
  onCleanup,
  splitProps,
} from "solid-js";
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

/** A terminal grid — cols × rows. */
export interface TerminalGrid {
  cols: number;
  rows: number;
}

/** What `<Xterm onReady>` hands the consumer — the live terminal plus every
 *  mechanism it wires policy against, all inside the component's reactive owner. */
export interface XtermHandle {
  terminal: XTerm;
  /** The mount element (also the consumer's own attribute host). */
  container: HTMLElement;
  addons: { fit: FitAddon; search: SearchAddon; serialize: SerializeAddon };
  scrollLock: ScrollLock;
  /** `scrollLock.writeData` bound to this terminal — the buffer-through-the-lock
   *  write the consumer's stream drives, `onParsed` firing when the chunk lands. */
  write: (data: string, onParsed?: () => void) => void;
  webgl: WebglHandle;
  recovery: RenderRecovery;
  /** Debounced fit — one call per animation frame (ResizeObserver fires fast). */
  refit: () => void;
  /** The grid this pane has actually MEASURED against its own box — `null`
   *  until it has one.
   *
   *  Read this before doing anything that depends on the grid being REAL.
   *  `terminal.cols/rows` is never null: an unmeasured xterm reports the 80×24
   *  its constructor invents, and a hidden pane (`display:none`, a 0×0 box) can
   *  never be measured, so it keeps reporting that invented grid indefinitely.
   *  Rendering host-serialized bytes against it paints a screen laid out for a
   *  width the terminal does not have. Gating on `grid()` makes that
   *  unrepresentable: no grid, no bytes. */
  grid: Accessor<TerminalGrid | null>;
}

interface XtermOwnProps {
  /** Live re-theme (clears the texture atlas). */
  theme: ITheme;
  /** Live refit + atlas clear. */
  fontSize: number;
  /** Fit gate — a hidden pane can't be measured, so it waits at xterm's 80×24. */
  visible: boolean;
  /** Renderer gate — an accessor, never a snapshot: WHICH panes hold a GPU
   *  context is the consumer's budget policy. */
  webgl: Accessor<boolean>;
  /** The scroll-lock enable gate (e.g. a preference) — an accessor. */
  scrollLockEnabled: Accessor<boolean>;
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
  /** Grid → PTY. Only ever called with a MEASURED grid (see `XtermHandle.grid`). */
  onResize: (size: TerminalGrid) => void;
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
  "fontFamily",
  "terminalOptions",
  "onData",
  "onResize",
  "onReady",
  "onTap",
  "webglHooks",
  "webLinkHandler",
] as const satisfies readonly (keyof XtermOwnProps)[];

export const Xterm: Component<
  // Omit the HTML attributes the component's own props shadow (e.g. the DOM
  // `onResize` UIEvent handler), so the typed grid-resize prop wins instead of
  // intersecting into an unusable handler; everything else spreads onto the div.
  XtermOwnProps & Omit<JSX.HTMLAttributes<HTMLDivElement>, keyof XtermOwnProps>
> = (props) => {
  const [own, rest] = splitProps(props, OWN_KEYS);
  let container!: HTMLDivElement;
  let fitRaf = 0;

  // The measured grid (see `XtermHandle.grid`). Compared by value so a fit that
  // lands on the same cols×rows doesn't notify — consumers gate real work on
  // this, and a re-fit that measured nothing new is not an event.
  const [grid, setGrid] = createSignal<TerminalGrid | null>(null, {
    equals: (a, b) => a?.cols === b?.cols && a?.rows === b?.rows,
  });

  /** Fit to the container's current box, and record the grid IF one could be
   *  measured. `proposeDimensions()` returns undefined for an unmeasurable box
   *  — which is exactly the case that matters: a `display:none` pane is 0×0, so
   *  it has no grid of its own and `grid()` must stay null rather than publish
   *  the 80×24 xterm's constructor invented. `fit()` makes the same check
   *  internally and no-ops; asking first is what lets us tell "measured" from
   *  "declined to measure", which `fit()`'s void return cannot. */
  const applyFit = () => {
    if (!core) return;
    const proposed = core.addons.fit.proposeDimensions();
    if (
      !proposed ||
      !Number.isFinite(proposed.cols) ||
      !Number.isFinite(proposed.rows) ||
      proposed.cols <= 0 ||
      proposed.rows <= 0
    )
      return;
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
      // Grid → PTY. Attach BEFORE the initial fit so the first sizing publishes
      // through the same path as every later resize.
      term.onResize(own.onResize);
      createResizeObserver(
        () => container,
        () => {
          // display:none triggers a 0×0 resize; skip fitting when hidden.
          if (own.visible) refit();
        },
      );

      const handle: XtermHandle = {
        terminal: term,
        container,
        addons: c.addons,
        scrollLock,
        write: (data, onParsed) => scrollLock.writeData(term, data, onParsed),
        webgl,
        recovery,
        refit,
        grid,
      };
      // Initial fit BEFORE onReady, so the grid → PTY publish happens before the
      // consumer's onReady wires anything that reads the grid. A hidden pane
      // measures NOTHING here and `grid()` stays null — which is the point: the
      // consumer then has no grid to attach against and waits, instead of
      // attaching at the invented 80×24.
      // onResize is already wired above; if xterm's default grid already matched
      // the fit target, onResize won't fire, so publish the measured grid here.
      if (own.visible) {
        applyFit();
        const measured = grid();
        if (measured) own.onResize(measured);
      }

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

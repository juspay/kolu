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
import { gridForBox, sameGrid, type TerminalGrid } from "./grid";
import { clearWriteQueue } from "../internals";
import { measureGridBox } from "./measureBox";
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

export type ScrollLock = ReturnType<typeof createScrollLock>;

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
   *  the size it just left. */
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
  visible: boolean;
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
  XtermOwnProps & Omit<JSX.HTMLAttributes<HTMLDivElement>, keyof XtermOwnProps>
> = (props) => {
  const [own, rest] = splitProps(props, OWN_KEYS);
  let container!: HTMLDivElement;
  let fitRaf = 0;

  const gridEquals = (a: TerminalGrid | null, b: TerminalGrid | null) =>
    a && b ? sameGrid(a, b) : a === b;
  const [wantedGrid, setWantedGrid] = createSignal<TerminalGrid | null>(null, {
    equals: gridEquals,
  });
  const [termGrid, setTermGrid] = createSignal<TerminalGrid>(
    { cols: 80, rows: 24 },
    { equals: sameGrid },
  );

  const applyFit = () => {
    if (!core) return;
    if (!own.boxDecided) return;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
    const box = measureGridBox(core.terminal, container);
    const next = box && gridForBox(box);
    if (!next) return;
    setWantedGrid(next);
  };

  const refit = () => {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(applyFit);
  };

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

  let core: XtermCore | null = null;
  let clearAtlas: (() => void) | null = null;

  onCleanup(() => {
    cancelAnimationFrame(fitRaf);
    core = null;
    clearAtlas = null;
  });

  const scrollLock = createScrollLock(own.scrollLockEnabled);

  createXtermLifecycle(
    () => container,
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
      wireScrollIntent(container, scrollLock);

      const fullRate = () => own.fullRate();
      const outputCoalesce = createOutputCoalesce(fullRate, {
        write: (data, onParsed) => scrollLock.writeData(term, data, onParsed),
        resize: (cols, rows) => scrollLock.resizeInOrder(cols, rows),
      });
      term.onResize(({ cols, rows }) => setTermGrid({ cols, rows }));
      setTermGrid({ cols: term.cols, rows: term.rows });
      onCleanup(() => {
        outputCoalesce.dispose();
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
      makeEventListener(container, "contextmenu", (e: Event) =>
        e.preventDefault(),
      );

      term.onData((data) => own.onData(data));
      createResizeObserver(() => container, refit);

      const handle: XtermHandle = {
        terminal: term,
        container,
        addons: c.addons,
        scrollLock,
        write: (data, onParsed) => outputCoalesce.write(data, onParsed),
        resize: (next) => outputCoalesce.resize(next.cols, next.rows),
        clearPendingOutput: () => {
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
      applyFit();

      own.onReady(handle);
    },
  );

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

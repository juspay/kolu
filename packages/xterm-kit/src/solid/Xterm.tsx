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
  type JSX,
  on,
  splitProps,
} from "solid-js";
import { createRenderRecovery, type RenderRecovery } from "./renderRecovery";
import { createScrollLock } from "./scrollLock";
import { wireScrollIntent } from "./scrollLockWiring";
import { enableSoftKeyboardInput } from "./softKeyboardInput";
import { wireTouchScroll, wireTouchTaps } from "./touch";
import { attachWebGL, type WebglLifecycleHooks } from "./webgl";
import { createXtermLifecycle, type XtermCore } from "./xtermLifecycle";

/** The scroll-lock latch instance shape (structural — no exported nominal). */
export type ScrollLock = ReturnType<typeof createScrollLock>;

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
  hasWebgl: Accessor<boolean>;
  clearTextureAtlas: () => void;
  textureAtlasSize: () => { w: number; h: number } | null;
  recovery: RenderRecovery;
  /** Debounced fit — one call per animation frame (ResizeObserver fires fast). */
  refit: () => void;
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
    Parameters<typeof createXtermLifecycle>[1]["terminalOptions"],
    "theme" | "fontSize" | "fontFamily"
  >;
  /** Keystrokes out (query-response filtering / sticky modifiers are policy). */
  onData: (data: string) => void;
  /** Grid → PTY. */
  onResize: (size: { cols: number; rows: number }) => void;
  /** The live handle, inside the reactive owner — wire policy here. */
  onReady: (handle: XtermHandle) => void;
  /** Touch tap resolver: return true if the tap was consumed (e.g. a ref was
   *  followed), else the soft keyboard is summoned. */
  onTap: (clientX: number, clientY: number) => boolean;
  /** Optional GPU-context lifecycle hooks (diagnostics). */
  webglHooks?: WebglLifecycleHooks;
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
] as const satisfies readonly (keyof XtermOwnProps)[];

export const Xterm: Component<
  // Omit the HTML attributes the component's own props shadow (e.g. the DOM
  // `onResize` UIEvent handler), so the typed grid-resize prop wins instead of
  // intersecting into an unusable handler; everything else spreads onto the div.
  XtermOwnProps & Omit<JSX.HTMLAttributes<HTMLDivElement>, keyof XtermOwnProps>
> = (props) => {
  const [own, rest] = splitProps(props, OWN_KEYS);
  let container!: HTMLDivElement;
  let fit: FitAddon | null = null;
  let fitRaf = 0;
  const refit = () => {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => fit?.fit());
  };

  // The live terminal + atlas-clear, built asynchronously and read by the
  // theme/fontSize/visible effects below (which run in this same owner but may
  // tick before construction — hence the null guards).
  let liveTerm: XTerm | null = null;
  let clearAtlas: (() => void) | null = null;

  // The scroll lock is solid-reactive, so it's created in the component owner.
  const scrollLock = createScrollLock(own.scrollLockEnabled);

  createXtermLifecycle(
    () => container,
    {
      terminalOptions: {
        ...(own.terminalOptions ?? {}),
        theme: own.theme,
        fontSize: own.fontSize,
        fontFamily: own.fontFamily,
      },
    },
    (core: XtermCore) => {
      const term = core.terminal;
      fit = core.addons.fit;
      liveTerm = term;

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
        addons: core.addons,
        scrollLock,
        write: (data, onParsed) => scrollLock.writeData(term, data, onParsed),
        hasWebgl: webgl.hasWebgl,
        clearTextureAtlas: webgl.clearTextureAtlas,
        textureAtlasSize: webgl.textureAtlasSize,
        recovery,
        refit,
      };
      own.onReady(handle);

      // Initial fit — after onReady, so the consumer's onResize is wired first.
      // If xterm's default grid already matched the fit target, onResize won't
      // fire, so publish the current grid manually too.
      if (own.visible) {
        core.addons.fit.fit();
        own.onResize({ cols: term.cols, rows: term.rows });
      }
    },
  );

  // Live theme switching.
  createEffect(
    on(
      () => own.theme,
      (theme) => {
        if (!liveTerm) return;
        liveTerm.options.theme = theme;
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
        if (!liveTerm) return;
        liveTerm.options.fontSize = size;
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
        if (!visible || !liveTerm) return;
        scrollLock.reset();
        liveTerm.scrollToBottom();
        refit();
      },
      { defer: true },
    ),
  );

  return <div ref={container} {...rest} />;
};

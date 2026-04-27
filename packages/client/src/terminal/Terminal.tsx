/**
 * Terminal component — owns xterm.js lifecycle, oRPC streaming, and resize fitting.
 *
 * Keyboard zoom is handled by createZoom() (zoom.ts) and consumed here
 * reactively via a fontSize signal.
 */

import { makeEventListener } from "@solid-primitives/event-listener";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITheme, Terminal as XTerm } from "@xterm/xterm";
import {
  type Component,
  createEffect,
  createSignal,
  getOwner,
  on,
  onCleanup,
  onMount,
  runWithOwner,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { SafeClipboardProvider, writeTextToClipboard } from "./clipboard";
import "@xterm/xterm/css/xterm.css";
import type { TerminalId } from "kolu-common";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import { FONT_FAMILY } from "terminal-themes";
import { matchesAnyShortcut } from "../input/keyboard";
import { createZoom } from "../input/zoom";
import { refitOnTabVisible } from "../refitOnTabVisible";
import { client, stream } from "../rpc/rpc";
import { isExpectedCleanupError } from "../rpc/streamCleanup";
import { createScrollLock } from "../scrollLock";
import { usePreferences } from "../settings/usePreferences";
import { isTouch } from "../useMobile";
import ScrollToBottom from "./ScrollToBottom";
import SearchBar from "./SearchBar";
import { registerTerminalRefs, unregisterTerminalRefs } from "./terminalRefs";
import { registerDiagnostics } from "./useTerminalDiagnostics";
import {
  trackCreate,
  trackDispose,
  trackLoseContextCalled,
} from "./webglTracker";

/** Sum `byteLength` of every BufferLine's `Uint32Array` in xterm's primary
 *  and alternate buffers. Reaches through private `_core._bufferService`,
 *  so every access is null-guarded — if xterm renames these fields in a
 *  future version, the probe reports `null` and the UI labels it "unknown"
 *  instead of crashing. Uses `length` + `get(i)` rather than iterating the
 *  private list array, because `CircularList.length` is the public view
 *  into a ring buffer with an arbitrary internal start offset. */
function readBufferBytes(
  term: XTerm,
): { primary: number; alternate: number } | null {
  const bufSvc = (
    term as unknown as {
      _core?: {
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
      };
    }
  )._core?._bufferService;
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

/** Fire-and-forget an async iterable, silently swallowing AbortErrors (expected on unmount). */
function consumeStream<T>(
  streamFn: () => Promise<AsyncIterable<T>>,
  onItem: (item: T) => void,
  label: string,
) {
  void (async () => {
    try {
      for await (const item of await streamFn()) onItem(item);
    } catch (err) {
      if (!isExpectedCleanupError(err)) {
        console.error(`${label} error:`, err);
      }
    }
  })();
}

/** Module-level counters for the #606 disposal audit. Exposed to window
 *  via `debug/consoleHooks.ts`. `mounts` increments once per component
 *  body execution; `cleanups` increments once per `onCleanup` firing.
 *  If `mounts - cleanups > liveComponentCount` after a mode-toggle run,
 *  some Terminal disposals are being skipped — that's the leak path. */
export const lifecycleCounters = { mounts: 0, cleanups: 0 };

/** ArrayBuffer → base64 without stack overflow (spread on large arrays blows the stack). */
function bufferToBase64(buf: ArrayBuffer): string {
  return btoa(
    Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join(""),
  );
}

const Terminal: Component<{
  terminalId: TerminalId;
  visible: boolean;
  /** When true, this terminal should grab keyboard focus. */
  focused?: boolean;
  theme: ITheme;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  /** Fired when the user interacts with this terminal (click/keyboard focus). */
  onFocus?: () => void;
  /** When true, this terminal lives in a sub-panel — it owns its own grid
   *  (its container is independent of the main viewport) and stays out of
   *  the viewport signal. Also used for e2e test selectors. */
  isSub?: boolean;
}> = (props) => {
  lifecycleCounters.mounts++;
  let containerRef!: HTMLDivElement;
  let terminal: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  const [searchAddon, setSearchAddon] = createSignal<SearchAddon | null>(null);
  const { preferences } = usePreferences();
  const scrollLock = createScrollLock(() => preferences().scrollLock);
  let fitRaf = 0;

  /** Debounce fit() to one call per animation frame — ResizeObserver fires rapidly. */
  function debouncedFit() {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => fitAddon?.fit());
  }

  const fontSize = createZoom(props.terminalId, () => props.visible);

  let streamAbort: AbortController | null = null;
  let webgl: WebglAddon | null = null;
  let webglCanvas: HTMLCanvasElement | null = null;
  let webglTrackerId: number | null = null;
  let disposeDiagnostics: (() => void) | null = null;
  /** True once this component's reactive owner has been disposed. Set by the
   *  synchronously-registered `onCleanup` below. The async `onMount` body
   *  checks this after each `await` and bails rather than creating xterm /
   *  WebGL state that no cleanup path can reach — the root of the #591
   *  orphan-canvas leak (SolidJS `onCleanup` registered inside a disposed
   *  owner is a silent no-op, so onCleanup inside the async body would not
   *  run when an `<Show>` toggle disposes the owner during a mode switch). */
  let disposed = false;
  const [hasWebgl, setHasWebgl] = createSignal(false);

  /** Clear WebGL texture atlas to fix font rendering corruption (issue #239). */
  function clearTextureAtlas() {
    webgl?.clearTextureAtlas();
  }

  /** Capability: only the focused+visible tile is allowed to hold a WebGL
   *  context — Chrome's per-tab limit (~16) is quickly exhausted in canvas
   *  mode where every tile renders simultaneously (issue #575). Non-focused
   *  tiles fall back to xterm's built-in DOM renderer via `WebglAddon.dispose()`. */
  const canUseWebgl = () => props.visible && props.focused !== false;
  /** Dispatch on user renderer policy:
   *  - `auto`: honor the capability gate (WebGL on focused+visible only).
   *  - `webgl`: WebGL on every tile (opt-in; reintroduces #575 risk at scale).
   *  - `dom`: force DOM everywhere (stable font on focus swap, lower GPU). */
  const shouldUseWebgl = () =>
    match(preferences().terminalRenderer)
      .with("auto", canUseWebgl)
      .with("webgl", () => true)
      .with("dom", () => false)
      .exhaustive();

  function loadWebgl() {
    if (!terminal || webgl) return;
    try {
      // Single owner of WebglAddon lifetime — any future construction-time
      // flag (e.g. preserveDrawingBuffer for screenshots, #574) must be
      // routed through this effect, not a parallel dispose/reconstruct path.
      const w = new WebglAddon();
      w.onContextLoss(() => unloadWebgl());
      terminal.loadAddon(w);
      webgl = w;
      // Capture the canvas the addon just appended so we can explicitly
      // release its GPU context on unload — see unloadWebgl.
      //
      // xterm's WebglRenderer constructor appends the LinkRenderLayer's 2D
      // canvas (`class="xterm-link-layer"`) to `.xterm-screen` before it
      // appends its own WebGL canvas (which has no class). A bare
      // `querySelector(".xterm-screen canvas")` returns the first match in
      // document order — the link layer — whose `getContext("webgl2")`
      // returns null, silently short-circuiting the `loseContext()` chain in
      // `unloadWebgl()`. Diagnosed via #595's `webglTracker`:
      // `contextsLost` stayed at 0 despite `loseContext-called` events
      // firing for every disposed canvas (#591). Exclude the link layer
      // explicitly so we grab the real WebGL canvas.
      webglCanvas =
        terminal.element?.querySelector<HTMLCanvasElement>(
          ".xterm-screen canvas:not(.xterm-link-layer)",
        ) ?? null;
      // Register for lifecycle observation (#591 debug). No-op if no canvas.
      if (webglCanvas)
        webglTrackerId = trackCreate(props.terminalId, webglCanvas);
      setHasWebgl(true);
    } catch {
      // WebGL unavailable — xterm's DOM renderer is the fallback
    }
  }

  function unloadWebgl() {
    const w = webgl;
    if (!w) return;
    // Null out first: `loseContext()` below fires `webglcontextlost`
    // synchronously, which re-enters this function via the addon's
    // `onContextLoss` listener. The guard above short-circuits the reentry.
    webgl = null;
    setHasWebgl(false);
    // Explicitly release the GPU context. xterm's dispose() removes the
    // canvas from the DOM but does NOT call WEBGL_lose_context.loseContext(),
    // so Chrome keeps the context alive on the detached canvas until GC.
    // Rapid focus changes create contexts faster than GC runs and overflow
    // Chrome's ~16-context-per-tab budget, at which point Chrome starts
    // evicting live contexts — including the focused tile's — producing a
    // flicker across every tile. loseContext() releases GPU memory in the
    // current microtask, keeping the live set at 1.
    if (webglTrackerId !== null) trackLoseContextCalled(webglTrackerId);
    webglCanvas
      ?.getContext("webgl2")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
    webglCanvas = null;
    w.dispose();
    if (webglTrackerId !== null) {
      trackDispose(webglTrackerId);
      webglTrackerId = null;
    }
  }

  // Re-fit and auto-focus when terminal becomes visible (display:none → visible).
  // Only auto-focus if this terminal should have focus (focused prop is true or unset).
  // defer: true skips the initial run (onMount handles first fit + focus).
  createEffect(
    on(
      () => props.visible,
      (visible) => {
        if (!visible || !terminal) return;
        scrollLock.reset();
        terminal.scrollToBottom();
        debouncedFit();
        if (props.focused !== false) terminal.focus();
      },
      { defer: true },
    ),
  );

  // Grab focus when the focused prop transitions to true (e.g. sub-panel toggle).
  createEffect(
    on(
      () => props.focused,
      (focused) => {
        if (focused && props.visible && terminal) {
          terminal.focus();
        }
      },
      { defer: true },
    ),
  );

  // Hand the single WebGL context to whichever tile is focused+visible.
  // defer: true — onMount handles the initial load before xterm is constructed.
  createEffect(
    on(
      shouldUseWebgl,
      (should) => {
        if (!terminal) return;
        if (should) loadWebgl();
        else unloadWebgl();
      },
      { defer: true },
    ),
  );

  // Refocus terminal when search bar closes — only if this terminal should have focus.
  createEffect(
    on(
      () => props.searchOpen,
      (open) => {
        if (!open && props.visible && props.focused !== false && terminal)
          terminal.focus();
      },
      { defer: true },
    ),
  );

  // Apply theme changes at runtime — xterm.js supports live theme switching.
  createEffect(
    on(
      () => props.theme,
      (theme) => {
        if (!terminal) return;
        terminal.options.theme = theme;
        clearTextureAtlas();
      },
      { defer: true },
    ),
  );

  /** Resize the server-side PTY so node-pty matches the xterm grid. */
  async function publishDimensions() {
    if (!terminal) return;
    const { cols, rows } = terminal;
    if (cols <= 0 || rows <= 0) return;
    try {
      await client.terminal.resize({ id: props.terminalId, cols, rows });
    } catch {
      // Terminal may have been killed mid-resize
    }
  }

  // Apply font-size changes reactively (initial value handled by XTerm constructor)
  createEffect(
    on(
      fontSize,
      (size) => {
        if (!terminal) return;
        terminal.options.fontSize = size;
        debouncedFit();
        clearTextureAtlas();
      },
      { defer: true },
    ),
  );

  // Cleanup registered SYNCHRONOUSLY at component body top — NOT inside the
  // async `onMount` below. If the reactive owner disposes during `onMount`'s
  // `await document.fonts.load(...)` (e.g. an `<Show>` toggle swapping a tile
  // in or out), any `onCleanup` registered after the await is a silent no-op
  // — the owner's cleanup list was already iterated at disposal.
  // The `disposed` flag is the bail signal for the async body below. Without
  // this, each mode-toggle race leaks a Terminal component instance
  // (orphan xterm + WebGL canvas + scrollback buffer) — the residual #591
  // leak after PRs #578/#596.
  onCleanup(() => {
    lifecycleCounters.cleanups++;
    disposed = true;
    streamAbort?.abort();
    cancelAnimationFrame(fitRaf);
    unregisterTerminalRefs(props.terminalId);
    disposeDiagnostics?.();
    disposeDiagnostics = null;
    unloadWebgl();
    terminal?.dispose();
    terminal = null;
    // Null out the other addon slots on this component's Context. xterm
    // addons hold `_terminal` back-pointers; until their Context slot is
    // cleared, the captured closures (e.g. `onClick={() => terminal?.focus()}`
    // on the container div, whose closure shares this Context) keep the
    // whole xterm graph reachable — verified via heap-snapshot BFS-from-root
    // for issue #606. `terminal = null` above only clears one of those slots.
    fitAddon = null;
    setSearchAddon(null);
    // Break the containerRef → __xterm → xterm Terminal bridge. The
    // containerRef DIV may be retained by SolidJS closures (verified via
    // heap-snapshot retainer walk: `context containerRef` and `context _el$2`
    // across disposed Terminal instances). As long as the DIV is alive and
    // carries `__xterm`, the entire xterm graph (InputHandler, CoreBrowserTerminal,
    // BufferLines, ~900 KB per instance) stays reachable. Clearing the property
    // makes xterm GC-eligible even if the DIV can't be collected yet.
    const el = containerRef as
      | (HTMLDivElement & { __xterm?: XTerm })
      | undefined;
    if (el) el.__xterm = undefined;
  });

  onMount(() => {
    // `onMount` expects a void-returning callback. The body has a single
    // `await` on `document.fonts.load(...)` before switching to synchronous
    // setup inside `runWithOwner`. Wrap the async portion in a `void` IIFE
    // with a top-level try/catch so rejections surface to the console instead
    // of disappearing into the unhandled-rejection stream — the concern
    // `noMisusedPromises` was flagging.
    //
    // Capture the component's reactive owner BEFORE the await. SolidJS's
    // global `Owner` is lost across any `await` boundary, so every primitive
    // called after the await (`createResizeObserver`, `makeEventListener`,
    // `createEffect`, and any `onCleanup` inside `@solid-primitives/*`) would
    // register its cleanup on a null owner — a silent no-op. That's why the
    // ResizeObserver callback + event listeners + their `containerRef`
    // closures were leaking 190+ `xterm Terminal` trees across mode toggles
    // (verified via heap-snapshot retainer walk: `context observer` ×205 →
    // ResizeObserver → `__xterm` on container div → entire xterm graph).
    // `runWithOwner` re-enters the captured owner for the post-await body so
    // library-internal `onCleanup` calls land on the right cleanup list.
    const owner = getOwner();
    void (async () => {
      try {
        // Wait for the terminal font to load before measuring cell dimensions.
        // Without this, the first terminal may mount before the font is available,
        // causing xterm to measure with the fallback monospace font — wrong metrics.
        await document.fonts.load(`1em ${FONT_FAMILY}`);
        if (disposed) return;
        runWithOwner(owner, () => {
          const term = new XTerm({
            fontFamily: FONT_FAMILY,
            theme: props.theme,
            fontSize: fontSize(),
            scrollback: DEFAULT_SCROLLBACK,
            cursorBlink: true,
            // Keep a solid block cursor even when xterm thinks we're unfocused.
            // The default 'outline' is a hollow box that is effectively invisible
            // at phone DPI, and xterm's WebGL renderer flips to the inactive style
            // whenever `document.hasFocus()` is false — unreliable on iOS Safari
            // with the soft keyboard up (CoreBrowserService.ts:55).
            cursorInactiveStyle: "block",
            // Required by SerializeAddon and ImageAddon for buffer access
            allowProposedApi: true,
          });
          terminal = term;

          fitAddon = new FitAddon();
          term.loadAddon(fitAddon);
          term.loadAddon(new WebLinksAddon());
          const search = new SearchAddon();
          term.loadAddon(search);
          setSearchAddon(search);
          term.loadAddon(
            new ClipboardAddon(undefined, new SafeClipboardProvider()),
          );
          term.loadAddon(new Unicode11Addon());
          term.unicode.activeVersion = "11";
          term.loadAddon(new ImageAddon());
          const serializeAddon = new SerializeAddon();
          term.loadAddon(serializeAddon);

          term.open(containerRef);
          // Click-to-focus on the host div: xterm's own click handler covers
          // the inner canvas, but clicks on the wrapper padding need to focus
          // too. Attach via addEventListener (not JSX onClick) so the host
          // div stays free of interactive props that would force a11y roles
          // — the actual interactive surface is the xterm canvas inside.
          containerRef.addEventListener("click", () => term.focus());
          // Mobile: route soft-keyboard input through `.xterm-screen` itself,
          // the way hterm does (libapps/hterm/js/hterm_scrollport.js:617-655).
          //
          // xterm's own hidden helper textarea already has spellcheck/autocorrect
          // disabled by the library (CoreBrowserTerminal.ts:448-450), but iOS
          // Safari still runs spell-check against the accumulated `textarea.value`
          // that `_syncTextArea()` parks at the cursor cell — hence the phantom
          // underlines. Making the screen element contenteditable gives mobile a
          // real focus target and lets us opt the whole input surface out of
          // correction features. `caret-color: transparent` keeps the native
          // contenteditable caret from fighting xterm's rendered cursor.
          //
          // Desktop is left alone — xterm's unmodified mousedown → textarea.focus
          // path works fine with a hardware keyboard and we don't want to risk
          // fighting its selection handling.
          if (isTouch()) {
            const screen = term.element?.querySelector(
              ".xterm-screen",
            ) as HTMLElement | null;
            if (screen) {
              screen.setAttribute("contenteditable", "true");
              screen.setAttribute("spellcheck", "false");
              screen.setAttribute("autocorrect", "off");
              screen.setAttribute("autocapitalize", "none");
              screen.setAttribute("autocomplete", "off");
              screen.setAttribute("aria-readonly", "true");
              screen.style.caretColor = "transparent";
              screen.style.outline = "none";
            }
          }
          // Expose for e2e tests: read buffer content at viewport position.
          (containerRef as HTMLDivElement & { __xterm?: XTerm }).__xterm = term;
          // Production path for handlers that need live xterm/addon refs
          // (e.g. export-as-PDF reads serializeAddon).
          registerTerminalRefs(props.terminalId, {
            xterm: term,
            serialize: serializeAddon,
            probes: {
              webglAtlas: () => {
                const a = webgl?.textureAtlas;
                return a ? { w: a.width, h: a.height } : null;
              },
              bufferBytes: () => readBufferBytes(term),
            },
          });
          // Diagnostics subscribes to hasWebgl via accessor — keeps hasWebgl
          // the single source of truth, no imperative updater to forget.
          disposeDiagnostics = registerDiagnostics(props.terminalId, {
            xterm: term,
            renderer: () => (hasWebgl() ? "webgl" : "dom"),
          });

          scrollLock.attachToTerminal(term);

          if (shouldUseWebgl()) loadWebgl();

          // xterm.js has attachCustomKeyEventHandler for intercepting keys.
          // Return false to prevent xterm from handling the key.
          term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
            // Let Cmd+key pass through to browser (except copy/paste without Shift)
            if (e.metaKey) {
              const key = e.key.toLowerCase();
              if ((key === "c" || key === "v") && !e.shiftKey) return true;
              return false;
            }

            // Linux/Windows Ctrl+C with selection: copy and suppress SIGINT.
            // No selection → fall through so xterm sends SIGINT (0x03) as before.
            // The metaKey branch above early-returns on macOS Cmd+C, so this
            // branch only reaches non-Mac Ctrl+C in practice — the explicit
            // `!isMac` guard is redundant.
            if (
              e.ctrlKey &&
              !e.shiftKey &&
              !e.altKey &&
              e.key === "c" &&
              term.hasSelection()
            ) {
              void writeTextToClipboard(term.getSelection()).catch(
                (err: Error) => toast.error(`Copy failed: ${err.message}`),
              );
              term.clearSelection();
              return false;
            }

            // Let browser handle Ctrl+V so it fires a paste event. Our capture-phase
            // paste listener uploads images; xterm's own paste handler covers text.
            if (e.ctrlKey && e.key === "v") return false;

            // Let any registered app shortcut bubble through to the capture-phase dispatcher
            if (matchesAnyShortcut(e)) return false;

            return true;
          });

          // Attach the resize listener before any initial sizing so the very
          // first fit()/resize() publishes and pings the PTY through the same
          // code path as every subsequent resize.
          term.onResize(() => void publishDimensions());

          // FitAddon.fit() only works when the container has real pixel
          // dimensions. Hidden terminals live inside a display:none ancestor
          // (see `hidden` classList on the wrapper below), so we can't measure
          // them — they wait at xterm's 80×24 default until they become visible,
          // at which point the visibility effect below calls debouncedFit().
          if (props.visible) {
            fitAddon.fit();
            if (props.focused !== false) term.focus();
          }

          // Track user-initiated focus for "remember last focused" in sub-panel
          if (props.onFocus && term.textarea) {
            makeEventListener(term.textarea, "focus", props.onFocus);
          }

          streamAbort = new AbortController();
          const signal = streamAbort.signal;

          // Attach stream: yields scrollback first, then live PTY output.
          // onRetry resets xterm before the retried iterator's first yield
          // (a fresh screenState snapshot) — otherwise it double-paints.
          consumeStream(
            () =>
              stream.attach(props.terminalId, {
                signal,
                onRetry: () => {
                  terminal?.reset();
                  scrollLock.reset();
                },
              }),
            (data) => {
              if (terminal) scrollLock.writeData(terminal, data);
            },
            "Terminal attach",
          );

          // fit() above only fires onResize when the grid actually changes.
          // If xterm's default 80×24 already matched the fit target, the listener
          // didn't run — publish manually so the PTY matches. Hidden terminals
          // stay at 80×24 until they become visible; the visibility effect below
          // runs debouncedFit() and publishes then.
          if (props.visible) void publishDimensions();

          // Filter terminal query responses from onData before sending to PTY.
          // The server's headless xterm already answers these; duplicates arriving
          // late over the network get printed as visible garbage.
          const csiResponse = /\x1b\[[?>=]?[\d;]*[cnRy]/; // DA1/DA2/DSR/CPR/DECRPM
          term.onData((data: string) => {
            if (csiResponse.test(data) || data.startsWith("\x1b]")) return;
            void client.terminal.sendInput({ id: props.terminalId, data });
          });

          createResizeObserver(
            () => containerRef,
            () => {
              // Skip fitting when hidden — display:none triggers a 0x0 resize that would
              // cause a server-side PTY resize, producing shell output and false activity.
              if (props.visible) debouncedFit();
            },
          );

          refitOnTabVisible(
            () => {
              debouncedFit();
              clearTextureAtlas();
            },
            () => props.visible,
          );
          // Prevent browser context menu so right-click reaches the terminal (mouse tracking)
          makeEventListener(containerRef, "contextmenu", (e: Event) =>
            e.preventDefault(),
          );

          // Touch-scroll the scrollback. xterm.js 6.0.0 declares
          // IViewport.handleTouchStart/Move types but Viewport.ts has zero
          // touch wiring, and the WebGL canvas eats touch events on the way
          // to the parent .xterm-viewport — so swipes inside the terminal
          // do nothing on mobile until we bridge them ourselves.
          //
          // Single-variable state machine: touchAnchorY is the Y baseline
          // that line conversion is measured from. null when idle, a number
          // while a swipe is in progress. On every emitted line the anchor
          // advances by exactly the consumed pixels, so the sub-line residue
          // lives implicitly in (currentY - touchAnchorY) on the next move
          // — no separate accumulator to keep in sync.
          //
          // scrollLock picks up the resulting term.onScroll for free, so
          // freezing live output while the user reads scrollback works
          // without any extra wiring.
          let touchAnchorY: number | null = null;
          makeEventListener(containerRef, "touchstart", (e: TouchEvent) => {
            // Multi-touch (pinch-zoom) passes through to the browser
            const first = e.touches[0];
            if (e.touches.length !== 1 || first === undefined) return;
            touchAnchorY = first.clientY;
          });
          makeEventListener(containerRef, "touchmove", (e: TouchEvent) => {
            // Multi-touch interrupts a swipe — drop the anchor so the next
            // single-finger move starts a fresh gesture instead of resuming
            // from a stale (possibly far-away) reference point.
            if (e.touches.length !== 1) {
              touchAnchorY = null;
              return;
            }
            if (touchAnchorY === null || !terminal) return;
            const screen = terminal.element?.querySelector(
              ".xterm-screen",
            ) as HTMLElement | null;
            if (!screen) return;
            const cellHeight = screen.clientHeight / terminal.rows;
            // Number.isFinite catches NaN (0/0 if rows is transiently 0) which
            // a bare `<= 0` check would miss — NaN poisons the anchor.
            if (!Number.isFinite(cellHeight) || cellHeight <= 0) return;
            const first = e.touches[0];
            if (first === undefined) return;
            const lines = Math.trunc(
              (first.clientY - touchAnchorY) / cellHeight,
            );
            if (lines === 0) return;
            // Down-swipe (positive delta) shows earlier scrollback → scrollLines(-N)
            terminal.scrollLines(-lines);
            touchAnchorY += lines * cellHeight;
          });
          makeEventListener(containerRef, "touchend", () => {
            touchAnchorY = null;
          });

          // Bridge browser clipboard images → PTY. Capture phase fires before
          // xterm's own paste handler on the textarea, letting us intercept
          // images while text paste falls through to xterm. Uses the native
          // paste event (not navigator.clipboard.read) so no explicit
          // clipboard-read permission is needed.
          async function uploadPastedImage(file: File) {
            const base64 = bufferToBase64(await file.arrayBuffer());
            try {
              await client.terminal.pasteImage({
                id: props.terminalId,
                data: base64,
              });
            } catch (err) {
              console.error("Failed to upload clipboard image:", err);
            }
          }

          makeEventListener(
            containerRef,
            "paste",
            (e: ClipboardEvent) => {
              const items = e.clipboardData?.items;
              if (!items) return;

              const imageItem = Array.from(items).find((i) =>
                i.type.startsWith("image/"),
              );
              const file = imageItem?.getAsFile();
              if (!file) return; // No image — let xterm handle text paste

              // Must stop propagation synchronously before the async upload,
              // otherwise xterm's paste handler would paste the image as garbled text.
              e.stopPropagation();
              e.preventDefault();
              void uploadPastedImage(file);
            },
            { capture: true },
          );

          // Cleanup is registered synchronously near the top of the component body
          // (see comment there). It references `terminal`, `webgl`, and the local
          // refs via closure, and handles null state if this onMount body never ran
          // to completion.
        });
      } catch (err) {
        console.error("Terminal onMount failed:", err);
      }
    })();
  });

  return (
    <div class="w-full h-full relative" classList={{ hidden: !props.visible }}>
      <Show when={searchAddon()}>
        {(addon) => (
          <SearchBar
            searchAddon={addon()}
            open={props.searchOpen}
            onClose={() => props.onSearchOpenChange(false)}
          />
        )}
      </Show>
      <ScrollToBottom
        visible={scrollLock.isLocked()}
        active={scrollLock.hasNewOutput()}
        onClick={() => {
          if (terminal) scrollLock.scrollToBottom(terminal);
          terminal?.focus();
        }}
      />
      <div
        ref={containerRef}
        // touch-manipulation: eliminate 300ms tap delay and prevent double-tap-to-zoom on mobile
        class="w-full h-full overflow-hidden touch-manipulation"
        data-terminal-id={props.terminalId}
        data-visible={props.visible ? "" : undefined}
        data-focused={props.focused !== false ? "" : undefined}
        data-sub-terminal={props.isSub ? "" : undefined}
        data-font-size={fontSize()}
        data-renderer={hasWebgl() ? "webgl" : "dom"}
      />
    </div>
  );
};

export default Terminal;

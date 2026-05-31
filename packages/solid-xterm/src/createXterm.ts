/** `createXterm` — the electricity socket for the browser terminal.
 *
 *  Owns the entire `@xterm/*` lifecycle: constructing `Terminal`, loading the
 *  eight addons, the single-WebGL-context dance (Chrome's ~16-context budget,
 *  #575/#591), the private-buffer byte probe, the disposal ordering that keeps
 *  the xterm graph GC-eligible (#606), the scroll-lock state machine, the iOS
 *  touch-scroll bridge xterm 6.0 still doesn't ship, and the reactive-owner
 *  capture/restore that keeps `@solid-primitives` cleanups from leaking across
 *  the `await` in mount (#591). It also registers the per-terminal refs +
 *  diagnostics (co-located in this package) and owns the reactivity for the
 *  three pure-mechanics inputs — theme, font size, renderer policy.
 *
 *  None of that is Kolu domain. The consumer (`kolu-client`'s `Terminal.tsx`)
 *  plugs its domain in through `XtermOptions` callbacks — stream attach, PTY
 *  resize/input, file-ref activation, keyboard routing, image/file upload —
 *  and receives an `XtermHandle` to drive the live terminal. The primitive
 *  knows nothing about oRPC, themes-by-name, sub-panels, or zoom; visibility /
 *  focus *policy* (when to fit, focus, publish) stays with the consumer.
 *
 *  Lifecycle contract: call `createXterm(...)` synchronously in the component
 *  body (so its effects + owner capture land on the component's reactive
 *  owner); call `handle.mount(container)` once from `onMount`; call
 *  `handle.dispose()` from a synchronously registered `onCleanup`. `mount` is
 *  async (it waits for the web font so cell metrics are correct) and bails if
 *  `dispose()` ran first. */

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
import type { TerminalId } from "kolu-common/surface";
import {
  type Accessor,
  createEffect,
  createSignal,
  getOwner,
  on,
  runWithOwner,
} from "solid-js";
import { createSafeClipboardProvider } from "./clipboard.ts";
import { registerDiagnostics } from "./diagnostics.ts";
import { createLineLinkProvider, type LineLinkMatch } from "./links.ts";
import { createScrollLock } from "./scrollLock.ts";
import {
  registerTerminalRefs,
  unregisterTerminalRefs,
} from "./terminalRefs.ts";
import {
  trackCreate,
  trackDispose,
  trackLoseContextCalled,
} from "./webglTracker.ts";

import "@xterm/xterm/css/xterm.css";

/** Renderer policy: honor the focus/visible capability gate (`auto`), force
 *  WebGL everywhere (`webgl`), or force the DOM renderer (`dom`). */
export type RendererPolicy = "auto" | "webgl" | "dom";

/** Minimal terminal context handed to the consumer's key handler — just
 *  enough to implement copy-selection without leaking the `Terminal`. */
export interface XtermKeyContext {
  getSelection: () => string;
}

/** Everything the consumer injects. Pure data + callbacks — the only xterm
 *  type that crosses the boundary is `ITheme` (re-exported from the package).
 *  `TLink` is the consumer's opaque link payload (Kolu uses its `LineRef`). */
export interface XtermOptions<TLink> {
  /** Per-terminal id — keys the refs/diagnostics/webgl-tracker registrations. */
  id: TerminalId;
  fontFamily: string;
  fontSize: Accessor<number>;
  theme: Accessor<ITheme>;
  scrollback: number;
  /** Renderer policy + whether this tile may currently hold the GPU context
   *  (focused + visible). Both accessors so the primitive's renderer effect
   *  reacts without re-reading Kolu state. */
  rendererPolicy: Accessor<RendererPolicy>;
  webglEligible: Accessor<boolean>;
  /** Whether this terminal is currently displayed. Hidden terminals live
   *  inside a `display:none` ancestor where `FitAddon.fit()` measures a 0×0
   *  box and would resize the grid to xterm's 80×24 minimum — which then
   *  publishes through `onResize` and resizes the server PTY, producing
   *  spurious shell output / false activity (the pre-extraction hidden-tile
   *  bug). The primitive consults this before every fit and before the
   *  initial mount-time fit/publish; the consumer re-fits on the
   *  hidden→visible transition. */
  visible: Accessor<boolean>;
  /** Whether scroll-lock is enabled (preference). */
  scrollLockEnabled: Accessor<boolean | undefined>;
  /** True on touch devices — gates the iOS soft-keyboard + touch-scroll path. */
  isTouch: () => boolean;

  /** Find linkable matches in one terminal line (Kolu's file-ref matcher). */
  matchLinks: (lineText: string) => LineLinkMatch<TLink>[];
  onLinkActivate: (payload: TLink, event: MouseEvent) => void;

  /** Open the snapshot+delta stream; return an async iterable of output.
   *  `onReset` fires before the retried iterator's fresh snapshot so the
   *  caller can clear the terminal to avoid double-paint. */
  attach: (ctx: {
    signal: AbortSignal;
    onReset: () => void;
  }) => Promise<AsyncIterable<string>>;
  /** Push user keystrokes / pasted text to the PTY (already filtered of VT
   *  query responses by the primitive). */
  sendInput: (data: string) => void;
  /** Resize the PTY to match the xterm grid. */
  resize: (cols: number, rows: number) => void;
  /** Write text to the system clipboard (OSC 52 provider + copy chord). */
  writeClipboard: (text: string) => Promise<void>;

  /** Full key policy — Kolu owns it (it consults `ACTIONS`, sticky modifiers,
   *  the shortcut dispatcher). Mirrors xterm's `attachCustomKeyEventHandler`:
   *  return true to let xterm handle the key, false to suppress it. `ctx`
   *  exposes `getSelection()` for the copy-selection chord. */
  handleKey: (e: KeyboardEvent, ctx: XtermKeyContext) => boolean;

  /** A pasted image / dropped file. Omit to disable that path. */
  onPasteImage?: (file: File) => void;
  onDropFile?: (file: File) => void;
  /** Fired when the user focuses the terminal textarea (sub-panel tracking). */
  onFocus?: () => void;
  /** Classify a stream error as expected (don't log). Defaults to AbortError
   *  only; Kolu passes its oRPC-aware `isExpectedCleanupError` so transparent
   *  reconnects stay silent exactly as before the extraction. */
  isExpectedStreamError?: (err: unknown) => boolean;
}

/** The live handle the consumer drives. Accessors are reactive; methods are
 *  null-safe before `mount` resolves / after `dispose`. */
export interface XtermHandle {
  mount: (container: HTMLElement) => Promise<void>;
  dispose: () => void;
  fit: () => void;
  /** Re-fit and clear the WebGL texture atlas — the tab-visible path, where
   *  glyph corruption (#239) needs the atlas cleared after a re-render. */
  refit: () => void;
  focus: () => void;
  /** Resize the PTY to the current grid (the "already matched fit" path). */
  publishDimensions: () => void;
  /** Flush scroll-locked output and snap to bottom (the button handler). */
  scrollToBottom: () => void;
  /** Reset scroll-lock and snap to bottom (visibility-change path). */
  resetScroll: () => void;
  /** Reactive: viewport is scroll-locked above the bottom. */
  isLocked: Accessor<boolean>;
  /** Reactive: new output arrived while locked. */
  hasNewOutput: Accessor<boolean>;
  /** Reactive: WebGL renderer is active (vs. DOM). */
  hasWebgl: Accessor<boolean>;
  /** Reactive: the live `SearchAddon`, or null before mount. */
  searchAddon: Accessor<SearchAddon | null>;
  /** The raw `Terminal`, for the e2e `__xterm` bridge only. */
  raw: () => XTerm | null;
}

/** Sum `byteLength` of every BufferLine's `Uint32Array` in xterm's primary
 *  and alternate buffers. Reaches through private `_core._bufferService`, so
 *  every access is null-guarded — if xterm renames these fields the probe
 *  reports `null` and the UI labels it "unknown" instead of crashing. Uses
 *  `length` + `get(i)` rather than iterating the private list array, because
 *  `CircularList.length` is the public view into a ring buffer with an
 *  arbitrary internal start offset. */
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

/** Construct an xterm controller. Call synchronously in the component body so
 *  its effects + owner capture register on the consumer's owner; nothing
 *  touches the DOM until `mount`. */
export function createXterm<TLink>(opts: XtermOptions<TLink>): XtermHandle {
  // Capture the reactive owner now, in the synchronous body. mount restores it
  // after its `await`, so the `@solid-primitives` cleanups registered during
  // setup land on this owner rather than a null one (the #591 leak path).
  const owner = getOwner();

  let terminal: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  let serializeAddon: SerializeAddon | null = null;
  let linkDisposable: { dispose(): void } | null = null;
  let disposeDiagnostics: (() => void) | null = null;
  const [searchAddon, setSearchAddon] = createSignal<SearchAddon | null>(null);
  const [hasWebgl, setHasWebgl] = createSignal(false);

  let streamAbort: AbortController | null = null;
  let webgl: WebglAddon | null = null;
  let webglCanvas: HTMLCanvasElement | null = null;
  let webglTrackerId: number | null = null;
  let disposed = false;
  let fitRaf = 0;

  // Scroll-lock state machine — composed from the package's own
  // `createScrollLock` so there is exactly ONE definition of the
  // freeze/buffer/flush logic (the attach stream writes through it; the
  // scroll-to-bottom control + `data-renderer`-adjacent UI read its signals).
  // Created synchronously in the body so its internal `createEffect` (clear
  // lock when the preference toggles off) lands on the consumer's owner.
  const scroll = createScrollLock(opts.scrollLockEnabled);

  function debouncedFit(): void {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => {
      // Never fit a hidden terminal: its `display:none` ancestor measures 0×0,
      // so FitAddon would resize to xterm's 80×24 minimum and publish a bogus
      // PTY resize (false activity). The consumer re-fits on hidden→visible.
      if (!opts.visible()) return;
      fitAddon?.fit();
    });
  }
  function clearTextureAtlas(): void {
    webgl?.clearTextureAtlas();
  }
  function publishDimensions(): void {
    if (!terminal) return;
    const { cols, rows } = terminal;
    if (cols <= 0 || rows <= 0) return;
    opts.resize(cols, rows);
  }

  function shouldUseWebgl(): boolean {
    const policy = opts.rendererPolicy();
    if (policy === "webgl") return true;
    if (policy === "dom") return false;
    if (policy === "auto") return opts.webglEligible();
    // Exhaustiveness guard: a future RendererPolicy variant is a compile error
    // here rather than silently falling through to "auto" behaviour.
    policy satisfies never;
    return opts.webglEligible();
  }

  function loadWebgl(): void {
    if (!terminal || webgl) return;
    try {
      // Single owner of WebglAddon lifetime — any future construction-time
      // flag (e.g. preserveDrawingBuffer for screenshots, #574) must route
      // through here, not a parallel dispose/reconstruct path.
      const w = new WebglAddon();
      w.onContextLoss(() => unloadWebgl());
      terminal.loadAddon(w);
      webgl = w;
      // xterm's WebglRenderer appends the LinkRenderLayer's 2D canvas
      // (`class="xterm-link-layer"`) before its own (class-less) WebGL canvas.
      // A bare `.xterm-screen canvas` returns the link layer first, whose
      // `getContext("webgl2")` is null, silently breaking the loseContext()
      // chain in unloadWebgl() (#591). Exclude the link layer explicitly.
      webglCanvas =
        terminal.element?.querySelector<HTMLCanvasElement>(
          ".xterm-screen canvas:not(.xterm-link-layer)",
        ) ?? null;
      if (webglCanvas) webglTrackerId = trackCreate(opts.id, webglCanvas);
      setHasWebgl(true);
    } catch {
      // WebGL unavailable — xterm's DOM renderer is the fallback.
    }
  }

  function unloadWebgl(): void {
    const w = webgl;
    if (!w) return;
    // Null out first: loseContext() below fires `webglcontextlost`
    // synchronously, re-entering via the addon's onContextLoss listener; the
    // guard above short-circuits the reentry.
    webgl = null;
    setHasWebgl(false);
    // xterm's dispose() detaches the canvas but does NOT call
    // WEBGL_lose_context.loseContext(), so Chrome keeps the GPU context alive
    // until GC. Rapid focus changes overflow Chrome's ~16-context budget and
    // it starts evicting live contexts (flicker). loseContext() frees GPU
    // memory in the current microtask, keeping the live set at 1.
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

  // --- Mechanics reactivity (theme / font size / renderer) ----------------
  // These three inputs are pure xterm concerns, so the primitive owns their
  // effects. `defer: true` skips the initial run — `mount` applies the
  // starting values via the constructor + the renderer gate. The `!terminal`
  // guards make pre-mount fires no-ops.
  createEffect(
    on(
      opts.theme,
      (theme) => {
        if (!terminal) return;
        terminal.options.theme = theme;
        clearTextureAtlas();
      },
      { defer: true },
    ),
  );
  createEffect(
    on(
      opts.fontSize,
      (size) => {
        if (!terminal) return;
        terminal.options.fontSize = size;
        debouncedFit();
        clearTextureAtlas();
      },
      { defer: true },
    ),
  );
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

  async function mount(container: HTMLElement): Promise<void> {
    // Wait for the terminal font before measuring cell dimensions — otherwise
    // xterm measures with the fallback monospace font and gets wrong metrics.
    await document.fonts.load(`1em ${opts.fontFamily}`);
    if (disposed) return;

    // Re-enter the captured owner: SolidJS's global Owner is lost across the
    // await above, so every `@solid-primitives` call below (which registers an
    // onCleanup) would otherwise land on a null owner and leak (#591).
    runWithOwner(owner, () => {
      const term = new XTerm({
        fontFamily: opts.fontFamily,
        theme: opts.theme(),
        fontSize: opts.fontSize(),
        scrollback: opts.scrollback,
        cursorBlink: true,
        // Solid block cursor even when xterm thinks we're unfocused — the
        // default 'outline' is invisible at phone DPI, and xterm's WebGL
        // renderer flips to the inactive style whenever document.hasFocus() is
        // false (unreliable on iOS Safari with the soft keyboard up).
        cursorInactiveStyle: "block",
        // Required by SerializeAddon and ImageAddon for buffer access.
        allowProposedApi: true,
      });
      terminal = term;

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      linkDisposable = term.registerLinkProvider(
        createLineLinkProvider(term, {
          match: opts.matchLinks,
          onActivate: opts.onLinkActivate,
        }),
      );
      const search = new SearchAddon();
      term.loadAddon(search);
      setSearchAddon(search);
      term.loadAddon(
        new ClipboardAddon(
          undefined,
          createSafeClipboardProvider(opts.writeClipboard),
        ),
      );
      term.loadAddon(new Unicode11Addon());
      term.unicode.activeVersion = "11";
      term.loadAddon(new ImageAddon());
      serializeAddon = new SerializeAddon();
      term.loadAddon(serializeAddon);

      term.open(container);

      // Scroll-lock onScroll wiring + self-registered cleanup (composed
      // primitive). Must run inside the restored owner — see runWithOwner above.
      scroll.attachToTerminal(term);

      // Click-to-focus on the host div's own padding only (xterm handles canvas
      // clicks; touch handled below). addEventListener (not JSX onClick) keeps
      // the host div free of interactive a11y roles.
      container.addEventListener("click", (e) => {
        if (e.target === container) term.focus();
      });

      if (opts.isTouch()) wireTouch(term, container);

      // Register the per-terminal refs + diagnostics for external consumers
      // (export-PDF, screenshot, the diagnostics dialog). Co-located in this
      // package; torn down in dispose().
      registerTerminalRefs(opts.id, {
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
      disposeDiagnostics = registerDiagnostics(opts.id, {
        xterm: term,
        renderer: () => (hasWebgl() ? "webgl" : "dom"),
      });

      if (shouldUseWebgl()) loadWebgl();

      // Key policy is entirely the consumer's; the primitive only adapts
      // xterm's handler shape and hands over a getSelection() context.
      term.attachCustomKeyEventHandler((e: KeyboardEvent) =>
        opts.handleKey(e, { getSelection: () => term.getSelection() }),
      );

      // Attach resize listener before any initial sizing so the first fit()
      // pings the PTY through the same path as every later resize.
      term.onResize(() => publishDimensions());

      if (opts.onFocus && term.textarea) {
        makeEventListener(term.textarea, "focus", opts.onFocus);
      }

      // Initial fit + publish BEFORE attaching the stream, so the first
      // snapshot renders at the measured grid rather than xterm's 80×24
      // default. Synchronous (not the RAF debounce) so cols/rows are correct
      // by the time attach() yields. `fit()` fires `onResize` → publish when
      // the grid changes; the explicit publish covers the case where the
      // measured grid already equals 80×24 (onResize wouldn't fire). Hidden
      // terminals can't be measured (0×0 under display:none) — they stay at
      // 80×24 until the consumer's visible→ effect refits.
      if (opts.visible()) {
        fitAddon.fit();
        publishDimensions();
      }

      streamAbort = new AbortController();
      const signal = streamAbort.signal;
      consumeStream(
        () =>
          opts.attach({
            signal,
            onReset: () => {
              term.reset();
              scroll.reset();
            },
          }),
        // Guard against the write-after-dispose microtask race: dispose()
        // sets `disposed` and calls streamAbort.abort() synchronously, but the
        // `for await` loop only exits on the next microtask — a chunk arriving
        // in that window would otherwise write to an already-disposed Terminal.
        (data) => {
          if (!disposed) scroll.writeData(term, data);
        },
        opts.isExpectedStreamError,
      );

      // Filter VT query responses (DA1/DSR/CPR) and OSC replies from onData —
      // the headless server xterm already answers these; late network
      // duplicates would print as visible garbage.
      const csiResponse = /\x1b\[[?>=]?[\d;]*[cnRy]/;
      term.onData((data: string) => {
        if (csiResponse.test(data) || data.startsWith("\x1b]")) return;
        opts.sendInput(data);
      });

      createResizeObserver(
        () => container,
        () => debouncedFit(),
      );
      makeEventListener(container, "contextmenu", (e: Event) =>
        e.preventDefault(),
      );
      wireUploads(container);
    });
  }

  /** Touch-scroll the scrollback + iOS soft-keyboard wiring. xterm 6.0
   *  declares the IViewport touch types but Viewport.ts has no touch wiring,
   *  and the WebGL canvas eats touch events before .xterm-viewport — so we
   *  bridge swipes ourselves. Single-variable state machine: `anchorY` is the
   *  baseline; on each emitted line it advances by the consumed pixels so the
   *  sub-line residue lives in (currentY - anchorY) on the next move. */
  function wireTouch(term: XTerm, container: HTMLElement): void {
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
      // iOS rejects the soft keyboard when focus shuffles mid-gesture from the
      // contenteditable to xterm's opacity-0 helper textarea. preventDefault
      // on pointerdown blocks the contenteditable auto-focus; defer focus() to
      // pointerup (still inside the gesture window), gated on a tap threshold
      // so scrolls don't summon the keyboard.
      const TAP_THRESHOLD_PX = 10;
      const isTap = (dx: number, dy: number) =>
        Math.hypot(dx, dy) <= TAP_THRESHOLD_PX;
      let activeTap: {
        pointerId: number;
        startX: number;
        startY: number;
      } | null = null;
      makeEventListener(screen, "pointerdown", (e: PointerEvent) => {
        e.preventDefault();
        activeTap = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
        };
      });
      makeEventListener(screen, "pointerup", (e: PointerEvent) => {
        if (activeTap === null || e.pointerId !== activeTap.pointerId) return;
        const { startX, startY } = activeTap;
        activeTap = null;
        if (!isTap(e.clientX - startX, e.clientY - startY)) return;
        term.focus();
      });
      makeEventListener(screen, "pointercancel", (e: PointerEvent) => {
        if (activeTap?.pointerId === e.pointerId) activeTap = null;
      });
    }

    let anchorY: number | null = null;
    makeEventListener(container, "touchstart", (e: TouchEvent) => {
      const first = e.touches[0];
      if (e.touches.length !== 1 || first === undefined) return;
      anchorY = first.clientY;
    });
    makeEventListener(container, "touchmove", (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        anchorY = null;
        return;
      }
      if (anchorY === null || !terminal) return;
      const sc = terminal.element?.querySelector(
        ".xterm-screen",
      ) as HTMLElement | null;
      if (!sc) return;
      const cellHeight = sc.clientHeight / terminal.rows;
      // Number.isFinite catches NaN (0/0 if rows is transiently 0).
      if (!Number.isFinite(cellHeight) || cellHeight <= 0) return;
      const first = e.touches[0];
      if (first === undefined) return;
      const lines = Math.trunc((first.clientY - anchorY) / cellHeight);
      if (lines === 0) return;
      // Down-swipe (positive delta) shows earlier scrollback → scrollLines(-N)
      terminal.scrollLines(-lines);
      anchorY += lines * cellHeight;
    });
    makeEventListener(container, "touchend", () => {
      anchorY = null;
    });
  }

  /** Paste-image (capture phase, before xterm's text-paste handler) and
   *  drag-and-drop file upload. Both delegate the upload to the consumer; the
   *  primitive only owns the DOM event plumbing + drop-target dataset. */
  function wireUploads(container: HTMLElement): void {
    const onPasteImage = opts.onPasteImage;
    if (onPasteImage) {
      makeEventListener(
        container,
        "paste",
        (e: ClipboardEvent) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          const imageItem = Array.from(items).find((i) =>
            i.type.startsWith("image/"),
          );
          const file = imageItem?.getAsFile();
          if (!file) return; // No image — let xterm handle text paste.
          // Stop synchronously before the async upload, else xterm pastes the
          // image as garbled text.
          e.stopPropagation();
          e.preventDefault();
          onPasteImage(file);
        },
        { capture: true },
      );
    }

    const onDropFile = opts.onDropFile;
    if (onDropFile) {
      makeEventListener(container, "dragover", (e: DragEvent) => {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        container.dataset.dropTarget = "";
      });
      makeEventListener(container, "dragleave", (e: DragEvent) => {
        // dragleave fires crossing child boundaries too; gate on the cursor
        // leaving the container so the highlight doesn't flicker mid-drag.
        const next = e.relatedTarget as Node | null;
        if (next && container.contains(next)) return;
        delete container.dataset.dropTarget;
      });
      makeEventListener(container, "drop", (e: DragEvent) => {
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        e.preventDefault();
        delete container.dataset.dropTarget;
        for (const file of files) onDropFile(file);
      });
    }
  }

  function dispose(): void {
    disposed = true;
    streamAbort?.abort();
    cancelAnimationFrame(fitRaf);
    unregisterTerminalRefs(opts.id);
    disposeDiagnostics?.();
    disposeDiagnostics = null;
    unloadWebgl();
    linkDisposable?.dispose();
    linkDisposable = null;
    terminal?.dispose();
    terminal = null;
    // Null the addon slots: xterm addons hold `_terminal` back-pointers, and
    // until their slot is cleared the captured closures keep the whole xterm
    // graph reachable (#606 heap-snapshot evidence).
    fitAddon = null;
    serializeAddon = null;
    setSearchAddon(null);
  }

  return {
    mount,
    dispose,
    fit: debouncedFit,
    refit: () => {
      debouncedFit();
      clearTextureAtlas();
    },
    focus: () => terminal?.focus(),
    publishDimensions,
    scrollToBottom: () => {
      if (terminal) scroll.scrollToBottom(terminal);
    },
    resetScroll: () => {
      scroll.reset();
      terminal?.scrollToBottom();
    },
    isLocked: scroll.isLocked,
    hasNewOutput: scroll.hasNewOutput,
    hasWebgl,
    searchAddon,
    raw: () => terminal,
  };
}

/** Fire-and-forget an async iterable, swallowing expected errors (AbortError
 *  on unmount, plus whatever `isExpected` matches). The caller's `attach`
 *  owns retry/reset semantics. */
function consumeStream(
  streamFn: () => Promise<AsyncIterable<string>>,
  onItem: (item: string) => void,
  isExpected?: (err: unknown) => boolean,
): void {
  void (async () => {
    try {
      for await (const item of await streamFn()) onItem(item);
    } catch (err) {
      const expected = isAbortError(err) || (isExpected?.(err) ?? false);
      if (!expected) console.error("Terminal attach error:", err);
    }
  })();
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

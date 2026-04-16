/**
 * Terminal component — owns xterm.js lifecycle, oRPC streaming, and resize fitting.
 *
 * Keyboard zoom is handled by createZoom() (zoom.ts) and consumed here
 * reactively via a fontSize signal.
 */

import {
  type Component,
  Show,
  onMount,
  onCleanup,
  createSignal,
  createEffect,
  on,
} from "solid-js";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import { makeEventListener } from "@solid-primitives/event-listener";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { SafeClipboardProvider } from "./clipboard";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { ImageAddon } from "@xterm/addon-image";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import { FONT_FAMILY } from "terminal-themes";
import { client, stream } from "../rpc/rpc";
import { isExpectedCleanupError } from "../rpc/streamCleanup";
import { matchesAnyShortcut } from "../input/keyboard";
import type { TerminalId } from "kolu-common";
import SearchBar from "./SearchBar";
import ScrollToBottom from "./ScrollToBottom";
import { createZoom } from "../input/zoom";
import { createScrollLock } from "../scrollLock";
import { isTouch } from "../useMobile";
import { useServerState } from "../settings/useServerState";
import { refitOnTabVisible } from "../refitOnTabVisible";
import { viewportDimensions, setViewportDimensions } from "../useViewport";
import { registerTerminalRefs, unregisterTerminalRefs } from "./terminalRefs";

export type RendererType = "webgl" | "canvas";
const [renderer, setRenderer] = createSignal<RendererType>("canvas");
export { renderer };

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
  let containerRef!: HTMLDivElement;
  let terminal: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  const [searchAddon, setSearchAddon] = createSignal<SearchAddon | null>(null);
  const { preferences } = useServerState();
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

  /** Clear WebGL texture atlas to fix font rendering corruption (issue #239). */
  function clearTextureAtlas() {
    webgl?.clearTextureAtlas();
  }

  // Main terminals inherit the viewport grid while they're hidden.
  // FitAddon can't measure a display:none container, so hidden instances
  // trust the value the visible terminal's FitAddon already published.
  // Sub-terminals measure their own pane via fit() and never read from
  // this signal. Visible main terminals ignore this too — their fit() is
  // authoritative, not a follower.
  createEffect(
    on(
      () => (props.isSub ? undefined : viewportDimensions()),
      (dims) => {
        if (!terminal || props.visible || !dims) return;
        terminal.resize(dims.cols, dims.rows);
      },
      { defer: true },
    ),
  );

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

  /** Push the terminal's current cols×rows to the world: publish to the
   *  shared viewport signal (main terminals only — sub-terminals have
   *  their own grid) and resize the server-side PTY so node-pty matches. */
  async function publishDimensions() {
    if (!terminal) return;
    const { cols, rows } = terminal;
    if (cols <= 0 || rows <= 0) return;
    if (props.visible && !props.isSub) setViewportDimensions(cols, rows);
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

  onMount(async () => {
    // Wait for the terminal font to load before measuring cell dimensions.
    // Without this, the first terminal may mount before the font is available,
    // causing xterm to measure with the fallback monospace font — wrong metrics.
    await document.fonts.load(`1em ${FONT_FAMILY}`);

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
    term.loadAddon(new ClipboardAddon(undefined, new SafeClipboardProvider()));
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(new ImageAddon());
    const serializeAddon = new SerializeAddon();
    term.loadAddon(serializeAddon);

    term.open(containerRef);
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
    });

    scrollLock.attachToTerminal(term);

    // WebGL for performance; auto-fallback to canvas on context loss (e.g. after system sleep)
    try {
      const w = new WebglAddon();
      w.onContextLoss(() => {
        w.dispose();
        webgl = null;
        setRenderer("canvas");
      });
      term.loadAddon(w);
      webgl = w;
      setRenderer("webgl");
    } catch {
      // WebGL unavailable — canvas renderer is the default
    }

    // xterm.js has attachCustomKeyEventHandler for intercepting keys.
    // Return false to prevent xterm from handling the key.
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Let Cmd+key pass through to browser (except copy/paste without Shift)
      if (e.metaKey) {
        const key = e.key.toLowerCase();
        if ((key === "c" || key === "v") && !e.shiftKey) return true;
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
    // dimensions. Hidden main terminals live inside a display:none ancestor
    // (see `hidden` classList on the wrapper below), so we can't measure
    // them — instead inherit whatever cols×rows the visible main terminal
    // already published to the viewport signal. Hidden sub-terminals have
    // no shared signal to read, so they wait until they become visible.
    // Fixes #398 (non-active sidebar previews stuck at 80×24 on cold load).
    if (props.visible) {
      fitAddon.fit();
      if (props.focused !== false) term.focus();
    } else if (!props.isSub) {
      const vp = viewportDimensions();
      if (vp) term.resize(vp.cols, vp.rows);
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

    // fit() and term.resize() above only fire onResize when the grid
    // actually changes. If xterm's default 80×24 already matched the
    // target, the listener didn't run — publish manually. Skip when we
    // haven't sized ourselves yet (hidden main terminal before the
    // viewport signal arrives, or hidden sub-terminal): publishing the
    // untouched 80×24 default would corrupt the viewport signal and
    // send a bogus PTY resize.
    const sized = props.visible || (!props.isSub && viewportDimensions());
    if (sized) void publishDimensions();

    // Filter terminal query responses from onData before sending to PTY.
    // The server's headless xterm already answers these; duplicates arriving
    // late over the network get printed as visible garbage.
    const csiResponse = /\x1b\[[\?>=]?[\d;]*[cnRy]/; // DA1/DA2/DSR/CPR/DECRPM
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
      if (e.touches.length !== 1) return;
      touchAnchorY = e.touches[0]!.clientY;
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
      const currentY = e.touches[0]!.clientY;
      const lines = Math.trunc((currentY - touchAnchorY) / cellHeight);
      if (lines === 0) return;
      // Down-swipe (positive delta) shows earlier scrollback → scrollLines(-N)
      terminal.scrollLines(-lines);
      touchAnchorY += lines * cellHeight;
    });
    makeEventListener(containerRef, "touchend", () => {
      touchAnchorY = null;
    });

    // Bridge browser clipboard images → PTY for Claude Code's Ctrl+V image paste.
    // Capture phase fires before xterm's own paste handler on the textarea,
    // letting us intercept images while text paste falls through to xterm.
    // Uses the native paste event (not navigator.clipboard.read) so no explicit
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
      // Forward Ctrl+V to PTY so Claude Code's xclip/wl-paste shim reads it
      void client.terminal.sendInput({
        id: props.terminalId,
        data: "\x16",
      });
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

    onCleanup(() => {
      streamAbort?.abort();
      unregisterTerminalRefs(props.terminalId);
      terminal?.dispose();
    });
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
        data-sub-terminal={props.isSub ? "" : undefined}
        data-font-size={fontSize()}
        onClick={() => terminal?.focus()}
      />
    </div>
  );
};

export default Terminal;

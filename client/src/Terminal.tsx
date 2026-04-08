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
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { ImageAddon } from "@xterm/addon-image";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import { FONT_FAMILY } from "./theme";
import { client } from "./rpc";
import { matchesAnyShortcut } from "./keyboard";
import type { TerminalId } from "kolu-common";
import SearchBar from "./SearchBar";
import ScrollToBottom from "./ScrollToBottom";
import { createZoom } from "./zoom";
import { createScrollLock } from "./scrollLock";
import { refitOnTabVisible } from "./refitOnTabVisible";

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
      if (!(err instanceof DOMException && err.name === "AbortError")) {
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
  /** When true, viewport freezes when user scrolls up (default: true). */
  scrollLockEnabled?: boolean;
  /** Whether this terminal lives in a sub-panel (used for e2e test selectors). */
  isSub?: boolean;
  /** Publish this terminal's cols×rows so sidebar previews can mirror them. */
  onDimensionsChange?: (cols: number, rows: number) => void;
  /** Cols×rows from the currently-visible terminal — used to size this
   *  instance when it's hidden (display:none means FitAddon can't measure
   *  its container). Keeps all mounted xterms on the same grid so sidebar
   *  previews render correctly on cold page load. */
  sharedDimensions?: { cols: number; rows: number };
}> = (props) => {
  let containerRef!: HTMLDivElement;
  let terminal: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  const [searchAddon, setSearchAddon] = createSignal<SearchAddon | null>(null);
  const scrollLock = createScrollLock(() => props.scrollLockEnabled);
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

  // Mirror the active terminal's grid while we're hidden. FitAddon can't
  // measure a display:none container, so hidden instances ride on whatever
  // cols×rows the active terminal published to the store. Skipped while
  // visible — the resize observer + fit() take over in that mode.
  createEffect(
    on(
      () => {
        const d = props.sharedDimensions;
        return d ? ([d.cols, d.rows] as const) : null;
      },
      (dims) => {
        if (!terminal || props.visible || !dims) return;
        terminal.resize(dims[0], dims[1]);
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
        debouncedFit();
        clearTextureAtlas();
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

  // Refocus terminal when search bar closes
  createEffect(
    on(
      () => props.searchOpen,
      (open) => {
        if (!open && props.visible && terminal) terminal.focus();
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

  /** Resize PTY to match frontend dimensions. */
  async function syncResize() {
    if (!terminal) return;
    const cols = terminal.cols;
    const rows = terminal.rows;
    if (cols <= 0 || rows <= 0) return;
    props.onDimensionsChange?.(cols, rows);
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
    term.loadAddon(new ClipboardAddon());
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(new ImageAddon());
    term.loadAddon(new SerializeAddon());

    term.open(containerRef);
    // Expose for e2e tests: read buffer content at viewport position.
    (containerRef as HTMLDivElement & { __xterm?: XTerm }).__xterm = term;

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

    // FitAddon.fit() only works when the container has real dimensions.
    // Hidden terminals live inside a display:none ancestor (see the `hidden`
    // classList on the wrapper div below) — fit() there silently no-ops and
    // leaves xterm at its 80×24 default. Instead, inherit the active
    // terminal's grid when we're hidden so the sidebar preview renders at
    // the right cols×rows on cold page load (regression #398).
    if (props.visible) {
      fitAddon.fit();
      term.focus();
    } else if (props.sharedDimensions) {
      term.resize(props.sharedDimensions.cols, props.sharedDimensions.rows);
    }

    // Track user-initiated focus for "remember last focused" in sub-panel
    if (props.onFocus && term.textarea) {
      makeEventListener(term.textarea, "focus", props.onFocus);
    }

    // Sync PTY size after fit and on subsequent resizes
    term.onResize(() => void syncResize());

    streamAbort = new AbortController();
    const signal = streamAbort.signal;

    // Attach stream: yields scrollback first, then live PTY output.
    consumeStream(
      () => client.terminal.attach({ id: props.terminalId }, { signal }),
      (data) => {
        if (terminal) scrollLock.writeData(terminal, data);
      },
      "Terminal attach",
    );

    // fitAddon.fit() / term.resize() above only fire onResize when dimensions
    // actually change. If the default 80×24 matches the target, no event
    // fires — sync manually. Skip the sync when we're hidden and have no
    // shared dimensions to publish: that would push the stale 80×24 default
    // to the store and to the server PTY.
    if (props.visible || props.sharedDimensions) void syncResize();

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

/**
 * Terminal component — owns xterm.js lifecycle, oRPC streaming, resize fitting, keyboard zoom.
 *
 * These concerns share the same volatility (all change together when
 * terminal behavior changes), so they belong in one module.
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
import { makePersisted } from "@solid-primitives/storage";
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
import { FONT_FAMILY } from "./theme";
import { client } from "./rpc";
import type { TerminalId } from "kolu-common";
import { DEFAULT_FONT_SIZE } from "kolu-common/config";
import { isPlatformModifier, ZOOM_KEYS } from "./keyboard";
import SearchBar from "./SearchBar";

const FONT_SIZE_KEY = "kolu-font-size";

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

/**
 * Read the browser clipboard for an image, upload it to the server's
 * clipboard shim directory, then forward Ctrl+V (\x16) to the PTY.
 * If no image is found or the Clipboard API is unavailable, \x16 is
 * still forwarded so text-mode Ctrl+V works unchanged.
 */
async function uploadClipboardImage(terminalId: TerminalId): Promise<void> {
  // Read clipboard — expected to fail (permission denied, API unavailable, no image).
  // Errors here are normal; only the RPC upload should surface failures.
  let base64: string | undefined;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith("image/"));
      if (imageType) {
        const blob = await item.getType(imageType);
        base64 = bufferToBase64(await blob.arrayBuffer());
        break;
      }
    }
  } catch {
    // Clipboard API unavailable or permission denied — no image to upload
  }
  if (base64) {
    try {
      await client.terminal.pasteImage({ id: terminalId, data: base64 });
    } catch (err) {
      console.error("Failed to upload clipboard image:", err);
    }
  }
  void client.terminal.sendInput({ id: terminalId, data: "\x16" });
}

const Terminal: Component<{
  terminalId: TerminalId;
  visible: boolean;
  theme: ITheme;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
}> = (props) => {
  let containerRef!: HTMLDivElement;
  let terminal: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  const [searchAddon, setSearchAddon] = createSignal<SearchAddon | null>(null);
  let fitRaf = 0;

  /** Debounce fit() to one call per animation frame — ResizeObserver fires rapidly. */
  function debouncedFit() {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => fitAddon?.fit());
  }

  const [fontSize, setFontSize] = makePersisted(
    createSignal(DEFAULT_FONT_SIZE),
    { name: FONT_SIZE_KEY, serialize: String, deserialize: Number },
  );

  let streamAbort: AbortController | null = null;

  // Re-fit and auto-focus when terminal becomes visible (display:none → visible).
  // defer: true skips the initial run (onMount handles first fit + focus).
  createEffect(
    on(
      () => props.visible,
      (visible) => {
        if (!visible || !terminal) return;
        debouncedFit();
        terminal.focus();
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
    try {
      await client.terminal.resize({ id: props.terminalId, cols, rows });
    } catch {
      // Terminal may have been killed mid-resize
    }
  }

  function updateFontSize(newSize: number) {
    if (!terminal) return;
    setFontSize(newSize);
    terminal.options.fontSize = newSize;
    debouncedFit();
  }

  /** Intercept Cmd/Ctrl +/- for zoom — only for the active (visible) terminal. */
  function handleZoomKeys(e: KeyboardEvent) {
    if (!props.visible) return;
    if (!isPlatformModifier(e)) return;
    const delta = ZOOM_KEYS[e.key];
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    updateFontSize(fontSize() + delta);
  }

  onMount(() => {
    const term = new XTerm({
      fontFamily: FONT_FAMILY,
      theme: props.theme,
      fontSize: fontSize(),
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

    // WebGL for performance; auto-fallback to canvas on context loss (e.g. after system sleep)
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        setRenderer("canvas");
      });
      term.loadAddon(webgl);
      setRenderer("webgl");
    } catch {
      // WebGL unavailable — canvas renderer is the default
    }

    // xterm.js has attachCustomKeyEventHandler for intercepting keys.
    // Return false to prevent xterm from handling the key.
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Let Cmd+key pass through to browser (except copy/paste)
      if (e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === "c" || key === "v") return true;
        return false;
      }

      // Intercept Ctrl+V to bridge browser clipboard → PTY for image paste.
      // Claude Code uses Ctrl+V (\x16) to trigger image paste from clipboard
      // via xclip/wl-paste. We read the browser clipboard first, upload any
      // image to the server's shim directory, then forward \x16 to the PTY.
      if (e.ctrlKey && e.key === "v" && e.type === "keydown") {
        void uploadClipboardImage(props.terminalId);
        return false; // Prevent xterm from sending \x16 (we send it manually after upload)
      }

      return true;
    });

    fitAddon.fit();
    if (props.visible) term.focus();

    // Sync PTY size after fit and on subsequent resizes
    term.onResize(() => void syncResize());

    streamAbort = new AbortController();
    const signal = streamAbort.signal;

    // Attach stream: yields scrollback first, then live PTY output
    consumeStream(
      () => client.terminal.attach({ id: props.terminalId }, { signal }),
      (data) => terminal?.write(data),
      "Terminal attach",
    );

    // fitAddon.fit() above only fires onResize when dimensions actually change.
    // If the default 80×24 matches the container, no event fires — sync manually.
    void syncResize();

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
    makeEventListener(window, "keydown", handleZoomKeys, { capture: true });
    // Prevent browser context menu so right-click reaches the terminal (mouse tracking)
    makeEventListener(containerRef, "contextmenu", (e: Event) =>
      e.preventDefault(),
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
      <div
        ref={containerRef}
        // touch-manipulation: eliminate 300ms tap delay and prevent double-tap-to-zoom on mobile
        class="w-full h-full overflow-hidden touch-manipulation"
        data-terminal-id={props.terminalId}
        data-visible={props.visible ? "" : undefined}
        data-font-size={fontSize()}
        onClick={() => terminal?.focus()}
      />
    </div>
  );
};

export default Terminal;

/**
 * Terminal component — owns ghostty lifecycle, oRPC streaming, resize fitting, keyboard zoom.
 *
 * These concerns share the same volatility (all change together when
 * terminal behavior changes), so they belong in one module.
 */

import { type Component, onMount, onCleanup, createSignal } from "solid-js";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import { makeEventListener } from "@solid-primitives/event-listener";
import { initGhostty, type Terminal as GhosttyTerminal } from "./ghostty";
import { TERMINAL_DEFAULTS } from "./theme";
import { client } from "./rpc";

const FONT_SIZE_KEY = "kolu-font-size";
const DEFAULT_FONT_SIZE = 14;
// Includes iPad/iPhone because browser keyboard events use metaKey on all Apple devices
const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
// Module-level to avoid re-creating on every write callback
const encoder = new TextEncoder();

/**
 * Run an async iterable to completion, silently ignoring AbortErrors.
 * AbortErrors are expected on unmount — the component aborts in-flight streams via AbortController.
 */
function consumeStream<T>(
  streamFn: () => Promise<AsyncIterable<T>>,
  onItem: (item: T) => void,
  label: string,
  onReady?: () => void,
) {
  (async () => {
    try {
      const stream = await streamFn();
      onReady?.();
      for await (const item of stream) onItem(item);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error(`${label} error:`, err);
      }
    }
  })();
}

/** Measure cell dimensions from canvas size and known grid dimensions. */
function measureCells(el: HTMLElement, cols: number, rows: number) {
  const canvas = el.querySelector("canvas");
  if (!canvas) throw new Error("No canvas found in terminal element");
  const { width, height } = canvas.getBoundingClientRect();
  return { cellWidth: width / cols, cellHeight: height / rows };
}

/** Calculate cols/rows to fill a container given cell dimensions. */
function fitToContainer(
  container: HTMLElement,
  cellWidth: number,
  cellHeight: number,
) {
  const { width, height } = container.getBoundingClientRect();
  return {
    cols: Math.floor(width / cellWidth),
    rows: Math.floor(height / cellHeight),
  };
}

const ZOOM_KEYS: Record<string, 1 | -1> = { "=": 1, "+": 1, "-": -1 };

const Terminal: Component<{
  terminalId: string;
  onConnected?: () => void;
  onExit?: (exitCode: number) => void;
}> = (props) => {
  let containerRef!: HTMLDivElement;
  let terminal: GhosttyTerminal | null = null;
  let cellWidth = 0;
  let cellHeight = 0;
  let currentCols = 80;
  let currentRows = 24;

  const [fontSize, setFontSize] = createSignal(
    Number(localStorage.getItem(FONT_SIZE_KEY)) || DEFAULT_FONT_SIZE,
  );

  let streamAbort: AbortController | null = null;

  /** Resize PTY first, then frontend (prevents output clobbering). */
  async function fit() {
    if (!terminal || cellWidth === 0) return;
    const { cols, rows } = fitToContainer(containerRef, cellWidth, cellHeight);
    if (cols <= 0 || rows <= 0) return;
    if (cols === currentCols && rows === currentRows) return;
    try {
      await client.terminal.resize({ id: props.terminalId, cols, rows });
      currentCols = cols;
      currentRows = rows;
      terminal.resize(cols, rows);
    } catch {
      // Terminal may have been killed mid-resize
    }
  }

  /** Double rAF ensures ghostty's canvas has re-rendered at the new size. */
  function remeasureAndFit() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ({ cellWidth, cellHeight } = measureCells(
          containerRef,
          currentCols,
          currentRows,
        ));
        void fit();
      });
    });
  }

  function updateFontSize(newSize: number) {
    if (!terminal) return;
    setFontSize(newSize);
    localStorage.setItem(FONT_SIZE_KEY, String(newSize));
    terminal.options.fontSize = newSize;
    remeasureAndFit();
  }

  /** Intercept Cmd/Ctrl +/- for zoom. */
  function handleZoomKeys(e: KeyboardEvent) {
    if (!(isMac ? e.metaKey : e.ctrlKey)) return;
    const delta = ZOOM_KEYS[e.key];
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    updateFontSize(fontSize() + delta);
  }

  onMount(async () => {
    const ghostty = await initGhostty();
    terminal = new ghostty.Terminal({
      ...TERMINAL_DEFAULTS,
      fontSize: fontSize(),
    });
    terminal.open(containerRef);

    // Wait one frame so ghostty's canvas has rendered and getBoundingClientRect returns real values
    await new Promise((r) => requestAnimationFrame(r));
    ({ cellWidth, cellHeight } = measureCells(
      containerRef,
      currentCols,
      currentRows,
    ));

    streamAbort = new AbortController();
    const signal = streamAbort.signal;

    // Attach stream: yields scrollback first, then live PTY output
    consumeStream(
      () => client.terminal.attach({ id: props.terminalId }, { signal }),
      (data) => terminal?.write(encoder.encode(data)),
      "Terminal attach",
      () => props.onConnected?.(),
    );

    // Exit stream: yields exit code once when PTY process terminates
    consumeStream(
      () => client.terminal.onExit({ id: props.terminalId }, { signal }),
      (exitCode) => {
        console.log(`PTY exited with code ${exitCode}`);
        props.onExit?.(exitCode);
      },
      "Terminal onExit",
    );

    await fit();

    // Send input: fire-and-forget for low latency (don't await server ack)
    terminal.onData((data: string) => {
      void client.terminal.sendInput({ id: props.terminalId, data });
    });

    createResizeObserver(containerRef, () => void fit());
    // Capture phase: intercept before ghostty's own keydown handler in bubble phase
    makeEventListener(window, "keydown", handleZoomKeys, { capture: true });

    onCleanup(() => {
      streamAbort?.abort();
      terminal?.dispose();
    });
  });

  return (
    <div
      ref={containerRef}
      class="w-full h-full overflow-hidden"
      data-font-size={fontSize()}
    />
  );
};

export default Terminal;

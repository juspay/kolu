/**
 * Terminal component — owns the full terminal feature:
 * ghostty lifecycle, oRPC streaming, resize fitting, keyboard zoom.
 *
 * These concerns share the same volatility (all change together when
 * terminal behavior changes), so they belong in one module.
 */

import { type Component, onMount, onCleanup, createSignal } from "solid-js";
import { initGhostty, type Terminal as GhosttyTerminal } from "./ghostty";
import { TERMINAL_DEFAULTS } from "./theme";
import { client } from "./rpc";

const FONT_SIZE_KEY = "kolu-font-size";
const DEFAULT_FONT_SIZE = 14;
const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

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

  // AbortController for oRPC streams
  let streamAbort: AbortController | null = null;

  /** Resize terminal to fill its container and notify the server.
   *  PTY-first: await server resize before frontend resize (prevents output clobbering). */
  async function fit() {
    if (!terminal || cellWidth === 0) return;
    const { cols, rows } = fitToContainer(containerRef, cellWidth, cellHeight);
    if (
      cols > 0 &&
      rows > 0 &&
      (cols !== currentCols || rows !== currentRows)
    ) {
      try {
        // Resize PTY first
        await client.terminal.resize({ id: props.terminalId, cols, rows });
        // Then resize frontend to match
        currentCols = cols;
        currentRows = rows;
        terminal.resize(cols, rows);
      } catch {
        // Terminal may have been killed mid-resize; ignore
      }
    }
  }

  /** Re-measure cell dimensions after font/layout changes, then re-fit.
   *  Double rAF ensures ghostty's canvas has re-rendered at the new size. */
  function remeasureAndFit() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const cells = measureCells(containerRef, currentCols, currentRows);
        cellWidth = cells.cellWidth;
        cellHeight = cells.cellHeight;
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

    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      e.stopPropagation();
      updateFontSize(fontSize() + 1);
    } else if (e.key === "-") {
      e.preventDefault();
      e.stopPropagation();
      updateFontSize(fontSize() - 1);
    }
  }

  onMount(async () => {
    const ghostty = await initGhostty();
    terminal = new ghostty.Terminal({
      ...TERMINAL_DEFAULTS,
      fontSize: fontSize(),
    });
    terminal.open(containerRef);

    // Measure cell dimensions after first render
    await new Promise((r) => requestAnimationFrame(r));
    const cells = measureCells(containerRef, currentCols, currentRows);
    cellWidth = cells.cellWidth;
    cellHeight = cells.cellHeight;

    // --- oRPC streaming: attach to terminal output ---
    streamAbort = new AbortController();

    // Attach stream: yields scrollback then live output
    (async () => {
      try {
        const stream = await client.terminal.attach(
          { id: props.terminalId },
          { signal: streamAbort!.signal },
        );
        props.onConnected?.();
        for await (const data of stream) {
          if (terminal) {
            terminal.write(new TextEncoder().encode(data));
          }
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          console.error("Terminal attach stream error:", err);
        }
      }
    })();

    // Exit stream: yields exit code once
    (async () => {
      try {
        const stream = await client.terminal.onExit(
          { id: props.terminalId },
          { signal: streamAbort!.signal },
        );
        for await (const exitCode of stream) {
          console.log(`PTY exited with code ${exitCode}`);
          props.onExit?.(exitCode);
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          console.error("Terminal onExit stream error:", err);
        }
      }
    })();

    // Send initial fit
    await fit();

    // Send input: fire-and-forget for low latency
    terminal.onData((data: string) => {
      void client.terminal.sendInput({ id: props.terminalId, data });
    });

    const observer = new ResizeObserver(() => void fit());
    observer.observe(containerRef);

    window.addEventListener("keydown", handleZoomKeys, { capture: true });

    onCleanup(() => {
      window.removeEventListener("keydown", handleZoomKeys, { capture: true });
      observer.disconnect();
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

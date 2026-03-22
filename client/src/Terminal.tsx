/**
 * Terminal component — owns ghostty lifecycle, oRPC streaming, resize fitting, keyboard zoom.
 *
 * These concerns share the same volatility (all change together when
 * terminal behavior changes), so they belong in one module.
 */

import {
  type Component,
  onMount,
  onCleanup,
  createSignal,
  createEffect,
  on,
} from "solid-js";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import { makeEventListener } from "@solid-primitives/event-listener";
import { initGhostty, type Terminal as GhosttyTerminal } from "./ghostty";
import { TERMINAL_DEFAULTS } from "./theme";
import { currentTheme } from "./themes";
import { client } from "./rpc";
import { isMac } from "./platform";

const FONT_SIZE_KEY = "kolu-font-size";
const DEFAULT_FONT_SIZE = 14;
// Module-level to avoid re-creating on every write callback
const encoder = new TextEncoder();

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
  visible: boolean;
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

  /** Focus ghostty's hidden textarea so keyboard input reaches this terminal. */
  function focusInput() {
    containerRef.querySelector("textarea")?.focus();
  }

  /** Force a full repaint so theme palette changes are visible. */
  function forceRepaint() {
    if (!terminal) return;
    const t = terminal as any;
    t.renderer?.render(t.wasmTerm, true, t.viewportY ?? 0, t);
  }

  // Re-measure, fit, force repaint, and auto-focus when terminal becomes visible.
  // defer: true skips the initial run (onMount handles first fit + focus).
  createEffect(
    on(
      () => props.visible,
      (visible) => {
        if (!visible) return;
        remeasureAndFit();
        // Theme may have changed while hidden — repaint with current palette
        requestAnimationFrame(() => forceRepaint());
        focusInput();
      },
      { defer: true },
    ),
  );

  // Apply theme changes at runtime via ghostty's renderer
  createEffect(
    on(
      () => currentTheme(),
      (named) => {
        if (!terminal) return;
        const t = terminal as any;
        if (!t.renderer) return;
        t.renderer.setTheme(named.theme);
        // Only repaint visible terminals — hidden ones repaint on visibility change
        if (props.visible) forceRepaint();
      },
      { defer: true },
    ),
  );

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
    // Guard: createEffect may fire before onMount finishes ghostty init
    if (!terminal) return;
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

  /** Intercept Cmd/Ctrl +/- for zoom — only for the active (visible) terminal. */
  function handleZoomKeys(e: KeyboardEvent) {
    if (!props.visible) return;
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

    // On macOS, stop Cmd+... shortcuts from reaching ghostty so they pass
    // through to the browser (e.g. Cmd+1 switches browser tabs, not "1" to PTY).
    // We intercept in capture phase on the container and stopPropagation so
    // ghostty's bubble-phase keydown listener never fires. Copy/paste are
    // excluded so the terminal keeps handling them.
    // Note: ghostty's attachCustomKeyEventHandler can't be used here because
    // it calls preventDefault() internally, which blocks the browser too.
    makeEventListener(
      containerRef,
      "keydown",
      (e: KeyboardEvent) => {
        if (!e.metaKey) return;
        const key = e.key.toLowerCase();
        if (key === "c" || key === "v") return; // keep copy/paste in terminal
        e.stopPropagation(); // prevent ghostty from capturing this event
      },
      { capture: true },
    );

    // Wait one frame so ghostty's canvas + textarea exist and getBoundingClientRect returns real values
    await new Promise((r) => requestAnimationFrame(r));
    if (props.visible) focusInput();
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
    );

    // Exit stream: yields exit code once when PTY process terminates
    consumeStream(
      () => client.terminal.onExit({ id: props.terminalId }, { signal }),
      (exitCode) => console.log(`PTY exited with code ${exitCode}`),
      "Terminal onExit",
    );

    await fit();

    // Send input: fire-and-forget for low latency (don't await server ack)
    terminal.onData((data: string) => {
      void client.terminal.sendInput({ id: props.terminalId, data });
    });

    createResizeObserver(
      () => containerRef,
      () => void fit(),
    );
    // Capture phase: intercept before ghostty's own keydown handler in bubble phase
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
    <div
      ref={containerRef}
      class="w-full h-full overflow-hidden"
      // Hide via display:none (not unmount) to preserve ghostty canvas state and scrollback
      style={{ display: props.visible ? undefined : "none" }}
      data-terminal-id={props.terminalId}
      data-visible={props.visible ? "" : undefined}
      data-font-size={fontSize()}
    />
  );
};

export default Terminal;

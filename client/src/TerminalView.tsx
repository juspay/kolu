import { type Component, onMount, onCleanup, createSignal } from "solid-js";
import {
  initGhostty,
  createTerminal,
  measureCells,
  fitToContainer,
  buildWsUrl,
  type GhosttyTerminal,
} from "./ghostty";
import type { WsClientMessage } from "kolu-common";

const FONT_SIZE_KEY = "kolu-font-size";
const DEFAULT_FONT_SIZE = 14;
const FONT_STEP = 1;

const TerminalView: Component<{ sessionId: string }> = (props) => {
  let containerRef!: HTMLDivElement;
  let terminal: GhosttyTerminal | null = null;
  let ws: WebSocket | null = null;
  let cellWidth = 0;
  let cellHeight = 0;
  let resizeObserver: ResizeObserver | null = null;

  const [fontSize, setFontSize] = createSignal(
    Number(localStorage.getItem(FONT_SIZE_KEY)) || DEFAULT_FONT_SIZE
  );

  function sendResize(cols: number, rows: number) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg: WsClientMessage = { type: "Resize", cols, rows };
    ws.send(JSON.stringify(msg));
  }

  function doFit() {
    if (!terminal || cellWidth === 0) return;
    const { cols, rows } = fitToContainer(containerRef, cellWidth, cellHeight);
    if (cols > 0 && rows > 0) {
      terminal.resize(cols, rows);
      sendResize(cols, rows);
    }
  }

  function updateFontSize(newSize: number) {
    if (!terminal) return;
    setFontSize(newSize);
    localStorage.setItem(FONT_SIZE_KEY, String(newSize));
    terminal.fontSize = newSize;

    // Recalculate cell dimensions after font change
    requestAnimationFrame(() => {
      const cells = measureCells(containerRef);
      cellWidth = cells.cellWidth;
      cellHeight = cells.cellHeight;
      doFit();
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    const mod = navigator.platform.includes("Mac") ? e.metaKey : e.ctrlKey;
    if (!mod) return;

    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      e.stopPropagation();
      updateFontSize(fontSize() + FONT_STEP);
    } else if (e.key === "-") {
      e.preventDefault();
      e.stopPropagation();
      updateFontSize(fontSize() - FONT_STEP);
    }
  }

  onMount(async () => {
    // Init ghostty-web WASM
    await initGhostty();
    terminal = createTerminal(fontSize());
    terminal.open(containerRef);

    // Measure cell dimensions after first render
    await new Promise((r) => requestAnimationFrame(r));
    const cells = measureCells(containerRef);
    cellWidth = cells.cellWidth;
    cellHeight = cells.cellHeight;

    // Connect WebSocket
    const url = buildWsUrl(props.sessionId);
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onmessage = (event) => {
      if (!terminal) return;
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(event.data));
      } else if (typeof event.data === "string") {
        // JSON control message (e.g., Exit)
        try {
          JSON.parse(event.data);
          // Handle server messages if needed
        } catch {
          // Not JSON, write as text
          terminal.write(new TextEncoder().encode(event.data));
        }
      }
    };

    ws.onopen = () => {
      // Send initial resize
      doFit();
    };

    // Terminal input → WebSocket
    terminal.onData((data: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // ResizeObserver for container
    resizeObserver = new ResizeObserver(() => doFit());
    resizeObserver.observe(containerRef);

    // Keyboard shortcuts
    window.addEventListener("keydown", handleKeydown, { capture: true });
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeydown, { capture: true });
    resizeObserver?.disconnect();
    if (ws) {
      ws.close();
      ws = null;
    }
    if (terminal) {
      terminal.dispose();
      terminal = null;
    }
  });

  return (
    <div
      ref={containerRef}
      class="w-full h-full overflow-hidden"
      data-font-size={fontSize()}
    />
  );
};

export default TerminalView;

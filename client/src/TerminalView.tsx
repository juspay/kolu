import { type Component, onMount, onCleanup, createSignal } from "solid-js";
import {
  initGhostty,
  createTerminal,
  measureCells,
  fitToContainer,
  buildWsUrl,
  type Terminal,
} from "./ghostty";
import type { WsClientMessage, WsServerMessage } from "kolu-common";
import type { WsStatus } from "./Header";

const FONT_SIZE_KEY = "kolu-font-size";
const DEFAULT_FONT_SIZE = 14;
const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

const TerminalView: Component<{
  sessionId: string;
  onWsStatus?: (status: WsStatus) => void;
}> = (props) => {
  let containerRef!: HTMLDivElement;
  let terminal: Terminal | null = null;
  let ws: WebSocket | null = null;
  let cellWidth = 0;
  let cellHeight = 0;
  let currentCols = 80;
  let currentRows = 24;

  const [fontSize, setFontSize] = createSignal(
    Number(localStorage.getItem(FONT_SIZE_KEY)) || DEFAULT_FONT_SIZE,
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
      currentCols = cols;
      currentRows = rows;
      terminal.resize(cols, rows);
      sendResize(cols, rows);
    }
  }

  function remeasureAndFit() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const cells = measureCells(containerRef, currentCols, currentRows);
        cellWidth = cells.cellWidth;
        cellHeight = cells.cellHeight;
        doFit();
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

  function handleKeydown(e: KeyboardEvent) {
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

  function handleServerMessage(msg: WsServerMessage) {
    switch (msg.type) {
      case "Exit":
        console.log(`PTY exited with code ${msg.exit_code}`);
        props.onWsStatus?.("closed");
        break;
    }
  }

  onMount(async () => {
    await initGhostty();
    terminal = createTerminal(fontSize());
    terminal.open(containerRef);

    // Measure cell dimensions after first render
    await new Promise((r) => requestAnimationFrame(r));
    const cells = measureCells(containerRef, currentCols, currentRows);
    cellWidth = cells.cellWidth;
    cellHeight = cells.cellHeight;

    // WebSocket
    ws = new WebSocket(buildWsUrl(props.sessionId));
    ws.binaryType = "arraybuffer";

    ws.onmessage = (event) => {
      if (!terminal) return;
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(event.data));
      } else if (typeof event.data === "string") {
        try {
          handleServerMessage(JSON.parse(event.data));
        } catch {
          terminal.write(new TextEncoder().encode(event.data));
        }
      }
    };

    ws.onopen = () => {
      props.onWsStatus?.("open");
      doFit();
    };

    ws.onclose = () => props.onWsStatus?.("closed");

    terminal.onData((data: string) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    });

    const observer = new ResizeObserver(() => doFit());
    observer.observe(containerRef);

    window.addEventListener("keydown", handleKeydown, { capture: true });

    onCleanup(() => {
      window.removeEventListener("keydown", handleKeydown, { capture: true });
      observer.disconnect();
      ws?.close();
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

export default TerminalView;

/**
 * Typed wrapper around ghostty-web terminal emulator.
 *
 * ghostty-web is dynamically imported to avoid blocking initial page load.
 * The Terminal renders onto an HTML canvas inside the target element.
 */

// ghostty-web doesn't ship TS types, so we declare what we use
interface GhosttyModule {
  init(): Promise<void>;
  Terminal: new (opts?: { fontSize?: number }) => GhosttyTerminal;
}

interface GhosttyTerminal {
  open(element: HTMLElement): void;
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
  onData(cb: (data: string) => void): void;
  onResize(cb: (size: { cols: number; rows: number }) => void): void;
  get fontSize(): number;
  set fontSize(size: number);
}

let ghosttyModule: GhosttyModule | null = null;

/** Initialize ghostty-web WASM. Idempotent. */
export async function initGhostty(): Promise<void> {
  if (ghosttyModule) return;
  const mod = (await import("ghostty-web")) as GhosttyModule;
  await mod.init();
  ghosttyModule = mod;
}

/** Create a new terminal instance. Call initGhostty() first. */
export function createTerminal(fontSize?: number): GhosttyTerminal {
  if (!ghosttyModule) throw new Error("ghostty-web not initialized");
  return new ghosttyModule.Terminal(fontSize ? { fontSize } : undefined);
}

/** Measure cell dimensions by dividing canvas size by known grid size. */
export function measureCells(
  el: HTMLElement,
  cols: number,
  rows: number,
): {
  cellWidth: number;
  cellHeight: number;
} {
  const canvas = el.querySelector("canvas");
  if (!canvas) throw new Error("No canvas found in terminal element");
  const rect = canvas.getBoundingClientRect();
  return {
    cellWidth: rect.width / cols,
    cellHeight: rect.height / rows,
  };
}

/** Calculate cols/rows to fill a container, given cell dimensions. */
export function fitToContainer(
  container: HTMLElement,
  cellWidth: number,
  cellHeight: number,
): { cols: number; rows: number } {
  const rect = container.getBoundingClientRect();
  return {
    cols: Math.floor(rect.width / cellWidth),
    rows: Math.floor(rect.height / cellHeight),
  };
}

/** Build WebSocket URL for a terminal session. */
export function buildWsUrl(sessionId: string): string {
  const loc = window.location;
  // In dev mode (Vite), the proxy handles /ws
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}/ws/${sessionId}`;
}

export type { GhosttyTerminal };

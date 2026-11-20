import type { TerminalId } from "kolu-common/surface";

export type WebglEvent =
  | {
      ts: number;
      kind: "create" | "dispose" | "loseContext-called" | "contextrestored";
    }
  | { ts: number; kind: "contextlost"; defaultPrevented: boolean };

interface Entry {
  id: number;
  terminalId: TerminalId;
  canvasRef: WeakRef<HTMLCanvasElement>;
  createdAt: number;
  disposedAt: number | null;
  loseContextCalledAt: number | null;
  events: WebglEvent[];
}

const MAX_ENTRIES = 100;
const MAX_EVENTS_PER_ENTRY = 20;
const RECENT_EVENTS_VIEW = 30;

const entries: Entry[] = [];
let nextId = 1;

function pushEvent(entry: Entry, ev: WebglEvent): void {
  entry.events.push(ev);
  if (entry.events.length > MAX_EVENTS_PER_ENTRY) entry.events.shift();
}

export function trackCreate(
  terminalId: TerminalId,
  canvas: HTMLCanvasElement,
): number {
  const id = nextId++;
  const now = Date.now();
  const entry: Entry = {
    id,
    terminalId,
    canvasRef: new WeakRef(canvas),
    createdAt: now,
    disposedAt: null,
    loseContextCalledAt: null,
    events: [{ ts: now, kind: "create" }],
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  canvas.addEventListener("webglcontextlost", (e) => {
    pushEvent(entry, {
      ts: Date.now(),
      kind: "contextlost",
      defaultPrevented: e.defaultPrevented,
    });
  });
  canvas.addEventListener("webglcontextrestored", () => {
    pushEvent(entry, { ts: Date.now(), kind: "contextrestored" });
  });

  return id;
}

export function trackLoseContextCalled(id: number): void {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  const now = Date.now();
  e.loseContextCalledAt = now;
  pushEvent(e, { ts: now, kind: "loseContext-called" });
}

export function trackDispose(id: number): void {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  const now = Date.now();
  e.disposedAt = now;
  pushEvent(e, { ts: now, kind: "dispose" });
}

export interface CanvasSizeEntry {
  canvasId: number;
  terminalId: TerminalId;
  width: number;
  height: number;
  bytesEst: number;
  isConnected: boolean;
  contextLost: boolean;
}

export interface WebglLifecycleSnapshot {
  totalCreated: number;
  disposed: number;
  aliveInDom: number;
  aliveDetached: number;
  gced: number;
  contextsLost: number;
  totalDomCanvases: number;
  aliveCanvases: CanvasSizeEntry[];
  recentEvents: (WebglEvent & { canvasId: number; terminalId: TerminalId })[];
}

export function webglLifecycleSnapshot(): WebglLifecycleSnapshot {
  let aliveInDom = 0;
  let aliveDetached = 0;
  let gced = 0;
  let contextsLost = 0;
  const allEvents: (WebglEvent & {
    canvasId: number;
    terminalId: TerminalId;
  })[] = [];
  const aliveCanvases: CanvasSizeEntry[] = [];

  for (const e of entries) {
    for (const ev of e.events) {
      allEvents.push({ ...ev, canvasId: e.id, terminalId: e.terminalId });
    }
    const canvas = e.canvasRef.deref();
    if (!canvas) {
      gced++;
      continue;
    }
    if (canvas.isConnected) aliveInDom++;
    else aliveDetached++;
    // Second `getContext("webgl2")` on an established canvas returns the
    // existing context object without creating a new one — safe to probe.
    const gl = canvas.getContext("webgl2");
    const lost = !!gl?.isContextLost();
    if (lost) contextsLost++;
    aliveCanvases.push({
      canvasId: e.id,
      terminalId: e.terminalId,
      width: canvas.width,
      height: canvas.height,
      bytesEst: canvas.width * canvas.height * 4,
      isConnected: canvas.isConnected,
      contextLost: lost,
    });
  }

  allEvents.sort((a, b) => a.ts - b.ts);
  aliveCanvases.sort((a, b) => {
    if (a.isConnected !== b.isConnected) return a.isConnected ? -1 : 1;
    return a.canvasId - b.canvasId;
  });

  return {
    totalCreated: entries.length,
    disposed: entries.filter((e) => e.disposedAt !== null).length,
    aliveInDom,
    aliveDetached,
    gced,
    contextsLost,
    totalDomCanvases: document.querySelectorAll("canvas").length,
    aliveCanvases,
    recentEvents: allEvents.slice(-RECENT_EVENTS_VIEW),
  };
}

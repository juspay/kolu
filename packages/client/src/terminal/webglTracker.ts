/** Debug-only lifecycle ledger for WebGL canvases created by xterm's
 *  WebglAddon. **Temporary: remove when #591 (zombie-context leak) is
 *  root-caused and fixed.**
 *
 *  Purpose: prior fix attempts reasoned from xterm source + spec docs and
 *  made the leak worse. This module observes instead of guesses. It keeps
 *  a `WeakRef` to every canvas created and, on snapshot, counts how many
 *  are still reachable in JS while detached from the DOM — the literal
 *  zombie-context count. Paired with a per-canvas event tape of
 *  `webglcontextlost` / `webglcontextrestored` firings, it answers the
 *  questions that spec reading alone cannot:
 *
 *  - After `loseContext()`, does `gl.isContextLost()` flip to true?
 *  - Does the browser fire `webglcontextrestored` after we asked to lose?
 *  - Does xterm's inline listener call `e.preventDefault()` before ours?
 *
 *  Strictly observational — never calls `preventDefault`,
 *  `stopPropagation`, or mutates the canvas / context / addon. Safe to
 *  ship to prod. */

import type { TerminalId } from "kolu-common";

/** Discriminated union: `defaultPrevented` is only meaningful for the
 *  `contextlost` event (it reads `e.defaultPrevented` at bubble phase,
 *  telling us whether an earlier listener — xterm's inline one — called
 *  `preventDefault()` asking the browser to attempt restoration). */
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
  /** Capped at MAX_EVENTS_PER_ENTRY (FIFO via shift-before-push). */
  events: WebglEvent[];
}

/** Cap to prevent long-running sessions from accumulating state forever.
 *  One entry per WebglAddon construction — Terminal.tsx focus switches are
 *  the dominant source, so 100 entries buys a long session history. */
const MAX_ENTRIES = 100;
/** Per-canvas event count is naturally bounded (~5 events per canvas in
 *  the happy path: create, loseContext-called, contextlost, [restored],
 *  dispose). Cap is a safety net for repeated lost/restored cycles. */
const MAX_EVENTS_PER_ENTRY = 20;
/** How many events the snapshot returns as a flattened, time-sorted tail. */
const RECENT_EVENTS_VIEW = 30;

const entries: Entry[] = [];
let nextId = 1;

function pushEvent(entry: Entry, ev: WebglEvent): void {
  entry.events.push(ev);
  if (entry.events.length > MAX_EVENTS_PER_ENTRY) entry.events.shift();
}

/** Register a canvas for lifecycle observation. Returns an id that
 *  subsequent `trackLoseContextCalled` / `trackDispose` calls use to
 *  correlate. Also attaches bubble-phase DOM listeners for
 *  `webglcontextlost` / `webglcontextrestored`. The listener closures
 *  capture only the module-scoped `entry` object (no strong canvas
 *  reference), so the WeakRef remains the canvas's only incoming
 *  reference and GC can still collect it. */
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

// When the FIFO cap evicts an entry, later `trackLoseContextCalled` /
// `trackDispose` calls for that id find nothing and silently return —
// that's intended: we've deliberately chosen to lose history older than
// MAX_ENTRIES rather than grow without bound.

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

export interface WebglLifecycleSnapshot {
  totalCreated: number;
  disposed: number;
  /** Deref returned a canvas AND canvas.isConnected — normal live state. */
  aliveInDom: number;
  /** Deref returned a canvas AND !canvas.isConnected — **zombie count**.
   *  Non-zero = confirmed leak. */
  aliveDetached: number;
  /** Deref returned undefined — canvas was GC'd. */
  gced: number;
  /** Canvas exists AND `gl.isContextLost()` returns true. */
  contextsLost: number;
  /** Flattened, time-sorted tail across all entries. */
  recentEvents: (WebglEvent & { canvasId: number; terminalId: TerminalId })[];
}

/** Walk entries, deref each WeakRef, count the states, and return a
 *  snapshot. Cheap — O(entries) with no DOM mutations. Safe to call from
 *  the DiagnosticInfo snapshot memo. */
export function webglLifecycleSnapshot(): WebglLifecycleSnapshot {
  let aliveInDom = 0;
  let aliveDetached = 0;
  let gced = 0;
  let contextsLost = 0;
  const allEvents: (WebglEvent & {
    canvasId: number;
    terminalId: TerminalId;
  })[] = [];

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
    if (gl && gl.isContextLost()) contextsLost++;
  }

  allEvents.sort((a, b) => a.ts - b.ts);

  return {
    totalCreated: entries.length,
    disposed: entries.filter((e) => e.disposedAt !== null).length,
    aliveInDom,
    aliveDetached,
    gced,
    contextsLost,
    recentEvents: allEvents.slice(-RECENT_EVENTS_VIEW),
  };
}

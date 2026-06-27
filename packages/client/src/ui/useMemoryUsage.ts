/**
 * Live memory readouts for the chrome bar's identity rail (and the Diagnostic
 * Info dialog) — one singleton subscription each consumer shares.
 *
 * Three figures, two sources:
 *   - `serverRssBytes` / `kavalRssBytes` ride the server-pushed `processMemory`
 *     cell (the server samples both; see `server/src/memorySampler.ts`).
 *   - `clientHeapUsedBytes` is a browser-local read off `performance.memory`,
 *     refreshed each second off the SHARED app clock (`getClockNow`) — no
 *     dedicated timer, so it never adds a visibility-blind interval (the clock
 *     already throttles itself in a hidden tab).
 */

import type { KavalMemory } from "kolu-common/surface";
import { toast } from "solid-sonner";
import {
  daemonTransportLive,
  localDaemonStatus,
} from "../kaval/useDaemonStatus";
import { getClockNow } from "../time/clock";
import { app } from "../wire";
import { readJsHeapUsedBytes } from "./memory";

const sub = app.cells.processMemory.use({
  onError: (err) => toast.error(`Memory readout error: ${err.message}`),
});

/** The kolu-server process's RSS in bytes, or `null` before the first server
 *  yield (it's always a real number once a sample lands — the server measures
 *  itself). */
export function serverRssBytes(): number | null {
  return sub.value()?.serverRssBytes ?? null;
}

/** The kaval daemon's memory as its honest three-way state, or `absent` before
 *  the first server yield. Internal — consumers read {@link kavalMemoryDisplay},
 *  which folds in the connected-now gate so the rail and dialog can't drift. */
function kavalMemory(): KavalMemory {
  return sub.value()?.kavalMemory ?? { status: "absent" };
}

/** The kaval daemon's memory projected for DISPLAY — the single source of truth
 *  for "what do we show for kaval memory", shared by the rail and the Diagnostic
 *  dialog so neither re-derives (and drifts on) the same THREE concerns:
 *
 *   1. **The transport-liveness floor.** `daemonStatus` arrives over the kolu ws;
 *      when that link is dead or silently half-open (`daemonTransportLive()` false)
 *      the retained status is STALE — the channel that would refresh it is gone — so
 *      a "connected" state can't be trusted and its kaval RSS is frozen. The kaval
 *      dot and uptime already floor on this; gating here makes the rail's
 *      `KavalMemReadout` and the Diagnostic dialog inherit the SAME floor, so a
 *      greyed "unknown" dot can't sit beside a stale MB figure (the #1568 class).
 *   2. **The connected-NOW gate.** `daemonStatus` flips the instant the daemon
 *      leaves `connected`, but the `processMemory` cell's kaval figure only
 *      clears on the next 5 s sampler tick — so a raw read would show a stale MB
 *      for a daemon that's already gone. Gating on the live state hides it at once.
 *   3. **The three-way unwrap.** `ok` → the byte figure; `error` (a believed-
 *      connected daemon whose poll failed) → a distinct marker so it never reads
 *      as "no daemon"; `absent` / not-connected → nothing.
 *
 *  Returns `{ kind: "ok", rssBytes }`, `{ kind: "error" }`, or `null` (show
 *  nothing). */
export function kavalMemoryDisplay():
  | { kind: "ok"; rssBytes: number }
  | { kind: "error" }
  | null {
  if (!daemonTransportLive()) return null;
  if (localDaemonStatus()?.state !== "connected") return null;
  const m = kavalMemory();
  if (m.status === "ok") return { kind: "ok", rssBytes: m.rssBytes };
  if (m.status === "error") return { kind: "error" };
  return null;
}

/** This browser's used JS heap in bytes, refreshed every second off the shared
 *  app clock, or `null` on non-Chromium browsers (which don't expose
 *  `performance.memory`). */
export function clientHeapUsedBytes(): number | null {
  // Re-read on each clock tick — reading the shared `now` signal in a tracking
  // context (JSX/memo) makes the consumer recompute every second.
  getClockNow()();
  return readJsHeapUsedBytes();
}

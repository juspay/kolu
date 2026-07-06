/**
 * Live memory readouts for the chrome bar's identity rail (and the Diagnostic
 * Info dialog) — one singleton subscription each consumer shares.
 *
 * Four figures, two sources:
 *   - `serverRssBytes` / `padiMemoryDisplay` / `kavalMemoryDisplay` ride the
 *     server-pushed `processMemory` cell. kolu-server samples its OWN RSS and
 *     FOLDS IN padi's `{ padi, kaval }` reading (padi owns kaval now, so padi is
 *     the source of that pair; see `server/src/memorySampler.ts`). Three
 *     server-side processes, one cell.
 *   - `clientHeapUsedBytes` is a browser-local read off `performance.memory`,
 *     refreshed each second off the SHARED app clock (`getClockNow`) — no
 *     dedicated timer, so it never adds a visibility-blind interval (the clock
 *     already throttles itself in a hidden tab).
 */

import type { ProcessRss } from "kolu-common/surface";
import { subErrorToast, useBindingScopedSub } from "../binding/bindings";
import {
  daemonTransportLive,
  localDaemonStatus,
} from "../kaval/useDaemonStatus";
import { getClockNow } from "../time/clock";
import { readJsHeapUsedBytes } from "./memory";

// W4 "the switch": two sources, two scopes.
//  - `serverRssBytes` is kolu-server's OWN RSS — host-INDEPENDENT (one kolu-server), so
//    it rides the shared `kolu.processMemory` cell; `useBindingScopedSub` still re-keys
//    the sub onto the active binding so the rail never reads a switched-away dead socket.
//  - padi + kaval RSS are PER-HOST facts (each host runs its own padi + kaval). They ride
//    the ACTIVE host's RE-SERVED `padi.processMemory` cell (A1), so after a switch the
//    rail shows the host you're viewing — not the boot default's memory.
const koluMemory = useBindingScopedSub((b) =>
  b.clients.kolu.cells.processMemory.use({
    onError: subErrorToast("Memory readout error"),
  }),
);
const padiMemory = useBindingScopedSub((b) =>
  b.clients.padi.cells.processMemory.use({
    onError: subErrorToast("Padi memory readout error"),
  }),
);

/** The kolu-server process's RSS in bytes, or `null` before the first server
 *  yield (it's always a real number once a sample lands — the server measures
 *  itself). */
export function serverRssBytes(): number | null {
  return koluMemory().value()?.serverRssBytes ?? null;
}

/** A per-process RSS reading projected for DISPLAY — `{ kind: "ok", rssBytes }`,
 *  `{ kind: "error" }` (a believed-up process whose read failed — a distinct
 *  marker so it never reads as "no process"), or `null` (show nothing). Floored on
 *  transport liveness: when the ws delivering the readout is dead or silently
 *  half-open, the retained figure is STALE — the channel that would refresh it is
 *  gone — so it reads as nothing rather than a frozen MB beside a greyed dot (the
 *  #1568 class). Shared by the rail and the Diagnostic dialog so neither re-derives
 *  (and drifts on) the projection. */
function displayRss(
  m: ProcessRss | undefined,
): { kind: "ok"; rssBytes: number } | { kind: "error" } | null {
  if (!daemonTransportLive()) return null;
  if (m?.status === "ok") return { kind: "ok", rssBytes: m.rssBytes };
  if (m?.status === "error") return { kind: "error" };
  return null;
}

/** The padi process's memory projected for display (see {@link displayRss}). padi
 *  measures itself, so it is `ok` whenever the server's fold has a live padi to
 *  read; `null`/`error` surface a down/unreadable padi honestly. */
export function padiMemoryDisplay():
  | { kind: "ok"; rssBytes: number }
  | { kind: "error" }
  | null {
  return displayRss(padiMemory().value()?.padi);
}

/** The kaval daemon's memory projected for display (see {@link displayRss}), with
 *  the extra connected-NOW gate the kaval dot already applies: `daemonStatus` flips
 *  the instant the daemon leaves `connected`, but the folded RSS only clears on the
 *  next sampler tick — so gating on the live state hides a stale MB at once, keeping
 *  the memory and the dot from drifting. */
export function kavalMemoryDisplay():
  | { kind: "ok"; rssBytes: number }
  | { kind: "error" }
  | null {
  if (localDaemonStatus()?.state !== "connected") return null;
  return displayRss(padiMemory().value()?.kaval);
}

/** This browser's used JS heap in bytes, refreshed every second off the shared
 *  app clock, or `null` on non-Chromium browsers (which don't expose
 *  `performance.memory`). */
export function clientHeapUsedBytes(): number | null {
  // Re-read on each clock tick — reading the shared `now` signal in a tracking
  // context (JSX/memo) makes the consumer recompute every second. `getClockNow` is a
  // `createSharedRoot` over the `now` signal, so resolve it then read (never `()()`);
  // the value is discarded — the read exists only to establish the per-second dep.
  const clock = getClockNow();
  clock();
  return readJsHeapUsedBytes();
}

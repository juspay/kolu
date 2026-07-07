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
import { createRoot } from "solid-js";
import { toast } from "solid-sonner";
import {
  daemonChannelLive,
  daemonTransportLive,
  localDaemonStatus,
} from "../kaval/useDaemonStatus";
import { getClockNow } from "../time/clock";
import { app } from "../wire";
import { readJsHeapUsedBytes } from "./memory";

// HOST-SCOPING: `processMemory` is a koluSurface (host-INDEPENDENT) cell — kolu-server's
// OWN RSS plus a fold of the LOCAL padi/kaval pair (see `server/src/memorySampler.ts`,
// which reads the LOCAL `padiSession`, not `activeHost`). `serverRssBytes` is genuinely
// host-independent by design (kolu-server has exactly one process, wherever the browser
// tab is looking). `padiMemoryDisplay`/`kavalMemoryDisplay` are NOT yet re-keyed onto
// `activeHost` — padi DOES serve its own `processMemory` per host (`padiSurface.processMemory`,
// `padi/src/surface.ts`), but kolu-server's fold has not been wired to re-serve it per
// active host (a padi/server-side gap, out of this fix's file scope — tracked separately,
// not "by design"). Until that lands, this readout describes the LOCAL padi/kaval stack
// always, mislabeled as the active host's when a REMOTE host is active; see the
// classification table in `PadiInfoDialog.tsx`/`KavalInfoDialog.tsx`.
//
// THE LIVE-SUBSCRIPTION FIX: `app.cells.X.use(...)` routes through the base client's
// ref-counted `createKeyedSubscriptionCache` (`@kolu/surface/solid/keyedSubscriptionCache`).
// Calling `.use()` at MODULE scope with no ambient Solid owner is the "ownerless" path that
// cache documents: it acquires the shared slot and releases it in the SAME tick, netting
// the listener count to zero, so the underlying subscription is torn down a microtask
// later — long before the first real (network) value can land. Every consumer then reads
// a permanently-`undefined` value (the honest-unknown default), the exact "memory
// unavailable" symptom. Wrapping in an app-lifetime `createRoot` (the same idiom
// `useDaemonStatus.ts`'s `sub`/`useHostInventory.ts`'s `sub` already use) keeps a live
// listener for the app's whole life, so the shared slot never tears down.
const sub = createRoot(() =>
  app.cells.processMemory.use({
    onError: (err) => toast.error(`Memory readout error: ${err.message}`),
  }),
);

/** The kolu-server process's RSS in bytes, or `null` before the first server
 *  yield (it's always a real number once a sample lands — the server measures
 *  itself). */
export function serverRssBytes(): number | null {
  return sub.value()?.serverRssBytes ?? null;
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
  return displayRss(sub.value()?.padi);
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
  // The kaval RSS renders on the HOST-SCOPED Kaval chip (its dot/state/uptime floor on
  // `daemonChannelLive` = ws ∧ the active entry), so its memory folds the SAME entry leg: a
  // dead active REMOTE entry (whose re-served daemonStatus freezes at "connected") hides the
  // stale RSS rather than a definite figure beside an "unknown" dot (re-run #6 — the
  // dot-vs-tooltip honesty split). The a34032209 rationale (processMemory is a host-INDEPENDENT
  // local-stack diagnostic) stands for the VALUE; the DISPLAY still floors on the host-scoped
  // channel, exactly like every other host-scoped kaval-rail consumer.
  if (!daemonChannelLive()) return null;
  if (localDaemonStatus()?.state !== "connected") return null;
  return displayRss(sub.value()?.kaval);
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

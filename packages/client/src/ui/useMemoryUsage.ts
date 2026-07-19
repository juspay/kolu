/**
 * Live memory readouts for the chrome bar's identity rail (and the Diagnostic
 * Info dialog) — one singleton subscription each consumer shares.
 *
 * Four figures, two sources:
 *   - `serverRssBytes` rides the server-pushed, host-INDEPENDENT koluSurface
 *     `processMemory` cell — kolu-server has exactly one process, wherever the
 *     browser tab is looking.
 *   - `padiMemoryDisplay` / `kavalMemoryDisplay` ride padi's OWN per-host
 *     `processMemory` cell (`padiMap.useEntry(activeHost)`, W4 "the switch") —
 *     padi measures its own RSS + its supervised kaval's, so this re-keys when
 *     the active host switches, instead of describing the LOCAL stack always.
 *   - `clientHeapUsedBytes` is a browser-local read off `performance.memory`,
 *     refreshed each second off the SHARED app clock (`getClockNow`) — no
 *     dedicated timer, so it never adds a visibility-blind interval (the clock
 *     already throttles itself in a hidden tab).
 */

import type { ProcessRss } from "kolu-common/surface";
import { createRoot } from "solid-js";
import {
  daemonChannelLive,
  daemonTransportLive,
  localDaemonStatus,
} from "../kaval/useDaemonStatus";
import { getClockNow } from "../time/clock";
import { activeHost, app, padiMap } from "../wire";
import { readJsHeapUsedBytes } from "./memory";

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

// kolu-server's OWN RSS — host-independent (one koluSurface cell, one process).
const sub = createRoot(() => app.cells.processMemory.use());

// The ACTIVE host's own padi/kaval RSS pair — `padiSurface.processMemory`, rides
// `useEntry(activeHost)` so it re-keys on a host switch (a DISTINCT standing
// subscription from `sub` above: two different cells, two different surfaces).
const hostSub = createRoot(() =>
  padiMap.useEntry(activeHost).cells.processMemory.use(),
);

/** The kolu-server process's RSS in bytes, or `null` before the first server yield —
 *  FLOORED on transport liveness the same way {@link displayRss} floors the per-process
 *  readings (#1793): when the ws delivering the figure is dead or silently half-open the
 *  retained RSS is STALE, so it reads `null` rather than a frozen MB. Flooring HERE, at
 *  the one reader, closes the KoluInfoDialog memory row AND every other consumer at once —
 *  the reader is the knowing endpoint. */
export function serverRssBytes(): number | null {
  if (!daemonTransportLive()) return null;
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

/** The ACTIVE host's padi process memory projected for display (see
 *  {@link displayRss}). padi measures itself, so it is `ok` whenever that host's
 *  `identity`/`processMemory` cells have a live padi to read; `null`/`error`
 *  surface a down/unreadable padi honestly. Rides {@link hostSub} — re-keys when
 *  the active host switches (W4 "the switch"). */
export function padiMemoryDisplay():
  | { kind: "ok"; rssBytes: number }
  | { kind: "error" }
  | null {
  return displayRss(hostSub.value()?.padi);
}

/** The ACTIVE host's kaval daemon memory projected for display (see
 *  {@link displayRss}), with the extra connected-NOW gate the kaval dot already
 *  applies: `daemonStatus` flips the instant the daemon leaves `connected`, but the
 *  padi-served RSS only clears on the next sampler tick — so gating on the live
 *  state hides a stale MB at once, keeping the memory and the dot from drifting. */
export function kavalMemoryDisplay():
  | { kind: "ok"; rssBytes: number }
  | { kind: "error" }
  | null {
  // The kaval RSS renders on the HOST-SCOPED Kaval chip (its dot/state/uptime floor on
  // `daemonChannelLive` = ws ∧ the active entry), so its memory folds the SAME entry leg: a
  // dead active REMOTE entry (whose re-served daemonStatus freezes at "connected") hides the
  // stale RSS rather than a definite figure beside an "unknown" dot (re-run #6 — the
  // dot-vs-tooltip honesty split). `hostSub` is padi's OWN per-host `processMemory` cell
  // (W4 "the switch" — this used to fold off the host-independent koluSurface cell), so the
  // VALUE now genuinely re-keys with the active host too, not just the display floor.
  if (!daemonChannelLive()) return null;
  if (localDaemonStatus()?.state !== "connected") return null;
  return displayRss(hostSub.value()?.kaval);
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

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

const sub = createRoot(() => app.cells.processMemory.use());

const hostSub = createRoot(() =>
  padiMap.useEntry(activeHost).cells.processMemory.use(),
);

/** The kolu-server process's RSS in bytes, or `null` before the first server
 *  yield or over a dead transport. */
export function serverRssBytes(): number | null {
  if (!daemonTransportLive()) return null;
  return sub.value()?.serverRssBytes ?? null;
}

/** A per-process RSS reading projected for display — `{ kind: "ok", rssBytes }`,
 *  `{ kind: "error" }` (a believed-up process whose read failed), or `null`.
 *  Reads as `null` over a dead transport rather than a frozen figure. */
function displayRss(
  m: ProcessRss | undefined,
): { kind: "ok"; rssBytes: number } | { kind: "error" } | null {
  if (!daemonTransportLive()) return null;
  if (m?.status === "ok") return { kind: "ok", rssBytes: m.rssBytes };
  if (m?.status === "error") return { kind: "error" };
  return null;
}

/** The active host's padi process memory projected for display (see
 *  {@link displayRss}), floored on `daemonChannelLive()` so a frozen re-served
 *  figure never outlives the entry's own connection. */
export function padiMemoryDisplay():
  | { kind: "ok"; rssBytes: number }
  | { kind: "error" }
  | null {
  if (!daemonChannelLive()) return null;
  return displayRss(hostSub.value()?.padi);
}

/** The active host's kaval daemon memory projected for display, with the extra
 *  connected-now gate the kaval dot applies (the padi-served RSS only clears on
 *  the next sampler tick). */
export function kavalMemoryDisplay():
  | { kind: "ok"; rssBytes: number }
  | { kind: "error" }
  | null {
  if (!daemonChannelLive()) return null;
  if (localDaemonStatus()?.state !== "connected") return null;
  return displayRss(hostSub.value()?.kaval);
}

/** This browser's used JS heap in bytes, refreshed every second off the shared
 *  app clock, or `null` on non-Chromium browsers. */
export function clientHeapUsedBytes(): number | null {
  getClockNow()();
  return readJsHeapUsedBytes();
}

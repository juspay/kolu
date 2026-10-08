/**
 * A host's runs, as the moments worth telling the user about: a first download
 * starts (`→ downloading`), lands (`downloading → ready`: the next new terminal
 * there has the agents), fails (`downloading → error`, and why), or the user
 * turns agents off under it (`downloading → off`) — and an update lands (`ready
 * → ready` with another bundle of the same profile).
 *
 * Compares each status's PLAIN facts (`downloadEdgeFacts`: kind, profile,
 * bundle — copied out as strings), never the status value: a cell's value is
 * reconciled in place into one store object (`@kolu/surface`'s
 * `writeWrappedValue`), so the value read before and after a transition is the
 * same proxy, and a watcher keyed on it never sees the edge. That is the bug
 * this module exists to make unrepeatable — `firstDownload.test.ts` drives it
 * through a real reconciled store.
 */

import type { AgentDistroStatus } from "@kolu/agent-distro/schema";
import {
  type DownloadEdgeFacts,
  downloadEdge,
  downloadEdgeFacts,
} from "@kolu/agent-distro/status";
import { createEffect, untrack } from "solid-js";

/** A moment worth telling the user about (`downloadEdge`'s, minus `none`). */
export type DownloadMoment = Exclude<ReturnType<typeof downloadEdge>, "none">;

/** Run `onMoment` at a host's download and update moments, with the status
 *  that made it — which moment is `downloadEdge`'s call
 *  (`@kolu/agent-distro/status`); this is only the Solid effect that watches the
 *  cell. */
export function watchDownload(
  read: () => AgentDistroStatus | undefined,
  onMoment: (moment: DownloadMoment, status: AgentDistroStatus) => void,
): void {
  let prev: DownloadEdgeFacts | undefined;
  createEffect(() => {
    const status = read();
    const now = downloadEdgeFacts(status);
    const moment = downloadEdge(prev, now);
    prev = now;
    if (moment !== "none" && status !== undefined)
      untrack(() => onMoment(moment, status));
  });
}

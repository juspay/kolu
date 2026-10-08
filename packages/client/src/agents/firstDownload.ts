/**
 * A host's download, as the moments worth telling the user about: it starts
 * (`→ downloading`), it lands (`downloading → ready`: the next new terminal
 * there has the agents), it fails (`downloading → error`, and why), or the user
 * turns agents off under it (`downloading → off`).
 *
 * Tracks the status's `kind` STRING, never the status value: a cell's value is
 * reconciled in place into one store object (`@kolu/surface`'s
 * `writeWrappedValue`), so the value read before and after a transition is the
 * same proxy, and a watcher keyed on it never sees the edge. That is the bug
 * this module exists to make unrepeatable — `firstDownload.test.ts` drives it
 * through a real reconciled store.
 */

import type { AgentDistroStatus } from "@kolu/agent-distro/schema";
import { downloadEdge } from "@kolu/agent-distro/status";
import { createEffect, on } from "solid-js";

/** A download moment worth telling the user about (`downloadEdge`'s, minus
 *  `none`). */
export type DownloadMoment = Exclude<ReturnType<typeof downloadEdge>, "none">;

/** Run `onMoment` at a host's download moments, with the status that made it —
 *  which moment is `downloadEdge`'s call (`@kolu/agent-distro/status`); this is
 *  only the Solid effect that watches the cell. */
export function watchDownload(
  read: () => AgentDistroStatus | undefined,
  onMoment: (moment: DownloadMoment, status: AgentDistroStatus) => void,
): void {
  createEffect(
    on(
      () => read()?.kind,
      (now, prev) => {
        const moment = downloadEdge(prev, now);
        const status = read();
        if (moment !== "none" && status !== undefined) onMoment(moment, status);
      },
    ),
  );
}

/**
 * A host's download, as the three moments worth telling the user about: it
 * starts (`→ downloading`), it lands (`downloading → ready`: the next new
 * terminal there has the agents), or it fails (`downloading → error`, and why).
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

/** Run `handlers` at a host's download moments — which moment is
 *  `downloadEdge`'s call (`@kolu/agent-distro/status`); this is only the Solid
 *  effect that watches the cell. */
export function watchDownload(
  read: () => AgentDistroStatus | undefined,
  handlers: {
    readonly onStart: () => void;
    readonly onReady: () => void;
    readonly onError: (message: string) => void;
  },
): void {
  createEffect(
    on(
      () => read()?.kind,
      (now, prev) => {
        switch (downloadEdge(prev, now)) {
          case "start":
            return handlers.onStart();
          case "ready":
            return handlers.onReady();
          case "failed": {
            const status = read();
            if (status?.kind === "error") handlers.onError(status.message);
            return;
          }
          case "none":
            return;
        }
      },
    ),
  );
}

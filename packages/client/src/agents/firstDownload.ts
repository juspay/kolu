/**
 * The one transition worth telling the user about: a host's download settling.
 * `downloading → ready` means its next new terminal has the agents;
 * `downloading → error` means it will not, and why.
 *
 * Tracks the status's `kind` STRING, never the status value: a cell's value is
 * reconciled in place into one store object (`@kolu/surface`'s
 * `writeWrappedValue`), so the value read before and after a transition is the
 * same proxy, and a watcher keyed on it never sees the edge. That is the bug
 * this module exists to make unrepeatable — `firstDownload.test.ts` drives it
 * through a real reconciled store.
 */

import type { AgentDistroStatus } from "@kolu/padi-client/surface";
import { createEffect, on } from "solid-js";

export function watchFirstDownload(
  read: () => AgentDistroStatus | undefined,
  handlers: {
    readonly onReady: () => void;
    readonly onError: (message: string) => void;
  },
): void {
  createEffect(
    on(
      () => read()?.kind,
      (now, prev) => {
        if (prev !== "downloading") return;
        if (now === "ready") handlers.onReady();
        const status = read();
        if (status?.kind === "error") handlers.onError(status.message);
      },
    ),
  );
}

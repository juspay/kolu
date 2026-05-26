/**
 * HostChip — small badge rendered on remote tiles showing which SSH
 * host owns the terminal. Local terminals render no chip (the common
 * case stays clean).
 *
 * Renders in three places: the tile title bar, the dock card, and the
 * workspace switcher. Each call site decides the surrounding chrome;
 * the chip itself is just the icon + host label.
 *
 * Prototype scope: visual only, no interaction. R-3 may add a click
 * handler that opens the host's session-info popover (reconnect
 * controls, ping latency, etc.).
 */

import { Show } from "solid-js";
import type { TerminalLocation } from "kolu-common/surface";

export function HostChip(props: { location: TerminalLocation }) {
  return (
    <Show when={props.location.kind === "ssh" ? props.location : null}>
      {(loc) => (
        <span
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
          title={`Terminal on remote host: ${loc().host}`}
        >
          <span aria-hidden="true">⇄</span>
          <span>{loc().host}</span>
        </span>
      )}
    </Show>
  );
}

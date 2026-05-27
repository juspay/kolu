/** `HostChip` — renders the ssh-config host alias when a terminal
 *  lives on a remote host. Null for local terminals (zero-cost — the
 *  caller doesn't need a wrapping `<Show>`).
 *
 *  Used on tile title bar, dock pill, workspace switcher card, and
 *  EmptyState restore card so the "this terminal is on $host" fact is
 *  visible anywhere a terminal is named. */

import type { TerminalLocation } from "kolu-common/terminalBackend";
import { type Component, Show } from "solid-js";

const HostChip: Component<{
  location: TerminalLocation | undefined;
}> = (props) => {
  const host = () =>
    props.location?.kind === "remote" ? props.location.host : null;
  return (
    <Show when={host()}>
      {(h) => (
        <span
          class="inline-flex items-center gap-0.5 rounded px-1 py-0.5 bg-accent/15 text-accent text-[10px] font-medium uppercase tracking-wide"
          title={`Terminal running on remote host ${h()}`}
        >
          <svg
            class="size-2.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 9l-2 9h18l-2-9" />
            <path d="M5 9V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
            <circle cx="12" cy="14" r="1.5" />
          </svg>
          {h()}
        </span>
      )}
    </Show>
  );
};

export default HostChip;

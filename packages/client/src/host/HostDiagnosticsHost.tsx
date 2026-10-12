/** The ONE mount of the host-details popover, at the shell.
 *
 *  Who opens it is a module singleton (`useHostDiagnosticsOpen`): a host
 *  tab's connection pip, its agent-distro mark, or a machine's name on
 *  Settings' Agents line. Those openers do not share a parent — the chip row
 *  is mounted only at `md` and up and never for an overflowed host, while
 *  Settings is reachable at every width — so the panel lives above all of
 *  them and hangs off whichever element was acted on.
 *
 *  Keyed on the HOST: a different machine is a different panel. Where it
 *  floats is a separate signal read through `triggerRef`, so opening the same
 *  machine from another opener moves the panel instead of tearing it down
 *  (which would re-subscribe and forget a pending "remove host" confirmation).
 *
 *  It also owns the one invariant the chip used to: a key whose host has left
 *  the pool closes, so a re-add never reopens a stale panel. */

import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import { type Component, createEffect, Show } from "solid-js";
import { HostDiagnosticsPopover } from "./HostDiagnosticsPopover";
import { useHostMembers } from "./useHostMembers";
import {
  closeHostDiagnostics,
  hostDiagnosticsAnchor,
  openHostDiagnosticsKey,
} from "./useHostDiagnosticsOpen";

const HostDiagnosticsHost: Component = () => {
  const members = useHostMembers();
  createEffect(() => {
    const key = openHostDiagnosticsKey();
    if (key === null) return;
    const stillMember = members().some((host) => encodeHostKey(host) === key);
    if (!stillMember) closeHostDiagnostics();
  });
  return (
    <Show when={openHostDiagnosticsKey()} keyed>
      {(key) => (
        <HostDiagnosticsPopover
          host={decodeHostKey(key)}
          triggerRef={hostDiagnosticsAnchor}
          open={() => true}
          onDismiss={closeHostDiagnostics}
        />
      )}
    </Show>
  );
};

export default HostDiagnosticsHost;

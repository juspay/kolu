import { type HostKey, hostKeysEqual as sameHost } from "kolu-common/hostKey";
import { type Accessor, createMemo, createSignal, type Setter } from "solid-js";
import { activeHost, setActiveHost } from "../wire";

/** A daemon mark's panel state: whether the panel SHOWS, the setter the
 *  popover's dismiss arm writes, and the click seam that opens it. */
export type DaemonMarkOpen = {
  open: Accessor<boolean>;
  setOpen: Setter<boolean>;
  openForHost: () => void;
};

/** The ONE open/switch seam for a daemon mark (`HostDaemonChips`): opens the
 *  info panel for this host, switching the canvas to it first when it isn't
 *  already active (a no-op-close toggle only when it already is). Both
 *  sub-chips share this so the switch-first rule — opening an inactive host's
 *  panel makes the dialog's active-host-scoped detail rows describe that host —
 *  lives in exactly one documented place, not duplicated verbatim per mark.
 *
 *  Its own module, not a helper inside the component file, so the rule is
 *  unit-drivable (`daemonMarkOpen.test.ts`) without mounting two dialogs. */
export function useDaemonMarkOpen(host: HostKey): DaemonMarkOpen {
  // `requested` is what the USER asked for — the click opened the panel, a
  // dismiss closed it. Whether the panel SHOWS is a standing rule over that
  // and the canvas: an open panel describes the ACTIVE host.
  //
  // The dialog's active-host-scoped rows (memory, running-daemon inventory,
  // convergence, kaval restart) ride the switch-first contract: opening
  // SWITCHES the canvas to `host`, so those rows describe it. But the active
  // host can later move OFF `host` while the panel stays open WITHOUT an
  // outside click — wire.ts's `hostReconcileTarget` auto-switches to LOCAL when
  // `host` silently departs the pool, and that path never triggers
  // useAnchoredPopover's outside-click/Escape dismiss. Shown, the panel would
  // blend this host's props-scoped status with another host's active-host rows
  // (and restart would recycle the newly-active host).
  //
  // So it is a DERIVATION, not a correction: the panel stops showing in the
  // same flush the canvas moves, with no frame of the stale mix in between and
  // no effect writing the flag it reads. The request survives the switch —
  // switching back to `host` shows the panel the user opened, which is the same
  // rule read the other way round.
  const [requested, setRequested] = createSignal(false);
  const open = createMemo(() => requested() && sameHost(activeHost(), host));
  const openForHost = (): void => {
    const alreadyActive = sameHost(activeHost(), host);
    if (!alreadyActive) setActiveHost(host);
    setRequested((v) => (alreadyActive ? !v : true));
  };
  return { open, setOpen: setRequested, openForHost };
}

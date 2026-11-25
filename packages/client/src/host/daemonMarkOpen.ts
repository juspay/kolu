import { type HostKey, hostKeysEqual as sameHost } from "kolu-common/hostKey";
import {
  type Accessor,
  createMemo,
  createSignal,
  type Setter,
  untrack,
} from "solid-js";
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
  // `request` is what the USER asked for — a click raises one, a dismiss drops
  // it. Whether the panel SHOWS is a standing rule over that request and the
  // canvas: an open panel describes the ACTIVE host.
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
  // no effect writing the flag it reads. And the request is SPENT by the
  // switch: once the canvas has moved off `host` the panel stays shut, as
  // master's `setOpen(false)` left it — coming back to `host` (a notification
  // jump away and a deep link back) must not reopen a panel the user never
  // re-asked for. Only a fresh click mints a new request.
  //
  // The latch lives in the memo's own `prev`, so the spending is part of the
  // derivation rather than an effect writing the source it reads: a request is
  // a TOKEN, and a shown panel is one whose token is still the one the memo
  // last saw shown over an active canvas.
  let minted = 0;
  const [request, setRequest] = createSignal(0);
  const shown = createMemo<{ token: number; show: boolean }>(
    (prev) => {
      const token = request();
      if (token === 0) return { token, show: false };
      const active = sameHost(activeHost(), host);
      // A fresh click shows over the host it just switched to; a standing
      // request only survives while the canvas stays on `host`.
      return {
        token,
        show: token !== prev.token ? active : prev.show && active,
      };
    },
    { token: 0, show: false },
  );
  const open = (): boolean => shown().show;
  const write = (next: boolean): void => {
    setRequest(next ? ++minted : 0);
  };
  const openForHost = (): void => {
    const alreadyActive = sameHost(untrack(activeHost), host);
    if (!alreadyActive) setActiveHost(host);
    write(!(alreadyActive && untrack(open)));
  };
  const setOpen = ((value: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(untrack(open)) : value;
    write(next);
    return next;
    // `Setter<boolean>`'s overload set (a value, an updater, and the arms a
    // non-nullable signal cannot take) is not expressible in one implementation
    // signature; the two arms above are its whole surface here.
  }) as Setter<boolean>;
  return { open, setOpen, openForHost };
}

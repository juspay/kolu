/** The stale-agents Restart's two guards, as one reactive primitive the tile's
 *  agents pill drives:
 *
 *   - a LIVE agent (working, or awaiting you) is not restarted on the first
 *     press: that press only ARMS the guard for {@link RESTART_ARM_MS}, and a
 *     second press inside the window restarts. The window lapsing, or the agent
 *     going quiet, disarms it. A plain shell restarts on the first press.
 *   - while a restart is in flight the guard is BUSY and ignores presses, so a
 *     double click is one restart.
 *
 *  Owned by the calling component: its timer is cleared on cleanup. */

import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

/** How long an armed guard waits for the confirming press. */
export const RESTART_ARM_MS = 5000;

export interface RestartGuard {
  /** The first press landed on a live agent; the next one restarts. */
  readonly armed: Accessor<boolean>;
  /** A restart is in flight. */
  readonly busy: Accessor<boolean>;
  /** A press: arm, restart, or (busy) nothing. */
  readonly press: () => void;
}

export function createRestartGuard(opts: {
  /** A live agent would be affected — the first press arms instead. */
  readonly guarded: Accessor<boolean>;
  /** Runs the restart; settles when it has (never expected to reject). */
  readonly restart: () => Promise<unknown>;
}): RestartGuard {
  const [armed, setArmed] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    clearTimeout(timer);
    timer = undefined;
    setArmed(false);
  };
  onCleanup(disarm);
  // The agent went quiet while armed: there is nothing left to warn about.
  createEffect(
    on(
      opts.guarded,
      (guarded) => {
        if (!guarded) disarm();
      },
      { defer: true },
    ),
  );
  const press = () => {
    if (busy()) return;
    if (opts.guarded() && !armed()) {
      setArmed(true);
      timer = setTimeout(disarm, RESTART_ARM_MS);
      return;
    }
    disarm();
    setBusy(true);
    void opts.restart().finally(() => setBusy(false));
  };
  return { armed, busy, press };
}

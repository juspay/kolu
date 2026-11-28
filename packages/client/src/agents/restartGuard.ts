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

import { type Accessor, createMemo, createSignal, onCleanup } from "solid-js";

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
  const [busy, setBusy] = createSignal(false);
  /** The agent's liveness, equality-gated: the pill hands this primitive a
   *  fresh `restart` object on every parent update, and only a real flip is a
   *  change of liveness. */
  const guarded = createMemo(() => opts.guarded());
  /** One token per LIVE SPELL: a fresh identity each time the agent becomes
   *  live again, and none while it is quiet. An arming press belongs to the
   *  spell it landed in, so the agent going quiet disarms the guard — and
   *  waking up again does not bring that press back. Deriving it this way
   *  (rather than an effect writing `armed` when liveness drops) keeps the
   *  pill's armed wash and its "Restart agent" wording in the SAME frame as
   *  the liveness they belong to. */
  const spell = createMemo<object | undefined>(() =>
    guarded() ? {} : undefined,
  );
  const [armedSpell, setArmedSpell] = createSignal<object | undefined>(
    undefined,
  );
  const armed = createMemo(() => {
    const at = armedSpell();
    return at !== undefined && at === spell();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    clearTimeout(timer);
    timer = undefined;
    setArmedSpell(undefined);
  };
  onCleanup(disarm);
  const press = () => {
    if (busy()) return;
    if (guarded() && !armed()) {
      // A press in an earlier spell can leave its window still running.
      clearTimeout(timer);
      setArmedSpell(spell());
      timer = setTimeout(disarm, RESTART_ARM_MS);
      return;
    }
    disarm();
    setBusy(true);
    void opts.restart().finally(() => setBusy(false));
  };
  return { armed, busy, press };
}

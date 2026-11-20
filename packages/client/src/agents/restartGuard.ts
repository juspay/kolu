import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

export const RESTART_ARM_MS = 5000;

export interface RestartGuard {
  readonly armed: Accessor<boolean>;
  readonly busy: Accessor<boolean>;
  readonly press: () => void;
}

export function createRestartGuard(opts: {
  readonly guarded: Accessor<boolean>;
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

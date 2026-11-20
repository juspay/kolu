import { Effect } from "effect";

/** The SIGWINCH-repaint predicate for one PTY: while a window is open the
 *  output a resize provokes is withheld, and at settle it is either replayed
 *  (it fit the budget) or dropped in favour of a full re-sync. */
export interface RepaintWindow {
  readonly isOpen: boolean;
  /** Open (or restart) the window for a grid change just signalled. */
  open(): void;
  /** Route parsed output: withheld while open, published otherwise. */
  offer(data: string): void;
  /** Declare that whatever is withheld is already in a snapshot being taken,
   *  so it must not also be replayed at settle. */
  claimOverlap(): void;
  /** Close the window now: replay what was withheld, or re-sync. */
  settle(): void;
  /** Completes once no window is open. */
  awaitSettled(): Effect.Effect<void>;
}

export interface RepaintWindowDeps {
  readonly settleAfterMs: number;
  readonly budgetChars: () => number;
  readonly publish: (data: string) => void;
  readonly resyncAll: () => void;
}

interface OpenWindow {
  timer: ReturnType<typeof setTimeout> | undefined;
  withheld: string[];
  withheldChars: number;
  resync: boolean;
  waiters: Set<() => void>;
}

function discardWithheld(w: OpenWindow): void {
  w.withheld.length = 0;
  w.withheldChars = 0;
  w.resync = true;
}

export function createRepaintWindow(deps: RepaintWindowDeps): RepaintWindow {
  let open: OpenWindow | undefined;

  const settle = (): void => {
    const w = open;
    if (w === undefined) return;
    open = undefined;
    clearTimeout(w.timer);
    if (w.resync) deps.resyncAll();
    else for (const chunk of w.withheld) deps.publish(chunk);
    w.withheld.length = 0;
    const waiters = [...w.waiters];
    w.waiters.clear();
    for (const release of waiters) release();
  };

  return {
    get isOpen(): boolean {
      return open !== undefined;
    },
    open(): void {
      const w: OpenWindow = open ?? {
        timer: undefined,
        withheld: [],
        withheldChars: 0,
        resync: false,
        waiters: new Set(),
      };
      if (open !== undefined) discardWithheld(w);
      open = w;
      clearTimeout(w.timer);
      w.timer = setTimeout(settle, deps.settleAfterMs);
    },
    offer(data: string): void {
      const w = open;
      if (w === undefined) {
        deps.publish(data);
        return;
      }
      if (w.resync) return;
      w.withheld.push(data);
      w.withheldChars += data.length;
      if (w.withheldChars > deps.budgetChars()) discardWithheld(w);
    },
    claimOverlap(): void {
      const w = open;
      if (w === undefined || w.withheldChars === 0) return;
      discardWithheld(w);
    },
    settle,
    awaitSettled(): Effect.Effect<void> {
      return Effect.suspend(() => {
        const w = open;
        if (w === undefined) return Effect.void;
        return Effect.callback<void>((resume) => {
          const waiter = (): void => resume(Effect.void);
          w.waiters.add(waiter);
          return Effect.sync(() => {
            w.waiters.delete(waiter);
          });
        });
      });
    },
  };
}

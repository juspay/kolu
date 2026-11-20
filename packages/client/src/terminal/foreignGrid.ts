import type { TerminalGrid } from "@kolu/xterm-kit/solid";

export interface ForeignGridDeps {
  readonly served: () => TerminalGrid | null | undefined;
  readonly mine: () => TerminalGrid | null | undefined;
  /** The host entry's state KIND, the same fact `publishGrid` gates on. */
  readonly hostState: () => string;
  /** Re-attach at the pane's current grid, which re-asserts it on the pty. */
  readonly reopen: () => void;
  /** How long a mismatch must persist before it counts as foreign. */
  readonly settleMs: number;
}

export interface ForeignGridWatcher {
  /** Call on every change to the served grid. */
  observe(): void;
  /** Cancel a pending settle — the pane's teardown. */
  dispose(): void;
}

function heldByAnother(deps: ForeignGridDeps): boolean {
  const served = deps.served();
  const mine = deps.mine();
  if (!served || !mine) return false;
  return served.cols !== mine.cols || served.rows !== mine.rows;
}

export function createForeignGridWatcher(
  deps: ForeignGridDeps,
): ForeignGridWatcher {
  let settle: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (settle !== null) clearTimeout(settle);
    settle = null;
  };
  return {
    observe() {
      cancel();
      if (!heldByAnother(deps)) return;
      settle = setTimeout(() => {
        settle = null;
        if (!heldByAnother(deps)) return;
        if (deps.hostState() !== "connected") return;
        deps.reopen();
      }, deps.settleMs);
    },
    dispose: cancel,
  };
}

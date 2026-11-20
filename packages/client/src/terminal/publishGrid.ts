import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { Effect } from "effect";
import { toast } from "solid-sonner";
import type { UiAction } from "../runAction";

/** The three live facts the publish policy reads. */
export interface PublishGridDeps {
  readonly terminalId: string;
  /** The host entry's state KIND as the client's own host map paints it now. */
  readonly hostState: () => string;
  readonly ptyLive: () => boolean;
  readonly resize: (grid: TerminalGrid) => Effect.Effect<unknown, unknown>;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Resize the server-side PTY so node-pty matches the xterm grid. Suppressed
 *  while the pane's host is not connected; the dropped grid is latched and
 *  restated on the flip back (see {@link createGridPublisher}). */
export function publishGridAction(
  size: TerminalGrid,
  deps: PublishGridDeps,
  /** Told when the publish is dropped, so the caller can latch it. */
  onSuppressed?: (size: TerminalGrid) => void,
): UiAction<void> {
  const { cols, rows } = size;
  return Effect.suspend(() => {
    const host = deps.hostState();
    if (host !== "connected") {
      console.info(
        `terminal ${deps.terminalId}: host entry is "${host}", not connected — suppressing the ${cols}×${rows} grid publish (restated on the flip back to connected)`,
      );
      onSuppressed?.(size);
      return Effect.void;
    }
    return deps.resize(size).pipe(
      Effect.catch((err) =>
        Effect.sync(() => {
          if (!deps.ptyLive()) return;
          toast.error(
            `Terminal resize to ${cols}×${rows} failed: ${errMsg(err)}`,
            {
              id: `terminal-resize-failed-${deps.terminalId}`,
            },
          );
        }),
      ),
      Effect.asVoid,
    );
  });
}

/** How long a pane's grid must hold STILL before it is published. */
export const GRID_SETTLE_MS = 250;

/** One pane's grid publisher — {@link publishGridAction} plus the settle window
 *  ({@link GRID_SETTLE_MS}) and the latch that restates a suppressed publish. */
export interface GridPublisher {
  /** State the pane's measured grid: remembered now, published once the grid
   *  has held still for {@link GRID_SETTLE_MS}. */
  publish: (size: TerminalGrid) => void;
  /** Restate the latched grid, if any. Safe to run on every host-state tick. */
  republishSuppressed: () => void;
  /** Drop a publish that has not landed yet. */
  cancel: () => void;
}

/** {@link PublishGridDeps} plus the edge a DEFERRED publish runs at. */
export interface GridPublisherDeps extends PublishGridDeps {
  readonly run: (action: UiAction<void>) => void;
}

/** The one slot a suppressed grid waits in: `arm` replaces what is held, `take`
 *  empties it as it hands it over. One grid, never a queue — a pane states its
 *  size, it does not accumulate sizes. */
function createGridLatch() {
  let armed: TerminalGrid | null = null;
  return {
    arm: (grid: TerminalGrid): void => {
      armed = grid;
    },
    take: (): TerminalGrid | null => {
      const held = armed;
      armed = null;
      return held;
    },
  };
}

export function createGridPublisher(deps: GridPublisherDeps): GridPublisher {
  const gridOwedToPty = createGridLatch();
  let pending: TerminalGrid | null = null;
  let settle: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (settle !== null) clearTimeout(settle);
    settle = null;
    pending = null;
  };

  const fire = (size: TerminalGrid): void => {
    gridOwedToPty.take();
    deps.run(publishGridAction(size, deps, gridOwedToPty.arm));
  };

  const publish = (size: TerminalGrid): void => {
    pending = size;
    if (settle !== null) clearTimeout(settle);
    settle = setTimeout(() => {
      settle = null;
      const settled = pending;
      pending = null;
      if (settled) fire(settled);
    }, GRID_SETTLE_MS);
  };

  const republishSuppressed = (): void => {
    if (deps.hostState() !== "connected") return;
    const owed = gridOwedToPty.take();
    if (!owed) return;
    console.info(
      `terminal ${deps.terminalId}: host entry is connected again — restating the suppressed ${owed.cols}×${owed.rows} grid`,
    );
    fire(owed);
  };

  return { publish, republishSuppressed, cancel };
}

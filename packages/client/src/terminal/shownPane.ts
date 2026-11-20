import type { TerminalGrid } from "@kolu/xterm-kit/solid";

export interface ShownPaneDeps {
  /** Is this pane shown — measured (a real grid) and visible? */
  readonly shown: () => boolean;
  /** Open the attach stream at the pane's current grid. */
  readonly attach: () => void;
  /** End the live attach. Nothing may paint afterwards. */
  readonly detach: () => void;
  /** State a measured grid to the PTY (`publishGrid.ts` owns when it lands). */
  readonly publish: (grid: TerminalGrid) => void;
  /** Drop a publish that has not landed yet. */
  readonly cancelPublish: () => void;
}

export interface ShownPane {
  /** Re-read `shown()` and act on a CHANGE. Idempotent. */
  observe(): void;
  /** The pane measured a new grid. Published only while the pane is shown. */
  measured(grid: TerminalGrid): void;
}

export function createShownPane(deps: ShownPaneDeps): ShownPane {
  let attached = false;
  return {
    observe() {
      const shown = deps.shown();
      if (shown === attached) return;
      attached = shown;
      if (shown) deps.attach();
      else {
        deps.cancelPublish();
        deps.detach();
      }
    },
    measured(grid: TerminalGrid) {
      if (!deps.shown()) return;
      deps.publish(grid);
    },
  };
}

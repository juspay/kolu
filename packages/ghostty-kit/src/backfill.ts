/** Scrollback backfill controller — engine-side stub.
 *
 *  In-place CircularList surgery was an xterm hazard. The ghostty engine
 *  keeps the attach snapshot window; older-history prepend is a later
 *  renderer concern. The controller still exposes the attach-stream seam
 *  so Terminal.tsx's snapshot/delta policy is unchanged. */

export interface BackfillController {
  dispose(): void;
  reset(): void;
  consumeSnapshotFrame(
    _topLine: number,
    _reflowEpoch: number | undefined,
    _leadsWithRis: boolean,
  ): { seam: string; commit: () => void };
}

export function createBackfillController(
  _term: unknown,
  _opts: {
    fetch: (
      before: number,
      max: number,
      epoch: number | undefined,
    ) => Promise<unknown>;
    isTerminalGone: (err: unknown) => boolean;
    onError: (err: unknown) => void;
  },
): BackfillController {
  return {
    dispose() {},
    reset() {},
    consumeSnapshotFrame() {
      return { seam: "", commit: () => {} };
    },
  };
}

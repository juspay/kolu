/** Paste/upload delivery — the client-side recomposition of the retired server
 *  `pasteImage`/`uploadFile` handlers: write pasted/dropped bytes into the
 *  terminal's on-disk scratch dir, then bracketed-paste the returned path into
 *  the PTY.
 *
 *  `lifecycle.sendInput` QUIET-DROPS on a terminal that is no longer active —
 *  server-side it is `getActiveTerminal(id)?.handle.write(...)`, and the `?.`
 *  short-circuits (no throw, no return) when the id is not an active terminal.
 *  So a terminal that dies AFTER the scratch write but BEFORE the send would
 *  swallow the paste with NO error: the file is written but the paste never
 *  lands. The retired single RPC threw NOT_FOUND in that case.
 *
 *  Restore an observable failure: re-check the terminal is active after the
 *  write (awaiting the drop would resolve silently, so it must be gated here)
 *  and throw otherwise, so the caller's catch surfaces a `toast.error` rather
 *  than dropping the written file in silence. On a live terminal the success
 *  path is unchanged — write then send.
 *
 *  Extracted from Terminal.tsx so the delivery gate is unit-testable without an
 *  xterm/DOM harness (Terminal.tsx cannot be imported under the node runner). */

import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";

export function deliverScratchPaste(deps: {
  terminalId: TerminalId;
  name: string;
  base64: string;
  scratchWrite: (args: {
    terminalId: TerminalId;
    name: string;
    data: string;
  }) => Effect.Effect<{ path: string }, unknown>;
  /** Is the terminal still an ACTIVE (live-PTY) terminal — the client mirror of
   *  the server's `getActiveTerminal` gate. */
  isActive: () => boolean;
  sendInput: (args: {
    id: TerminalId;
    data: string;
  }) => Effect.Effect<void, unknown>;
  /** Wrap the scratch path in the bracketed-paste markers. */
  wrapPath: (path: string) => string;
}): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const { path } = yield* deps.scratchWrite({
      terminalId: deps.terminalId,
      name: deps.name,
      data: deps.base64,
    });
    // The liveness re-check sits BETWEEN the two calls, where it has to: the
    // send is the step that quiet-drops, so the refusal has to be raised before
    // it, not inferred from its (always successful) answer.
    if (!deps.isActive())
      return yield* Effect.fail(
        new Error("terminal is no longer active — paste not delivered"),
      );
    yield* deps.sendInput({ id: deps.terminalId, data: deps.wrapPath(path) });
  });
}

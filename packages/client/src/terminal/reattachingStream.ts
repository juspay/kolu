import { Effect, Schedule, Stream } from "effect";
import { isDeclared, TERMINAL_NOT_FOUND } from "../rpc/declaredErrors";

/** How long to wait before re-subscribing after an abnormal end. Bounds the loop
 *  if a re-subscribe keeps failing (e.g. the terminal is genuinely gone — the
 *  tile then unmounts, interrupting the fiber and ending the loop). */
const REATTACH_BACKOFF_MS = 300;

/** How long a CLEAN end waits for the tile's own exit facts to land before it
 *  calls that end unexpected.
 *
 *  A real PTY exit ends the attach stream and publishes the exit (`terminalExit`,
 *  the metadata arm, the list removal) over the SAME socket, so the two race by
 *  construction and the stream's end frame routinely wins. The window therefore
 *  only has to cover in-process delivery + the store reconcile — not a network
 *  round trip — and one backoff interval is that with room to spare. It costs an
 *  exited tile nothing: the pane keeps its final screen through the wait (the
 *  reset runs only once we commit to re-attaching), and the list removal usually
 *  unmounts the tile inside it, interrupting this fiber before any RPC is sent. */
const EXIT_SETTLE_MS = REATTACH_BACKOFF_MS;

/** How many re-attaches a CLEAN end may buy in one attach loop.
 *
 *  One. A clean end for a tile whose PTY is still live is a manufactured end —
 *  the deploy-#2 frozen-pane class (kolu#2101), where a stampede ended kaval-side
 *  attach subscriptions without an `overflow` frame and every retry layer, which
 *  retries FAILURES only, read the result as "the PTY exited". Re-attaching once
 *  is the whole of the client's part in that: the server (`reattachingDeltas`)
 *  owns the real repair, and a SECOND clean end in a row means the chain is
 *  manufacturing ends faster than either layer can absorb — a defect to surface,
 *  not to storm against. So the budget is spent, never refilled, per attach loop:
 *  no clock, no reset rule, nothing unbounded. Exhausting it DIES (a defect, not
 *  a failure — `Effect.retry` retries failures, and this must not be retried), so
 *  the run edge reports it (console + toast) instead of leaving the pane blank
 *  and silent, which is the exact rendering this whole change exists to kill.
 *
 *  A FAILING end keeps its own, deliberately unbounded, retry (below): a
 *  mid-chain padi death heals when kolu-server re-binds, and that loop is what
 *  the W2.2 done-criterion (c) rests on. */
const CLEAN_END_REATTACH_BUDGET = 1;

/** A clean stream end for a tile that has NOT been told its PTY exited. Raised
 *  into the loop's own error channel so it travels the EXISTING abnormal-end path
 *  — `onReattach` (reset + re-arm the snapshot boundary) then the spaced
 *  re-subscribe — rather than a second, parallel recovery route. */
class AttachEndedWhileLive extends Error {
  constructor(label: string) {
    super(
      `${label}: the attach stream ended cleanly while the terminal is still live — re-attaching`,
    );
    this.name = "AttachEndedWhileLive";
  }
}

/** The tile facts this loop reads back before acting on an end. */
export interface AttachTileFacts {
  /** Does this tile KNOW its PTY is gone (a `terminalExit`/metadata arm that has
   *  resolved to non-active, or the terminal's departure from the list)?
   *
   *  Positive fact, deliberately: an UNKNOWN answer (metadata not resolved yet)
   *  must read as "still live", because the two mistakes are not symmetric — a
   *  wrong "live" costs one attach RPC that the server answers `TerminalNotFound`
   *  and the loop then ends, while a wrong "exited" costs a blank pane with a
   *  live title, forever. */
  hasExited: () => boolean;
}

/** Consume a terminal-attach stream that must SURVIVE a mid-chain (padi↔kolu-server)
 *  death — the W2.2 done-criterion (c) — AND a manufactured clean end.
 *
 *  **Failing ends.** The face's own retry fence (`unenrolledStreamCall`)
 *  transparently re-subscribes on a browser↔kolu-server TRANSPORT drop (an
 *  `RpcClientError` → retried forever, the stream never ends). But when the padi
 *  process dies mid-attach, kolu-server's fail-through relay ENDS the browser
 *  stream with an application failure, which the fence's POSITIVE match
 *  deliberately refuses to retry — so without this, the tile would strand until
 *  reload. This is APPLICATION wiring, not framework retry: on an ABNORMAL end we
 *  `onReattach()` (reset xterm + re-arm the snapshot boundary, exactly as the
 *  inner `onRetry` does, so the fresh stream's snapshot replaces stale bytes
 *  without double-painting) and RE-SUBSCRIBE — the retry reconnects end-to-end
 *  once kolu-server re-binds the padi it adopts-or-spawns, and the first frame of
 *  the fresh stream is a fresh snapshot.
 *
 *  **Clean ends (kolu#2101, deploy #2).** A graceful end used to end the story:
 *  the effect SUCCEEDED, `Effect.retry` retries failures only, and the tile was
 *  left to be torn down by the `terminalExit` event. That reading is only sound
 *  when a clean end MEANS the PTY exited — and under the restore stampede it did
 *  not: kaval-side subscriptions ended without an `overflow` frame, padi read
 *  that as a graceful end, and the client sat waiting for an exit event that was
 *  never coming. Blank pane, live title, no verdict, forever. So a clean end is
 *  now classified rather than trusted: if the tile knows its PTY is gone
 *  ({@link AttachTileFacts.hasExited}) the loop ends as before; otherwise the end
 *  is unexpected and buys ONE re-attach through the failure path above
 *  ({@link CLEAN_END_REATTACH_BUDGET}). The server-side half of the same fix
 *  (`padi/src/terminalEndpoint/reattachingDeltas.ts`) makes the manufactured end
 *  unspellable for a live PTY in the first place; this layer is the secondary
 *  defense for every OTHER way an end can be manufactured above it (the relay,
 *  the scope-abort swallow at `surface/src/server.ts`'s `pullOnly`).
 *
 *  **"The terminal is gone" ends the loop, and does not retry.** A re-attach for
 *  a terminal padi no longer has answers with the DECLARED `TerminalNotFound`
 *  (matched structurally — on a stream member it arrives undeclared, see
 *  `rpc/declaredErrors`). That is the typed teardown verdict, so the loop ENDS on
 *  it instead of storming a dead id every 300ms; removing the tile stays with the
 *  ONE authority that owns removal, the list-driven reconcile (`useActiveReconcile`
 *  — `terminalExit` is deliberately toast-only, see `useTerminals`). kaval's own
 *  `PtyNotFound` is NOT classified here and must not be: padi converts it at the
 *  source (a re-open that finds the PTY gone ends the stream gracefully; a fresh
 *  attach for a departed terminal fails `requireActiveTerminal` with
 *  `TerminalNotFound`), so a `PtyNotFound` surfacing on this wire would mean
 *  padi's registry and kaval's table disagree — a real fault that must be loud.
 *
 *  `streamFn` is re-entered per attempt (`Stream.suspend` under `retry`), so each
 *  re-attach picks up whatever the caller reads at open time (Terminal.tsx
 *  re-reads the live grid there).
 *
 *  **What this used to be, and what went with it.** A hand-rolled `open()`
 *  recursion over `runStreamScoped`, holding a stopper, a `setTimeout` backoff
 *  handle, an `AbortSignal` and an `abort` listener to clear both — five pieces
 *  of bookkeeping for "retry with a delay, and stop when told". Interruption
 *  replaces all of it: the caller interrupts the fiber, which ends the consume
 *  loop AND cancels a sleeping backoff, because an `Effect.sleep` inside a
 *  retry schedule is interruptible. There is no signal to thread and none to
 *  forget.
 *
 *  A THROW from `streamFn` is a DEFECT, not a failure, so `Effect.retry` does not
 *  retry it — it propagates to the run edge, which reports it loudly and stops
 *  the loop. That is deliberate and is what the caller's grid assertion relies
 *  on: retrying an impossible-state breach every 300ms would wipe the user's
 *  screen three times a second (each retry runs `onReattach`) instead of
 *  surfacing the bug. */
export function consumeReattachingStream<T>(
  streamFn: () => Stream.Stream<T, unknown>,
  onItem: (item: T) => void,
  onReattach: () => void,
  label: string,
  tile: AttachTileFacts,
): Effect.Effect<void, unknown> {
  /** Spent, never refilled — see {@link CLEAN_END_REATTACH_BUDGET}. Lives in the
   *  closure rather than the schedule because `Stream.suspend` re-enters the
   *  stream, not this function. */
  let cleanEndReattaches = 0;

  /** Classify the end of ONE attempt that completed without failing. */
  const classifyCleanEnd = Effect.suspend(() => {
    if (tile.hasExited()) return Effect.void; // the PTY exited: a real end
    // Let the exit facts catch up with the end frame before calling it
    // unexpected — they race over one socket. An unmount lands here, in an
    // interruptible sleep, and stops the loop with nothing sent.
    return Effect.sleep(EXIT_SETTLE_MS).pipe(
      Effect.flatMap(() =>
        Effect.suspend(() => {
          if (tile.hasExited()) return Effect.void;
          if (cleanEndReattaches >= CLEAN_END_REATTACH_BUDGET) {
            return Effect.die(
              new Error(
                `${label}: the attach stream ended cleanly ${cleanEndReattaches + 1} times with the terminal still live — the chain is manufacturing stream ends`,
              ),
            );
          }
          cleanEndReattaches++;
          return Effect.fail(new AttachEndedWhileLive(label));
        }),
      ),
    );
  });

  return Stream.runForEach(Stream.suspend(streamFn), (item) =>
    Effect.sync(() => onItem(item)),
  ).pipe(
    Effect.flatMap(() => classifyCleanEnd),
    // The typed "this terminal is gone" verdict ENDS the loop — placed INSIDE the
    // retry so it converts to success before the schedule ever sees it.
    Effect.catch((err) =>
      isDeclared(err, TERMINAL_NOT_FOUND)
        ? Effect.sync(() => {
            console.info(`${label}: the terminal is gone — attach loop ended`);
          })
        : Effect.fail(err),
    ),
    Effect.tapError((err) =>
      Effect.sync(() => {
        // Fresh reset FIRST so the reopened stream's snapshot repaints cleanly.
        // Inside the retry, so it fires once per abnormal end and never after a
        // graceful one — the same "fired ⇒ a re-subscribe follows" rule the
        // framework fence holds for `onRetry`.
        console.warn(
          `${label}: re-attaching after a mid-chain stream end`,
          err,
        );
        onReattach();
      }),
    ),
    Effect.retry(Schedule.spaced(REATTACH_BACKOFF_MS)),
  );
}

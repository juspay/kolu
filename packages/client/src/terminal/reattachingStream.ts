import { Effect, Schedule, Stream } from "effect";

/** How long to wait before re-subscribing after an abnormal end. Bounds the loop
 *  if a re-subscribe keeps failing (e.g. the terminal is genuinely gone — the
 *  tile then unmounts, interrupting the fiber and ending the loop). */
const REATTACH_BACKOFF_MS = 300;

/** Consume a terminal-attach stream that must SURVIVE a mid-chain (padi↔kolu-server)
 *  death — the W2.2 done-criterion (c). The face's own retry fence
 *  (`unenrolledStreamCall`) transparently re-subscribes on a browser↔kolu-server
 *  TRANSPORT drop (an `RpcClientError` → retried forever, the stream never ends).
 *  But when the padi process dies mid-attach, kolu-server's fail-through relay ENDS
 *  the browser stream with an application failure, which the fence's POSITIVE match
 *  deliberately refuses to retry — so without this, the tile would strand until
 *  reload. This is APPLICATION wiring, not framework retry: on an ABNORMAL end (a
 *  failure, never a teardown) we `onReattach()` (reset xterm + re-arm the snapshot
 *  boundary, exactly as the inner `onRetry` does, so the fresh stream's snapshot
 *  replaces stale bytes without double-painting) and RE-SUBSCRIBE — the retry
 *  reconnects end-to-end once kolu-server re-binds the padi it adopts-or-spawns, and
 *  the first frame of the fresh stream is a fresh snapshot. A GRACEFUL end (the PTY
 *  exited — the stream completed) does NOT re-attach: the effect SUCCEEDS, and
 *  `Effect.retry` retries failures only. The tile is then torn down via the
 *  `terminalExit` event.
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
): Effect.Effect<void, unknown> {
  return Stream.runForEach(Stream.suspend(streamFn), (item) =>
    Effect.sync(() => onItem(item)),
  ).pipe(
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

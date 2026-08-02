import { runStreamScoped } from "@kolu/surface/solid";
import type { Stream } from "effect";

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
 *  exited — the stream completed) does NOT re-attach: the tile is torn down via the
 *  `terminalExit` event, which aborts `signal`. A small backoff bounds the loop if a
 *  re-subscribe keeps failing (e.g. the terminal is genuinely gone — the tile then
 *  unmounts and aborts the signal, ending the loop).
 *
 *  `streamFn` is re-entered per attempt, so each re-attach picks up whatever the
 *  caller reads at open time (Terminal.tsx re-reads the live grid there).
 *
 *  There is no expected-cleanup arm any more: teardown is a fiber interrupt, and
 *  `runStreamScoped` reports NOTHING once its stopper has run (D10/#18) — so the
 *  unmount abort can no longer reach `onFailure` and be mistaken for a mid-chain
 *  death. `signal` stays because the CALLER's cancellation vocabulary is still an
 *  `AbortSignal` (the attempt supersession in Terminal.tsx); it is translated into
 *  one interrupt here, at the edge. */
export function consumeReattachingStream<T>(
  streamFn: () => Stream.Stream<T, unknown>,
  onItem: (item: T) => void,
  onReattach: () => void,
  signal: AbortSignal,
  label: string,
) {
  let stop: (() => void) | undefined;
  let backoff: ReturnType<typeof setTimeout> | undefined;

  const open = (): void => {
    if (signal.aborted) return;
    stop = runStreamScoped<T>(streamFn(), {
      onFrame: onItem,
      // Graceful end (PTY exit) — the tile tears down separately.
      onEnd: () => {},
      onFailure: (err) => {
        if (signal.aborted) return;
        // Fresh reset FIRST so the reopened stream's snapshot repaints cleanly.
        console.warn(
          `${label}: re-attaching after a mid-chain stream end`,
          err,
        );
        onReattach();
        backoff = setTimeout(open, 300);
      },
    });
  };

  signal.addEventListener(
    "abort",
    () => {
      stop?.();
      if (backoff !== undefined) clearTimeout(backoff);
    },
    { once: true },
  );
  open();
}

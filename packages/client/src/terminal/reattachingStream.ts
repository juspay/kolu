import { isExpectedCleanupError } from "../rpc/streamCleanup";

/** Consume a terminal-attach stream that must SURVIVE a mid-chain (padi↔kolu-server)
 *  death — the W2.2 done-criterion (c). `unenrolledStreamCall`'s `STREAM_RETRY`
 *  transparently re-subscribes on a browser↔kolu-server transport drop (a plain
 *  dead-transport error → retried forever, the stream never ends). But when the
 *  padi process dies mid-attach, kolu-server's fail-through relay ENDS the browser
 *  stream with an `ORPCError` (an oRPC-wrapped handler throw), which
 *  `shouldNotRetryORPCError` classifies as NON-retriable — so `STREAM_RETRY` never
 *  fires and, without this, the tile would strand until reload. This is APPLICATION
 *  wiring, not framework retry: on an ABNORMAL end (an error that is NOT the
 *  unmount abort) we `onReattach()` (reset xterm + re-arm the snapshot boundary,
 *  exactly as the inner `onRetry` does, so the fresh stream's snapshot replaces
 *  stale bytes without double-painting) and RE-SUBSCRIBE — the retry reconnects
 *  end-to-end once kolu-server re-binds the padi it adopts-or-spawns, and the first
 *  frame of the fresh stream is a fresh snapshot. A GRACEFUL end (the PTY exited —
 *  the generator returned) does NOT re-attach: the tile is torn down via the
 *  `terminalExit` event, which aborts `signal`. A small backoff bounds the loop if
 *  a re-subscribe keeps failing (e.g. the terminal is genuinely gone — the tile
 *  then unmounts and aborts the signal, ending the loop). */
export function consumeReattachingStream<T>(
  streamFn: () => Promise<AsyncIterable<T>>,
  onItem: (item: T) => void,
  onReattach: () => void,
  signal: AbortSignal,
  label: string,
) {
  void (async () => {
    while (!signal.aborted) {
      try {
        for await (const item of await streamFn()) onItem(item);
        return; // graceful end (PTY exit) — the tile tears down separately.
      } catch (err) {
        if (isExpectedCleanupError(err)) return; // unmount abort — stop.
        // Abnormal end (a mid-chain ORPCError `STREAM_RETRY` won't retry): the
        // tile is still alive, so re-attach with a fresh snapshot after a short
        // backoff. Fresh reset FIRST so the snapshot repaints cleanly.
        if (signal.aborted) return;
        console.warn(
          `${label}: re-attaching after a mid-chain stream end`,
          err,
        );
        onReattach();
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  })();
}

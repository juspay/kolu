/**
 * Framework-run drain-and-confirm-exit — the skeleton BOTH enactments share.
 *
 * A drainable probe/connector only supplies two plugs:
 *   - `drain` — fire the daemon's drain verb (fire-and-forget; its resolve/reject
 *     is not ground truth)
 *   - `awaitExit` — observe that the daemon actually left (socket close, hello
 *     poll rejecting, …)
 *
 * The framework owns the race against a ceiling, the arm-before-drain ordering,
 * and aborting the wait when the ceiling wins. Consumers never re-implement this.
 *
 * GROUND TRUTH is the EXIT (daemon actually gone), NOT the drain call's
 * resolve/reject. A drain that reached the daemon may resolve with the process
 * still momentarily alive, or reject mid-write as the link dies — neither is the
 * completion signal. Waiting only for the resolve would let a pre-flight re-adopt
 * a still-live, about-to-exit daemon.
 */

export type DrainAndAwaitExitResult = {
  /** True when the exit was observed within `ceilingMs`. */
  readonly took: boolean;
  /** A mid-write `drain()` rejection, if any — for the caller to fold into a
   *  not-taken message. Null when the call resolved (or was never observed to reject). */
  readonly drainRejection: string | null;
};

/** The shared "; drain call rejected: …" tail for a drain-did-not-take error. */
export function drainRejectionSuffix(rejection: string | null): string {
  return rejection ? `; drain call rejected: ${rejection}` : "";
}

/**
 * Arm the exit wait, fire the drain, race exit vs ceiling.
 *
 * `awaitExit` is armed BEFORE the drain is fired, so a fast exit that fires before
 * `drain()` even settles is never missed. It resolves when the exit is observed and
 * MUST NOT reject — it observes its own {@link AbortSignal} (aborted the instant the
 * ceiling wins) to stop cleanly, so a poll-based plug never leaks a probe every tick
 * after the primitive returns.
 */
export async function drainAndAwaitExit(
  drain: () => Promise<void>,
  awaitExit: (signal: AbortSignal) => Promise<void>,
  { ceilingMs }: { ceilingMs: number },
): Promise<DrainAndAwaitExitResult> {
  if (!Number.isFinite(ceilingMs) || ceilingMs <= 0) {
    throw new Error(
      `drainAndAwaitExit ceilingMs must be a positive number, got ${ceilingMs}`,
    );
  }
  const abort = new AbortController();
  const exited = awaitExit(abort.signal);
  // Defensive: a mis-behaving plug must not crash the process.
  exited.catch(() => {});

  let drainRejection: string | null = null;
  // Normalize so a sync throw is captured the same as an async rejection —
  // drain completion is never ground truth; the framework owns cleanup.
  void Promise.resolve()
    .then(() => drain())
    .catch((e) => {
      drainRejection = String(e);
    });

  let timer!: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ceilingMs);
  });
  try {
    const outcome = await Promise.race([
      exited.then(() => "exited" as const),
      timedOut,
    ]);
    return { took: outcome === "exited", drainRejection };
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

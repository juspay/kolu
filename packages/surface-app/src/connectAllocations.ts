/**
 * What a turnkey connect seam has allocated, so both of its exits can give it
 * back — ONE list, read by the failure path and by the success path.
 *
 * `connectSurface` and `connectSurfaces` are ASYNC, and the await is the DIAL.
 * Everything after it is allocation over a wire that is already live: the
 * half-open watchdog (`createLiveSignal` arms a heartbeat and a wake listener),
 * the clients (each with its own standing subscriptions — a mirrored surface
 * opens its eager `liveWhen` sub at construction), and the readout's memo root.
 * Any of those can throw. `buildSurfaceClient` throws BY DESIGN when a surface
 * whose spec declares a `client.onError` policy is built with no interpreter
 * (design §D/F5) — a documented, reachable construction crash, and exactly the
 * shape a rooted `core` or a policy-bearing sibling can carry.
 *
 * Without an unwind, that throw becomes a rejected promise and the caller is
 * handed NOTHING: no `dispose`, no `link`, no handle of any kind — while a
 * websocket stays open, a heartbeat keeps probing it, and every client built
 * before the failing one keeps its subscriptions. A leak the caller cannot even
 * name, which is the worst kind: `connectSurface`'s own URL-default refusal
 * states the opposing law ("BEFORE allocation: nothing was ever dialled"), and
 * that law has to hold on both sides of the dial.
 *
 * **Both exits read the same list, and that is the point.** A seam whose failure
 * teardown and success teardown are two hand-written lists has to keep them in
 * step by hand, and the way that breaks is asymmetric and silent: an allocation
 * added to the unwind but forgotten in `dispose` leaks on the COMMON path — the
 * one every consumer takes — while the failure path, the one anybody would think
 * to check, still looks correct. So {@link ConnectAllocations.release} is the
 * whole teardown and {@link ConnectAllocations.unwind} is `release` plus a
 * rethrow. There is no second list to forget.
 *
 * Release order is REVERSE allocation order, and a release that itself throws is
 * REPORTED, never swallowed and never allowed to replace whatever it was
 * unwinding — a teardown fault masking the fault that caused the teardown is how
 * a one-line miswiring becomes an afternoon.
 *
 * Package-internal, and NOT under `./solid`: it holds no Solid concept at all.
 */

/** Anything a connect seam allocates and must give back. Every resource these
 *  two seams hold answers to `dispose`; the async arm is the wire's. */
interface Disposable {
  dispose(): void | Promise<void>;
}

interface ConnectAllocations {
  /** Record a live resource and hand it straight back, so an allocation is
   *  wrapped in place rather than restated. `what` names it in the
   *  teardown-failure report — the reader of that line has no other clue which
   *  step failed. */
  track<T extends Disposable>(what: string, value: T): T;
  /** Release everything tracked, in reverse. THE teardown: the connection's own
   *  `dispose` is this and nothing else. */
  release(): Promise<void>;
  /** {@link release}, then rethrow `cause` — the failed-connect exit. Returns
   *  `Promise<never>`: the only way out is the original error. */
  unwind(cause: unknown): Promise<never>;
}

export function trackConnectAllocations(seam: string): ConnectAllocations {
  const allocated: Array<{ what: string; value: Disposable }> = [];
  const release = async (): Promise<void> => {
    // Reverse order, and a copy — `dispose` is idempotent for a page-lifetime
    // bundle only if a second call finds the same list, so the walk must not
    // consume it.
    for (const { what, value } of [...allocated].reverse()) {
      try {
        await value.dispose();
      } catch (teardownError) {
        console.error(
          `${seam}: releasing the ${what} FAILED — this resource is leaked, and the ` +
            "error below is the teardown's, not whatever was being reported to the caller",
          teardownError,
        );
      }
    }
  };
  return {
    track: (what, value) => {
      allocated.push({ what, value });
      return value;
    },
    release,
    unwind: async (cause) => {
      await release();
      throw cause;
    },
  };
}

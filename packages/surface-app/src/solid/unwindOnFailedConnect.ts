/**
 * The unwind both turnkey connect seams share — one spelling of "the dial
 * succeeded and a later construction step threw."
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
 * Release order is REVERSE allocation order, and a release that itself throws is
 * REPORTED, never swallowed and never allowed to replace the construction error
 * it is unwinding — a teardown fault masking the fault that caused the teardown
 * is how a one-line miswiring becomes an afternoon.
 *
 * Package-internal: it is not on the `./solid` barrel, because it is the two
 * seams' shared spelling and not a capability a consumer plugs into.
 */

/** Track what a connect seam has allocated, so a later throw can give it all
 *  back. `track` returns its value, so it wraps an allocation in place. */
export interface ConnectAllocations {
  /** Record a live resource and hand it straight back. `what` names it in the
   *  teardown-failure report — the reader of that line has no other clue which
   *  step failed. */
  track<T>(
    what: string,
    value: T,
    release: (value: T) => void | Promise<void>,
  ): T;
  /** Release everything tracked, in reverse, then rethrow `cause`. Returns
   *  `Promise<never>`: the only way out is the original error. */
  unwind(cause: unknown): Promise<never>;
}

export function trackConnectAllocations(seam: string): ConnectAllocations {
  const allocated: Array<{
    what: string;
    release: () => void | Promise<void>;
  }> = [];
  return {
    track: (what, value, release) => {
      allocated.push({ what, release: () => release(value) });
      return value;
    },
    unwind: async (cause) => {
      for (const { what, release } of allocated.reverse()) {
        try {
          await release();
        } catch (teardownError) {
          console.error(
            `${seam}: releasing the ${what} FAILED while unwinding a connect that ` +
              "threw after dialling — this resource is leaked, and the error below " +
              "is the teardown's, not the one being reported to the caller",
            teardownError,
          );
        }
      }
      throw cause;
    },
  };
}

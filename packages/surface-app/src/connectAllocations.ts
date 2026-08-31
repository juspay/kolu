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
 * Release order is REVERSE allocation order. The two exits differ in exactly one
 * way, and it is deliberate: what they do with a release that ITSELF throws.
 *
 *   - {@link ConnectAllocations.unwind} swallows it to a `console.error` and
 *     rethrows the CONSTRUCTION error, because that error is what the caller
 *     needs to see. A teardown fault masking the fault that caused the teardown
 *     is how a one-line miswiring becomes an afternoon.
 *   - {@link ConnectAllocations.release} — the connection's own `dispose` —
 *     REJECTS, with an `AggregateError` over everything that failed. There is no
 *     original error to protect there, and a `dispose()` that resolves while the
 *     socket it was asked to close is still open is a lie the awaiting caller
 *     has no way to catch. It still attempts every release before it throws:
 *     one failure must not strand the resources behind it.
 *
 * Package-internal, and NOT under `./solid`: it holds no Solid concept at all.
 *
 * **Not Effect's `Scope`, deliberately, and this is the third review to ask.**
 * The repo does drive `Scope.makeUnsafe()` from plain async code — but at those
 * sites (`unix-socket.ts`, `peer-server.ts`) the thing being closed is a scope
 * Effect itself created. Here every resource is a plain `{ dispose() }` value, so
 * adopting `Scope` would mean wrapping each one INTO an Effect finalizer purely to
 * get a stack back out: adapter code, not reuse. A `Cause` also cannot carry the
 * per-resource WORD that makes a teardown-failure line actionable — "releasing the
 * watchdog FAILED" is the whole value of that log. Recorded rather than argued: if
 * these seams ever become Effect-shaped end to end, this is the first thing to
 * delete.
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
  /** Release everything tracked, in reverse — THE teardown, and the connection's
   *  own `dispose` is this and nothing else. Attempts every release, then REJECTS
   *  with an `AggregateError` if any failed. */
  release(): Promise<void>;
  /** {@link release}, then rethrow `cause` — the failed-connect exit. Returns
   *  `Promise<never>`: the only way out is the original error, so a release that
   *  failed on the way is logged rather than raised. */
  unwind(cause: unknown): Promise<never>;
}

export function trackConnectAllocations(seam: string): ConnectAllocations {
  const allocated: Array<{ what: string; value: Disposable }> = [];
  /** Attempt every release in reverse and RETURN what failed — never throw, so one
   *  failure cannot strand the resources behind it. The two exits decide what to do
   *  with the list. */
  const releaseAll = async (): Promise<Error[]> => {
    const failures: Error[] = [];
    // Reverse order, over a COPY — `dispose` is idempotent for a page-lifetime
    // bundle only if a second call finds the same list, so the walk must not
    // consume it.
    for (const { what, value } of [...allocated].reverse()) {
      try {
        await value.dispose();
      } catch (teardownError) {
        failures.push(
          new Error(
            `${seam}: releasing the ${what} FAILED — this resource is leaked`,
            {
              cause: teardownError,
            },
          ),
        );
      }
    }
    return failures;
  };
  return {
    track: (what, value) => {
      allocated.push({ what, value });
      return value;
    },
    release: async () => {
      const failures = await releaseAll();
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `${seam}: ${failures.length} resource(s) failed to release — a \`dispose()\` ` +
            "that resolved here would claim a teardown that did not happen",
        );
      }
    },
    unwind: async (cause) => {
      for (const failure of await releaseAll()) {
        // Logged, not raised: `cause` is the construction error the caller is
        // waiting on, and a teardown fault must not take its place.
        console.error(failure.message, failure.cause);
      }
      throw cause;
    },
  };
}

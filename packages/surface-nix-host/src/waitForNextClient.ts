import type { AnyContractRouter } from "@orpc/contract";
import type { AgentClient, HostSession } from "./hostSession";

/** A stateful cursor over a session's spawn lifecycle. Each `next()` blocks
 *  until the session exposes a genuinely NEW spawn, then resolves with that
 *  spawn's live client. The cursor owns the spawn-identity token internally,
 *  so consumers never thread it by hand.
 *
 *  Rejects (from `next()`) if the session is destroyed before a fresh spawn
 *  appears.
 *
 *  Typical usage from a consumer's reconnect-loop:
 *
 *  ```ts
 *  const cursor = makeClientCursor(session);
 *  while (!session.isDestroyed()) {
 *    const client = await cursor.next();
 *    await Promise.allSettled([pumpA(client), pumpB(client)]);
 *  }
 *  ``` */
export interface ClientCursor<C extends AnyContractRouter> {
  /** Block until the session exposes a new spawn; resolve with its client. */
  next(): Promise<AgentClient<C>>;
}

/** Build a {@link ClientCursor} over `session`.
 *
 *  The cursor closes over the spawn-identity token (a `clientPromise`
 *  reference) and advances it on every `next()`, so the comparison axis stays
 *  an implementation detail of this module — consumers see only "give me the
 *  next live client." That encapsulation is load-bearing, not cosmetic:
 *  hand-threading the token (the shape this replaces) had a silent footgun —
 *  forget to advance it and `next()` resolves instantly every iteration,
 *  busy-spinning exactly as the bug below describes. With the token hidden,
 *  there is nothing to forget. */
export function makeClientCursor<C extends AnyContractRouter>(
  session: HostSession<C>,
): ClientCursor<C> {
  let previous: Promise<AgentClient<C>> | null = null;
  return {
    async next(): Promise<AgentClient<C>> {
      const { client, clientPromise } = await waitForNextClient(
        session,
        previous,
      );
      previous = clientPromise;
      return client;
    },
  };
}

/** The result of `waitForNextClient`: the freshly-live `client` to pump, plus
 *  the `clientPromise` it came from. `makeClientCursor` threads `clientPromise`
 *  back in as `previous` so the next wait blocks until a genuinely new spawn
 *  appears. */
interface NextClient<C extends AnyContractRouter> {
  client: AgentClient<C>;
  clientPromise: Promise<AgentClient<C>>;
}

/** Block until the session exposes a NEW spawn — a `clientPromise`
 *  *instance* distinct from `previous` — then resolve with that spawn's
 *  client. Rejects if the session is destroyed before a fresh spawn
 *  appears.
 *
 *  Internal primitive behind {@link makeClientCursor}; callers go through the
 *  cursor rather than threading `previous` themselves.
 *
 *  **Compare the promise, never the awaited client.** The client is an
 *  oRPC proxy that intercepts every property — including `.then` — as a
 *  procedure path, which makes it *thenable*: `await clientPromise`
 *  re-invokes the proxy and yields a fresh object on every call, so a
 *  resolved-client identity check (`client !== previous`) is *always*
 *  true. A consumer reconnect-loop that re-pumps on each
 *  `waitForNextClient` would then resolve instantly every iteration and
 *  busy-spin — pegging the event loop so the child-`exit` handler and the
 *  reconnect-backoff timer never run, which is self-sustaining. The
 *  `clientPromise` reference, by contrast, is reassigned exactly once per
 *  spawn (`pin`/`reconnect`/`scheduleReconnect`) and is null between a
 *  child's death and the next spawn — so comparing *it* correctly blocks
 *  until a real reconnect. */
function waitForNextClient<C extends AnyContractRouter>(
  session: HostSession<C>,
  previous: Promise<AgentClient<C>> | null,
): Promise<NextClient<C>> {
  return new Promise((resolve, reject) => {
    const tryResolve = async (): Promise<boolean> => {
      if (session.isDestroyed()) {
        reject(new Error("session destroyed"));
        return true;
      }
      const clientPromise = session.currentClient();
      // null (no spawn in flight) or the same promise the caller already
      // pumped (link still down / unchanged) → keep waiting. This identity
      // check on the *promise* is what stops the busy-spin.
      if (clientPromise === null || clientPromise === previous) return false;
      try {
        const client = await clientPromise;
        resolve({ client, clientPromise });
        return true;
      } catch {
        // Spawn rejected — stay in the loop; the next state change
        // (scheduleReconnect's timer firing) surfaces a fresh promise.
      }
      return false;
    };
    void tryResolve().then((done) => {
      if (done) return;
      const unsub = session.onState(() => {
        void tryResolve().then((doneNow) => {
          if (doneNow) unsub();
        });
      });
    });
  });
}

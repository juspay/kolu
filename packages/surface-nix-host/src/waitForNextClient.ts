import type { AnyContractRouter } from "@orpc/contract";
import type { AgentClient, HostSession } from "./hostSession";

/** The result of `waitForNextClient`: the freshly-live `client` to pump,
 *  plus the `clientPromise` it came from. Callers thread `clientPromise`
 *  back in as `previous` so the next wait blocks until a genuinely new
 *  spawn appears. */
export interface NextClient<C extends AnyContractRouter> {
  client: AgentClient<C>;
  clientPromise: Promise<AgentClient<C>>;
}

/** Block until the session exposes a NEW spawn — a `clientPromise`
 *  *instance* distinct from `previous` — then resolve with that spawn's
 *  client. Rejects if the session is destroyed before a fresh spawn
 *  appears.
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
 *  until a real reconnect.
 *
 *  Typical usage from a consumer's reconnect-loop:
 *
 *  ```ts
 *  let last: Promise<AgentClient<C>> | null = null;
 *  while (!session.isDestroyed()) {
 *    const { client, clientPromise } = await waitForNextClient(session, last);
 *    last = clientPromise;
 *    await Promise.allSettled([pumpA(client), pumpB(client)]);
 *  }
 *  ``` */
export function waitForNextClient<C extends AnyContractRouter>(
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

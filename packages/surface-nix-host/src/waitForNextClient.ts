import type { AnyContractRouter } from "@orpc/contract";
import type { AgentClient, HostSession } from "./hostSession";

/** Block until the session exposes a NEW `clientPromise` instance
 *  (one whose resolved client differs from `previous`). Resolves with
 *  the awaited client. Rejects if the session is destroyed before a
 *  fresh client appears.
 *
 *  Identity-comparison is the trick that avoids spinning: when a pump
 *  loop's `for await` ends because the link errored, the child's
 *  `exit` handler clears `clientPromise` to null and `scheduleReconnect`
 *  later sets it to a new Promise. Until that new Promise resolves,
 *  `currentClient()` returns either null or the same dead handle the
 *  pumps just abandoned — we wait through both.
 *
 *  Typical usage from a consumer's reconnect-loop:
 *
 *  ```ts
 *  let last: AgentClient<C> | null = null;
 *  while (!session.isDestroyed()) {
 *    const client = await waitForNextClient(session, last);
 *    last = client;
 *    await Promise.allSettled([pumpA(client), pumpB(client)]);
 *  }
 *  ``` */
export function waitForNextClient<C extends AnyContractRouter>(
  session: HostSession<C>,
  previous: AgentClient<C> | null,
): Promise<AgentClient<C>> {
  return new Promise((resolve, reject) => {
    const tryResolve = async (): Promise<boolean> => {
      if (session.isDestroyed()) {
        reject(new Error("session destroyed"));
        return true;
      }
      const cp = session.currentClient();
      if (cp === null) return false;
      try {
        const c = await cp;
        if (c !== previous) {
          resolve(c);
          return true;
        }
      } catch {
        // Spawn rejected — stay in the loop; the next state change
        // (scheduleReconnect's timer firing) will surface a fresh
        // clientPromise.
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

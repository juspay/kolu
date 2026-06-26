/**
 * Y5 — the REAL registry over pulam-web's OWN surface.
 *
 * `HostGroup.test.tsx` hand-stubs `app.health()` (it drives the gate's render),
 * so it can't catch a FORGOTTEN enrol in pulam-web's actual surface — a raw
 * stream added later that never joins `client.health()`, the exact partial-gate
 * hazard the primitive exists to kill. This builds the REAL `surfaceClient` over
 * pulam-web's REAL `pulamSurface` (a stub link standing in for the websocket) and
 * asserts the subscriptions HostGroup gates on appear in `health()` BY NAME — the
 * non-vacuous shape `surfaceClient.health.test.ts` pins for the generic surface,
 * here over the production surface. Revert any birth-site enrol (or add an
 * un-enrolled raw stream in its place) and this set shrinks → red.
 */

import { surfaceClient } from "@kolu/surface/solid";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { pulamSurface } from "../shared/contract.ts";

/** A wire stream that yields `value` once then completes — the sub goes
 *  past-first-frame and stays healthy. Ignores its `(input, opts)` args. */
function once<T>(value: T) {
  return (..._args: unknown[]): Promise<AsyncIterable<T>> =>
    Promise.resolve(
      (async function* () {
        yield value;
      })(),
    );
}

const noop = () => Promise.resolve();

/** Two macrotasks, matching the surface package's subscription tests: the
 *  keys-stream yields on the first, any per-key fan-out settles on the second. */
const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

/** A link that answers EVERY primitive on the surface with a universal stub
 *  namespace — a cell/stream `get`, a collection `keys`/`get`/`upsert`/`delete`.
 *  `surfaceClient` walks the whole spec at build time (every cell/collection/
 *  stream), so the Proxy spares us enumerating all of `terminalWorkspaceSurface`;
 *  the values are shape-free (the client doesn't validate — that's the server's
 *  job), they only need to drive a first frame. */
const stubLink = {
  surface: new Proxy(
    {},
    {
      get: () => ({
        get: once({}),
        keys: once<string[]>([]),
        upsert: noop,
        delete: noop,
      }),
    },
  ),
};

describe("pulam-web surfaceClient health — the real registry over pulamSurface", () => {
  it("enrols the connection cell, the awareness keys-stream, and the activity stream by name", async () => {
    await createRoot(async (dispose) => {
      const app = surfaceClient(
        pulamSurface,
        // biome-ignore lint/suspicious/noExplicitAny: Proxy stub link stands in for the typed websocket ContractRouterClient.
        stubLink as any,
      );
      // Exactly the three subscriptions HostGroup's gate folds.
      app.cells.connection.use();
      app.collections.awareness.use({});
      app.streams.activity.use(() => ({}));
      await settle();

      const names = app
        .health()
        .subs.map((s) => s.name)
        .sort();
      // The keys-stream yields `[]`, so no per-key fan-out — just the three.
      expect(names).toEqual(["activity", "awareness.keys", "connection"]);
      // All healthy over the stub: each yielded a first frame, none erroring.
      const fact = app.health();
      expect(fact.subs.every((s) => !s.pending && s.error === undefined)).toBe(
        true,
      );
      dispose();
    });
  });
});

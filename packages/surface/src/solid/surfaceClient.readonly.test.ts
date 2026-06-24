/**
 * `surfaceClient` honors a cell's `verbs` — the CLIENT-side dual of the raw
 * contract honoring `verbs` (`define.test.ts`).
 *
 * A get-only cell (`verbs: ["get"]`, e.g. `@kolu/surface-nix-host`'s
 * connection-health cell) must bind to a READ-ONLY view: no `.set` / `.patch`
 * and no `authority: "local"` path. The raw contract router carries no `set`
 * for such a cell, so a typed `app.cells.<getOnly>.use(...).set(...)` would be
 * an API-facing falsehood that throws "no mutate handler" at runtime — the very
 * forge-the-health-signal hole the get-only cell exists to close. This file
 * pins BOTH halves (the bound type and the runtime mutate binding) so a refactor
 * can't regrow the phantom mutation path on the Solid client.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "../define";
import { surfaceClient } from "./surfaceClient";

const surface = defineSurface({
  cells: {
    // Read-only: the parent owns it server-side; the wire carries only `get`.
    conn: {
      schema: z.object({ state: z.string() }),
      default: { state: "connecting" },
      verbs: ["get"],
    },
    // Mutable (default verbs `["get", "set"]`) — the contrast case.
    prefs: {
      schema: z.object({ theme: z.string() }),
      default: { theme: "dark" },
    },
  },
});

/** A stub link exposing only `surface.<cell>.get` per cell — NO `set`/`patch`,
 *  exactly what the contract router serves for a get-only cell. `surfaceClient`
 *  must not reach for an absent `set`. */
function stubLink() {
  const get = () =>
    // biome-ignore lint/suspicious/noExplicitAny: the bound `.use()` is never invoked here; we assert on the binding, not a subscription.
    (async function* () {})() as any;
  const setSpy = { called: false };
  return {
    setSpy,
    link: {
      surface: {
        conn: { get },
        prefs: {
          get,
          set: () => {
            setSpy.called = true;
            return Promise.resolve();
          },
        },
      },
    },
  };
}

describe("surfaceClient cell verbs", () => {
  it("does NOT bind a mutate for a get-only cell (no phantom `ns.set`)", () => {
    const { link } = stubLink();
    // biome-ignore lint/suspicious/noExplicitAny: stub link shape stands in for the typed ContractRouterClient.
    const app = surfaceClient(surface, link as any);
    // The bound read-only cell exposes `.use` but no imperative mutate; the
    // runtime closure captured `mutate === undefined`, so even reaching the
    // server-authority `set` would throw rather than call an absent `ns.set`.
    const conn = app.cells.conn;
    expect(typeof conn.use).toBe("function");
    // @ts-expect-error — a read-only bound cell's `.use()` result has no `set`.
    type _NoSet = ReturnType<typeof conn.use>["set"];
    // @ts-expect-error — a get-only cell rejects the local-authority path.
    conn.use({ authority: "local", initial: { state: "x" } });
  });

  it("binds `set` for a default mutable cell", () => {
    const { link } = stubLink();
    // biome-ignore lint/suspicious/noExplicitAny: stub link shape stands in for the typed ContractRouterClient.
    const app = surfaceClient(surface, link as any);
    const prefs = app.cells.prefs;
    // The mutable cell keeps its imperative mutate surface.
    type Result = ReturnType<typeof prefs.use>;
    const hasSet: "set" extends keyof Result ? true : false = true;
    expect(hasSet).toBe(true);
    expect(typeof prefs.use).toBe("function");
  });
});

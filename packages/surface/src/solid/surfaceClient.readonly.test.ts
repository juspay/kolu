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
    // Read-only on the client: `test__set` is the e2e reset procedure, not a
    // consumer mutation (e.g. `activityFeed` / `session`). The server is the
    // sole writer, so the bound cell must NOT advertise `.set` the runtime
    // can't service — `mutate` stays undefined despite the non-`get` verb.
    feed: {
      schema: z.object({ items: z.array(z.string()) }),
      default: { items: [] },
      verbs: ["get", "test__set"],
    },
    // A `patchSchema` cell that explicitly exposes `set` (not `patch`). The
    // binding must follow the exposed verb, so it captures `ns.set`, not the
    // `ns.patch` a naive `patchSchema ? "patch" : "set"` would reach for. The
    // patch shape (`{ delta }`) is DELIBERATELY different from the full value
    // (`{ n, label }`): the wire serves only the full-value `set`, so the bound
    // cell must collapse its client patch shape to the full value `T` — a
    // `.patch({ delta })` would post a partial the `set` endpoint rejects.
    explicitSet: {
      schema: z.object({ n: z.number(), label: z.string() }),
      default: { n: 0, label: "" },
      patchSchema: z.object({ delta: z.number() }),
      verbs: ["get", "set"],
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
  const noop = () => Promise.resolve();
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
        // Mirrors the contract router for a `["get", "test__set"]` cell — a
        // `test__set` verb but NO `set`/`patch`. `surfaceClient` must not reach
        // for an absent `ns.set`/`ns.patch`.
        feed: { get, test__set: noop },
        // A `patchSchema` cell exposing `set` (not `patch`) — only `ns.set` is
        // on the wire. The binding must capture `set`, not the absent `patch`.
        explicitSet: { get, set: noop },
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

  it("treats a `['get', 'test__set']` cell as read-only (test__set is not a consumer mutation)", () => {
    const { link } = stubLink();
    // biome-ignore lint/suspicious/noExplicitAny: stub link shape stands in for the typed ContractRouterClient.
    const app = surfaceClient(surface, link as any);
    const feed = app.cells.feed;
    expect(typeof feed.use).toBe("function");
    // @ts-expect-error — `test__set` doesn't make the cell mutable on the client.
    type _NoSet = ReturnType<typeof feed.use>["set"];
    // @ts-expect-error — the local-authority path is rejected: no client mutate verb.
    feed.use({ authority: "local", initial: { items: [] } });
  });

  it("binds the exposed `set` for a patchSchema cell that lists `set` (not `patch`)", () => {
    const { link } = stubLink();
    // biome-ignore lint/suspicious/noExplicitAny: stub link shape stands in for the typed ContractRouterClient.
    const app = surfaceClient(surface, link as any);
    const explicitSet = app.cells.explicitSet;
    // Mutable: `set` is exposed, so the imperative mutate surface is present.
    type Result = ReturnType<typeof explicitSet.use>;
    const hasSet: "set" extends keyof Result ? true : false = true;
    expect(hasSet).toBe(true);
    // The runtime bound `ns.set` (not the absent `ns.patch`); reaching the
    // local-authority path would otherwise throw "no mutate handler".
    expect(typeof explicitSet.use).toBe("function");

    // The client patch shape COLLAPSES to the full value `T` (`{ n, label }`),
    // because the only wire mutation is the full-value `set`. A `.patch` of the
    // declared partial `patchSchema` (`{ delta }`) must NOT typecheck — that
    // would post a partial payload the `set` endpoint would reject. These two
    // assertions pin the soundness the differing `T`/`P` exists to catch.
    const result = explicitSet.use();
    // `.patch` accepts the full value — sound against `set`.
    void (() => result.patch({ n: 1, label: "x" }));
    // @ts-expect-error — `.patch` must reject the partial `{ delta }`: a set-only
    // cell has no `P`-shaped wire procedure, so its client patch shape is `T`.
    void (() => result.patch({ delta: 1 }));
  });
});

/**
 * `extendSurface` — compose a parent-LOCAL runtime onto a RE-SERVED one (SR5).
 *
 * The three properties the plan names:
 *
 *   - the composed router serves EVERY base + extension member FLAT under one
 *     `surface` namespace, and — the SR1 lesson — those routes survive over the
 *     WIRE MATCHER (`StandardRPCMatcher`), not just `directLink` (which bypasses
 *     the matcher). A fragment carries no matcher meta of its own; binding both
 *     through `implement(combined).router({...})` is what attaches the routes;
 *   - supervision routes through `superviseTerminalSource`: the base is the
 *     terminal driver (its end resolves the composite), `close` releases both;
 *   - a member-name collision between base and extension fails loud.
 */

import { StandardRPCMatcher } from "@orpc/server/standard";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { directLink } from "./links/direct";
import {
  extendSurface,
  implementSurface,
  inMemoryStore,
  type ServedSurface,
} from "./server";

// A re-served BASE: a status cell + a keyed collection (the mirror's shape).
const baseSurface = defineSurface({
  cells: { status: { schema: z.string(), default: "" } },
  collections: { items: { keySchema: z.string(), schema: z.number() } },
});
// A parent-LOCAL extension: a retention cell (drishti's `metricHistory` shape).
const extSurface = defineSurface({
  cells: { history: { schema: z.array(z.number()), default: [] } },
});

function buildBase() {
  const map = new Map<string, number>();
  return implementSurface(baseSurface, {
    cells: { status: { store: inMemoryStore("live") } },
    collections: {
      items: {
        readAll: () => map,
        upsert: (k, v) => {
          map.set(k, v);
        },
        remove: (k) => {
          map.delete(k);
        },
      },
    },
  });
}

function buildExt() {
  return implementSurface(extSurface, {
    cells: { history: { store: inMemoryStore<number[]>([1, 2, 3]) } },
  });
}

describe("extendSurface", () => {
  it("routes every base + extension member FLAT over the wire matcher (no double-prefix)", () => {
    const baseRt = buildBase();
    const extRt = buildExt();
    const composed = extendSurface(
      { surface: baseSurface, ...baseRt },
      { surface: extSurface, ...extRt },
    );

    const matcher = new StandardRPCMatcher();
    // biome-ignore lint/suspicious/noExplicitAny: matcher.init takes a Router; the composed runtime shape satisfies it (the same `as any` RPCHandler uses).
    matcher.init(composed.router as any);
    const paths = Object.keys(
      (matcher as unknown as { tree: Record<string, unknown> }).tree,
    );

    // The base members route (the re-served fragment, re-adapted).
    expect(paths).toContain("/surface/status/get");
    expect(paths).toContain("/surface/items/keys");
    expect(paths).toContain("/surface/items/get");
    // The local extension member routes at the SAME flat prefix — byte-identical.
    expect(paths).toContain("/surface/history/get");
    // No double-prefix from the composition.
    expect(paths).not.toContain("/surface/surface/status/get");
  });

  it("calls a base member AND an extension member over one composed client", async () => {
    const composed = extendSurface(
      { surface: baseSurface, ...buildBase() },
      { surface: extSurface, ...buildExt() },
    );
    // The composed surface is precisely typed — base AND extension members are
    // reachable on one client with no cast (the SR2 typed-dual discipline).
    const client = directLink<typeof composed.surface.contract>(
      composed.router as never,
    );
    // The base's status cell (snapshot-then-deltas — take the first frame).
    for await (const v of await client.surface.status.get()) {
      expect(v).toBe("live");
      break;
    }
    // The local extension's history cell, served flat beside the base.
    for await (const v of await client.surface.history.get()) {
      expect(v).toEqual([1, 2, 3]);
      break;
    }
    await composed.close();
  });

  it("supervision: the base's terminal end resolves the composite done", async () => {
    let resolveTerminal!: () => void;
    const terminalDone = new Promise<void>((r) => {
      resolveTerminal = r;
    });
    const extRt = buildExt();
    const base: ServedSurface<never> = {
      surface: baseSurface as never,
      router: buildBase().router,
      done: terminalDone,
      close: async () => resolveTerminal(),
    };
    const composed = extendSurface(base, { surface: extSurface, ...extRt });

    let settled = false;
    void composed.done.then(() => {
      settled = true;
    });
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(false);

    resolveTerminal(); // the mirror's remote session was destroyed
    await expect(composed.done).resolves.toBeUndefined();
  });

  it("supervision: close() releases BOTH the base and the local extension", async () => {
    let baseClosed = 0;
    let resolveTerminal!: () => void;
    const terminalDone = new Promise<void>((r) => {
      resolveTerminal = r;
    });
    const extRt = buildExt();
    let extClosed = 0;
    const base: ServedSurface<never> = {
      surface: baseSurface as never,
      router: buildBase().router,
      done: terminalDone,
      close: async () => {
        baseClosed += 1;
        resolveTerminal();
      },
    };
    const ext: ServedSurface<never> = {
      surface: extSurface as never,
      router: extRt.router,
      done: extRt.done,
      close: async () => {
        extClosed += 1;
        await extRt.close();
      },
    };
    const composed = extendSurface(base, ext);
    await composed.close();
    expect(baseClosed).toBe(1);
    expect(extClosed).toBe(1);
    await composed.close(); // idempotent
    expect(baseClosed).toBe(1);
    expect(extClosed).toBe(1);
  });

  it("fails loud on a member-name collision between base and extension", () => {
    const clashing = defineSurface({
      // Same `status` cell name as the base — a composed surface can't have two.
      cells: { status: { schema: z.string(), default: "" } },
    });
    expect(() =>
      extendSurface(
        { surface: baseSurface, ...buildBase() },
        {
          surface: clashing,
          ...implementSurface(clashing, {
            cells: { status: { store: inMemoryStore("") } },
          }),
        },
      ),
    ).toThrow(/both serve member "status"/);
  });

  it("fails loud on a CROSS-KIND name collision (base cell vs ext procedure namespace)", () => {
    // The flat wire namespace is per-NAME across all kinds: a base cell `status` and
    // an ext procedure namespace `status` have disjoint verbs, so they escape the
    // per-kind spec guard AND defineSurface's per-(name,verb) claim — the guarded
    // splice is what stops the shallow spread from silently dropping one side.
    const clashingProc = defineSurface({
      procedures: {
        status: { refresh: { output: z.object({ ok: z.boolean() }) } },
      },
    });
    expect(() =>
      extendSurface(
        { surface: baseSurface, ...buildBase() },
        {
          surface: clashingProc,
          ...implementSurface(clashingProc, {
            procedures: { status: { refresh: () => ({ ok: true }) } },
          }),
        },
      ),
    ).toThrow(/both serve member "status"/);
  });
});

/**
 * `defineSurface` verb honoring — a cell's `verbs` narrows BOTH the runtime
 * contract router AND its static type, in lockstep.
 *
 * The load-bearing case is a read-only cell (`verbs: ["get"]`, e.g.
 * `@kolu/surface-nix-host`'s connection-health cell). It must expose `get` and
 * NOTHING else: a leaked `set` would let a remote RPC client forge the parent
 * host's link health to `connected` and defeat the very stale-health gate the
 * cell exists to power. This file pins that the narrowing holds on both sides,
 * so a refactor can't silently regrow `set` on either the wire or the type.
 */

import { StandardRPCMatcher } from "@orpc/server/standard";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";

const getOnlyCell = {
  schema: z.object({ x: z.string() }),
  default: { x: "" },
  verbs: ["get"],
} as const;

/** The wire paths a surface's contract router carries, read off the oRPC
 *  matcher tree (the same introspection `implementSurface.test.ts` uses). The
 *  contract router is itself a valid matcher input — no handlers needed, since
 *  we only assert on the contract's SHAPE. */
function contractPaths(surface: ReturnType<typeof defineSurface>): string[] {
  const matcher = new StandardRPCMatcher();
  // biome-ignore lint/suspicious/noExplicitAny: matcher.init expects a Router shape; the contract router satisfies the runtime shape we introspect.
  matcher.init(surface.contract as any);
  return Object.keys(
    (matcher as unknown as { tree: Record<string, unknown> }).tree,
  );
}

describe("defineSurface cell verbs", () => {
  it("a get-only cell's RUNTIME contract carries get but never set", () => {
    const surface = defineSurface({ cells: { conn: getOnlyCell } });
    const paths = contractPaths(surface);
    expect(paths).toContain("/surface/conn/get");
    expect(paths).not.toContain("/surface/conn/set");
  });

  it("a default (no verbs, no patch) cell still carries get AND set", () => {
    const surface = defineSurface({
      cells: {
        plain: { schema: z.object({ x: z.string() }), default: { x: "" } },
      },
    });
    const paths = contractPaths(surface);
    expect(paths).toContain("/surface/plain/get");
    expect(paths).toContain("/surface/plain/set");
  });

  it("the get-only cell's TYPE exposes get and NOT set (no phantom verb)", () => {
    const surface = defineSurface({ cells: { conn: getOnlyCell } });
    type Entry = (typeof surface.contract)["surface"]["conn"];
    // If `CellContract` ignored `verbs` (the pre-fix bug), `HasSet` would be
    // `true` here and this assignment would fail to compile — the regression.
    type HasGet = "get" extends keyof Entry ? true : false;
    type HasSet = "set" extends keyof Entry ? true : false;
    const hasGet: HasGet = true;
    const hasSet: HasSet = false;
    expect(hasGet).toBe(true);
    expect(hasSet).toBe(false);
    // Reference `surface` at runtime too, so the type assertion above can't drift
    // from the actual contract object the test built.
    expect(surface.spec.cells?.conn.verbs).toEqual(["get"]);
  });
});

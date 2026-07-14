/**
 * REGRESSION (SRT-PR2): `useEntry(...).procedures.<ns>.<verb>` must call a procedure
 * whose verb is literally named `use` — never intercept it as a reactive `.use()`
 * hook.
 *
 * The trap: `makeReactiveEntry`'s `primProxy` branches on `verb === "use"` at its
 * second proxy level to spot the reactive-hook verb. For cells/collections/streams/
 * events that level is a FIXED vocabulary (use/upsert/delete), so the check is safe.
 * But `procedures` rides the SAME `primProxy`, where the second level is a USER-NAMED
 * procedure verb — and `procedures: { <ns>: { use: {...} } }` is legally spellable
 * (ProcedureSpec inner keys are free-form; the wire path `surface.<ns>.use` collides
 * with nothing). Without the `prim !== "procedures"` gate, `useEntry(...).procedures
 * .<ns>.use(input)` would wrap the one-shot call in a keyed root instead of calling
 * it — a silent divergence from the pure `entry(key).procedures` path, which works.
 *
 * This pins BOTH paths (`entry` and `useEntry`) call the procedure and return its
 * `Promise<O>`.
 */

import { defineSurface } from "@kolu/surface/define";
import { directLink } from "@kolu/surface/links/direct";
import { implementSurface } from "@kolu/surface/server";
import type { AnyContractRouter } from "@orpc/contract";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { connectSurfaceMap } from "./client";
import { defineSurfaceMap } from "./define";
import {
  connected,
  HostKeySchema,
  identityCodec,
  makeRegistry,
  settle,
  testFailureSchema,
} from "./mapHarness.testlib";
import { serveSurfaceMap } from "./server";

// A surface whose one procedure verb is literally named `use`.
const licenseSurface = defineSurface({
  procedures: {
    license: {
      use: {
        input: z.object({ seat: z.string() }),
        output: z.object({ granted: z.boolean(), seat: z.string() }),
      },
    },
  },
});

function buildLicenseEntryLink() {
  const { router } = implementSurface(licenseSurface, {
    procedures: {
      license: {
        use: async ({ input }: { input: { seat: string } }) => ({
          granted: true,
          seat: input.seat,
        }),
      },
    },
  });
  return directLink<typeof licenseSurface.contract>(router as never);
}

/** The map + registry + wire link. The CLIENT is built INSIDE each test's
 *  `createRoot` (below), never here: `connectSurfaceMap` installs a
 *  membership-pruning `createEffect` at construction, so building it outside an
 *  owner would leak a never-disposed computation into later tests. */
function setup() {
  const map = defineSurfaceMap({
    key: HostKeySchema,
    entry: licenseSurface,
    codec: identityCodec,
    failure: testFailureSchema,
  });
  const reg = makeRegistry();
  const served = serveSurfaceMap(map, reg.registry);
  // biome-ignore lint/suspicious/noExplicitAny: served router is a runtime-valid oRPC router; the client re-types via map.entry.
  const mapLink = directLink<AnyContractRouter>(served.router as any);
  return { map, mapLink, reg };
}

const A = HostKeySchema.parse("a");

describe("procedure verb named `use` routes as an imperative call, not a reactive hook", () => {
  it("entry(key).procedures.<ns>.use(input) calls the procedure (pure lens)", async () => {
    const { map, mapLink, reg } = setup();
    reg.addSession(A, buildLicenseEntryLink(), connected(0));
    await settle();
    await createRoot(async (dispose) => {
      const client = connectSurfaceMap(map, mapLink);
      const result = await client
        .entry(A)
        .procedures.license.use({ seat: "s1" });
      expect(result).toEqual({ granted: true, seat: "s1" });
      dispose();
    });
  });

  it("useEntry(...).procedures.<ns>.use(input) calls the procedure too (the fix)", async () => {
    const { map, mapLink, reg } = setup();
    reg.addSession(A, buildLicenseEntryLink(), connected(0));
    await settle();
    await createRoot(async (dispose) => {
      const client = connectSurfaceMap(map, mapLink);
      const view = client.useEntry(() => A);
      // Before the fix this hit the `verb === "use"` reactive-hook branch and
      // returned a `reactiveDelegate` proxy wrapping a keyed root — NOT the
      // procedure's Promise. Assert the call returns a genuine Promise (the value
      // still resolves either way, because the delegate forwards `.then`, so the
      // return TYPE is what distinguishes the imperative call from the intercepted
      // reactive-hook wrap).
      const pending = view.procedures.license.use({ seat: "s2" });
      expect(pending).toBeInstanceOf(Promise);
      const result = await pending;
      expect(result).toEqual({ granted: true, seat: "s2" });
      dispose();
    });
  });
});

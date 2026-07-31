/**
 * SK3 red-first pin — `recycleKaval` refuses a contract skew TYPED, at the
 * knowing endpoint.
 *
 * The field failure (bug-remote-kaval-contract-skew, defect A): the endpoint's
 * recycle path rejects with a `DaemonContractSkewError` — well-typed, version-
 * bearing — and `recycleKaval`'s catch rethrows it PLAIN, so oRPC's
 * `toORPCError` collapses it to `INTERNAL_SERVER_ERROR` and the browser toast
 * reads "Internal server error". The handler is the one layer that KNOWS what
 * the error means (the `fileGoneAsNotFound` precedent, servePadi.ts), so the
 * skew must be rethrown as a typed `ORPCError("KAVAL_CONTRACT_SKEW")` carrying
 * both versions as DATA — never prose the client would have to re-parse.
 *
 * Red today: the rejection reaching the caller is the plain skew error, not
 * the typed ORPCError. A non-skew failure must keep rethrowing untouched (the
 * fail-fast channel stays loud).
 */

import { ORPCError } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDaemonProcessId } from "./koluRoot.ts";
import { restartLocalDaemon } from "./ptyHost/restartLocal.ts";
import { padiDeps } from "./servePadi.testlib.ts";

vi.mock("./ptyHost/restartLocal.ts", () => ({
  restartLocalDaemon: vi.fn(),
}));

// `cleanupTerminalScratch` (reached via other members' construction) reads the
// per-instance scratch root; boot injects the server id before any of this runs.
setDaemonProcessId("recyclekaval-test-server");

/** The recycle rejection as the endpoint really raises it: brand-checked
 *  (`isContractSkew === true` — realm-robust, never `instanceof`) and version-
 *  bearing. Built structurally so this pin exercises the brand path the
 *  handler's `isContractSkewError` guard reads. */
function contractSkewRejection(): Error {
  return Object.assign(
    new Error("pty-host contract skew: kaval speaks 5.0, server needs 5.2"),
    {
      isContractSkew: true as const,
      subject: "pty-host" as const,
      daemonVersion: "5.0",
      requiredVersion: "5.2",
    },
  );
}

/** The typed per-code constructor map oRPC hands a DECLARING procedure's
 *  handler (`opts.errors`, SK6) — mimicked here exactly as `implementSurface`
 *  delivers it (the oRPC `ORPCErrorConstructorMap` shape), since this unit
 *  drives the dep handler directly rather than through the contract router. */
const errorCtors = {
  KAVAL_CONTRACT_SKEW: (opts: { message?: string; data?: unknown }) =>
    new ORPCError("KAVAL_CONTRACT_SKEW", opts),
};

function recycleKavalHandler() {
  const deps = padiDeps({
    stateRoot: "/tmp/padi-recyclekaval-test-state-root",
  });
  const recycle = deps.procedures?.lifecycle?.recycleKaval as
    | ((opts: { errors: typeof errorCtors }) => Promise<void>)
    | undefined;
  if (!recycle) throw new Error("padi deps must serve lifecycle.recycleKaval");
  return recycle;
}

describe("recycleKaval on a contract skew — refuse typed, versions as data", () => {
  afterEach(() => vi.clearAllMocks());

  it("rethrows the skew as ORPCError KAVAL_CONTRACT_SKEW carrying both versions", async () => {
    vi.mocked(restartLocalDaemon).mockRejectedValue(contractSkewRejection());
    const recycle = recycleKavalHandler();

    const rejection = await recycle({ errors: errorCtors }).then(
      () => {
        throw new Error("recycleKaval resolved — expected a typed rejection");
      },
      (err: unknown) => err,
    );

    // The knowing endpoint translated the skew — never INTERNAL_SERVER_ERROR.
    expect(rejection).toBeInstanceOf(ORPCError);
    const orpc = rejection as ORPCError<string, unknown>;
    expect(orpc.code).toBe("KAVAL_CONTRACT_SKEW");
    expect(orpc.data).toEqual({
      daemonVersion: "5.0",
      requiredVersion: "5.2",
    });
  });

  it("rethrows a NON-skew recycle failure untouched (the loud channel stays loud)", async () => {
    const boom = new Error("kaval endpoint failed to come up");
    vi.mocked(restartLocalDaemon).mockRejectedValue(boom);
    const recycle = recycleKavalHandler();

    await expect(recycle({ errors: errorCtors })).rejects.toBe(boom);
  });
});

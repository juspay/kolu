/**
 * SK3 red-first pin — `recycleKaval` refuses a contract skew TYPED, at the
 * knowing endpoint.
 *
 * The field failure (bug-remote-kaval-contract-skew, defect A): the endpoint's
 * recycle path rejects with a `DaemonContractSkewError` — well-typed, version-
 * bearing — and `recycleKaval`'s catch rethrows it PLAIN, so the framing layer
 * collapses it to an opaque internal failure and the browser toast reads
 * "Internal server error". The handler is the one layer that KNOWS what the
 * error means (the same precedent as `unwrapGit`'s `FILE_GONE` → `FileGone`
 * mapping, kolu-git/errors.ts), so the skew must be raised as the DECLARED
 * `KavalContractSkew` tagged error carrying both versions as DATA — never prose
 * the client would have to re-parse.
 *
 * The discriminant moved with PLAN D4: the wire code `KAVAL_CONTRACT_SKEW`
 * became the `_tag` `"KavalContractSkew"`, and the payload rides the error
 * INSTANCE's own fields instead of an `ORPCError.data` bag. A non-skew failure
 * must still reach the caller untouched (the fail-fast channel stays loud) —
 * and, being UNDECLARED, it arrives as a DEFECT rather than a typed failure.
 */

import { KavalContractSkew } from "@kolu/padi-client/surface";
import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDaemonProcessId } from "./koluRoot.ts";
import { recycleLocalKaval } from "./ptyHost/restartLocal.ts";
import { fakeEndpoint, stubLog } from "./servePadi.testlib.ts";
import { buildPadiSurfaceDeps } from "./servePadi.ts";

// The RPC delegates the recycle itself to the SHARED routine (#2101 N1) — the
// same one the supervisor invokes — so THAT is what is stubbed here. What is
// left under test is the only part still owned by the handler: retyping a
// contract skew as the declared wire error.
vi.mock("./ptyHost/restartLocal.ts", () => ({
  recycleLocalKaval: vi.fn(),
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

function recycleKavalHandler() {
  const deps = buildPadiSurfaceDeps({
    endpoint: fakeEndpoint,
    log: stubLog,
    startedAt: 0,
    commit: "",
    lifetime: { kind: "forever" },
    stateRoot: "/tmp/padi-recyclekaval-test-state-root",
  });
  const recycle = deps.procedures?.lifecycle?.recycleKaval as
    | ((opts: { input: undefined }) => Effect.Effect<void, unknown>)
    | undefined;
  if (!recycle) throw new Error("padi deps must serve lifecycle.recycleKaval");
  return recycle;
}

/** The value the handler's Effect ended on — its DECLARED failure, or the defect
 *  an undeclared throw becomes. `Cause.squash` hands back the original value in
 *  both cases, which is exactly what these two pins compare. */
async function endedWith(
  effect: Effect.Effect<void, unknown>,
): Promise<unknown> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    throw new Error("recycleKaval succeeded — expected a typed refusal");
  }
  return Cause.squash(exit.cause);
}

describe("recycleKaval on a contract skew — refuse typed, versions as data", () => {
  afterEach(() => vi.clearAllMocks());

  it("rethrows the skew as the DECLARED KavalContractSkew carrying both versions", async () => {
    vi.mocked(recycleLocalKaval).mockReturnValue(
      Effect.fail(contractSkewRejection()),
    );
    const recycle = recycleKavalHandler();

    const refusal = await endedWith(recycle({ input: undefined }));

    // The knowing endpoint translated the skew — never an opaque internal fault.
    expect(refusal).toBeInstanceOf(KavalContractSkew);
    const skew = refusal as KavalContractSkew;
    expect(skew._tag).toBe("KavalContractSkew");
    expect({
      daemonVersion: skew.daemonVersion,
      requiredVersion: skew.requiredVersion,
    }).toEqual({ daemonVersion: "5.0", requiredVersion: "5.2" });
  });

  it("rethrows a NON-skew recycle failure untouched (the loud channel stays loud)", async () => {
    const boom = new Error("kaval endpoint failed to come up");
    vi.mocked(recycleLocalKaval).mockReturnValue(Effect.fail(boom));
    const recycle = recycleKavalHandler();

    // UNDECLARED ⇒ a DEFECT (D4), and the value reaches the caller untouched.
    await expect(endedWith(recycle({ input: undefined }))).resolves.toBe(boom);
  });
});

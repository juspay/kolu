import { KavalContractSkew } from "@kolu/padi-client/surface";
import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDaemonProcessId } from "./koluRoot.ts";
import { recycleLocalKaval } from "./ptyHost/restartLocal.ts";
import { fakeEndpoint, stubLog, testDiagnostics } from "./servePadi.testlib.ts";
import { buildPadiSurfaceDeps } from "./servePadi.ts";

vi.mock("./ptyHost/restartLocal.ts", () => ({
  recycleLocalKaval: vi.fn(),
}));

setDaemonProcessId("recyclekaval-test-server");

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
    diagnostics: testDiagnostics,
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

    await expect(endedWith(recycle({ input: undefined }))).resolves.toBe(boom);
  });
});

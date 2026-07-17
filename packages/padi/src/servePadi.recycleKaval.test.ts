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
import type { Logger } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalEndpoint } from "./endpoint.ts";
import { setDaemonProcessId } from "./koluRoot.ts";
import { restartLocalDaemon } from "./ptyHost/restartLocal.ts";
import { buildPadiSurfaceDeps } from "./servePadi.ts";

vi.mock("./ptyHost/restartLocal.ts", () => ({
  restartLocalDaemon: vi.fn(),
}));

// `cleanupTerminalScratch` (reached via other members' construction) reads the
// per-instance scratch root; boot injects the server id before any of this runs.
setDaemonProcessId("recyclekaval-test-server");

const stubLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => stubLog,
} as unknown as Logger;

const fakeEndpoint = {
  fs: {
    listAll: async () => [],
    readFile: async () => ({ content: "", truncated: false }),
    filePreviewTag: async () => "tag",
    subscribeRepoChange: () => () => {},
    subscribeFileChange: () => () => {},
  },
  git: {
    getStatus: async () => ({}),
    getDiff: async () => ({}),
  },
} as unknown as TerminalEndpoint;

/** The recycle rejection as the endpoint really raises it: brand-checked
 *  (`isContractSkew === true` — realm-robust, never `instanceof`) and version-
 *  bearing. Built structurally so this pin exercises the brand path the
 *  handler's `isContractSkewError` guard reads. */
function contractSkewRejection(): Error {
  return Object.assign(
    new Error("pty-host contract skew: kaval speaks 5.0, server needs 5.2"),
    {
      isContractSkew: true as const,
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
    | ((opts: Record<string, never>) => Promise<void>)
    | undefined;
  if (!recycle) throw new Error("padi deps must serve lifecycle.recycleKaval");
  return recycle;
}

describe("recycleKaval on a contract skew — refuse typed, versions as data", () => {
  afterEach(() => vi.clearAllMocks());

  it("rethrows the skew as ORPCError KAVAL_CONTRACT_SKEW carrying both versions", async () => {
    vi.mocked(restartLocalDaemon).mockRejectedValue(contractSkewRejection());
    const recycle = recycleKavalHandler();

    const rejection = await recycle({}).then(
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

    await expect(recycle({})).rejects.toBe(boom);
  });
});

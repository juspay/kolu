/**
 * The baked Kolu source ref is validated LAZILY inside the resolver thunk (F6).
 * A missing value means kolu-server was NOT run from its
 * Nix wrapper, so a remote padi binding is impossible — but that is THIS entry's TERMINAL
 * fault, NOT a boot-brick: `ensureRemotePadiBinding` returns a session that warms, and the
 * source-ref throw surfaces on the FIRST dial, re-raised as a TERMINAL `ResolveDrvError` (so
 * the entry settles `failed(reason)` and the chip reads it, while the server + the healthy
 * local default keep serving). These arms prove: (1) the SEED call NEVER throws — boot
 * survives a bad/absent source ref — and (2) the resolver thunk rejects with the exact reason.
 * This is the seed invariant Group-1a's boot-brick class died for, held at the seed path.
 *
 * The ssh machinery (`sshConnector` + `makeSession`) and derivation resolver are
 * mocked so no arm touches real ssh/nix; the resolver thunk `sshConnector` receives is
 * captured + invoked to observe the lazy fault (or the resolved drv).
 */

import {
  ResolveDrvError,
  type ResolveDrvPathContext,
  SURFACE_AGENT_FLAKE_REF_ENV,
} from "@kolu/surface-remote";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sshConnector: vi.fn(),
  makeSession: vi.fn(),
  resolveAgentDrv: vi.fn(),
}));

// Partial mock — override ONLY the ssh seam (the connector + the session appliance +
// the drv resolver), keep every other real export (`ResolveDrvError` etc.) so nothing in
// the binder's import graph breaks on load.
vi.mock("@kolu/surface-remote", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kolu/surface-remote")>();
  return {
    ...actual,
    sshConnector: h.sshConnector,
    makeSession: h.makeSession,
    resolveAgentDrv: h.resolveAgentDrv,
  };
});

import { ensureRemotePadiBinding } from "./remotePadiBinding.ts";

const ENV = SURFACE_AGENT_FLAKE_REF_ENV;

/** A minimal `Session` stand-in — the arm calls `onState` (snapshot-then-delta) at
 *  construction and spreads the rest through `asPadiSession`. Seed `onState` with a
 *  benign "connecting" frame; stub the remaining role methods as no-ops. */
function fakeSession() {
  return {
    onState: (cb: (s: unknown) => void) => {
      cb({
        phase: "connecting",
        log: [],
      });
      return () => {};
    },
    currentClient: () => null,
    pin: () => Promise.resolve({}),
    markConnected: () => {},
    reconnect: () => {},
    recheck: () => {},
    identity: () => ({ kind: "disconnected" }) as const,
    isDestroyed: () => false,
    destroy: () => {},
  };
}

/** Seed a remote binding and hand back the resolver thunk `sshConnector` was given (the
 *  lazy source-ref validation lives INSIDE it). The SEED call must NOT throw — the whole point of
 *  F6 is that a bad/absent source never bricks boot; it faults only THIS entry, on dial. */
const resolverContext: ResolveDrvPathContext = {
  signal: new AbortController().signal,
  localProgress: vi.fn(),
};

function seedAndCaptureResolver(): (
  ctx: ResolveDrvPathContext,
) => Promise<string> {
  let captured: ((ctx: ResolveDrvPathContext) => Promise<string>) | undefined;
  h.sshConnector.mockImplementation(
    (opts: {
      resolveDrvPath: (ctx: ResolveDrvPathContext) => Promise<string>;
    }) => {
      captured = opts.resolveDrvPath;
      // The connector is never invoked (makeSession is mocked); return a dummy.
      return async () => {
        throw new Error("mock connector should not run");
      };
    },
  );
  const binding = ensureRemotePadiBinding({ host: "nix@prod" });
  expect(binding).toBeDefined(); // ← boot survives: the seed call did not throw (F6)
  expect(h.sshConnector).toHaveBeenCalledTimes(1);
  binding.destroy();
  if (captured === undefined)
    throw new Error("resolver thunk was not captured");
  return captured;
}

describe("padi source-flake resolution — LAZY entry-scope fault (F6)", () => {
  // Save/restore the baked env around EACH test so no case leaks (the parser reads
  // process.env at RESOLVE time now, not construction).
  let prior: string | undefined;
  beforeEach(() => {
    prior = process.env[ENV];
    h.sshConnector.mockReset();
    h.makeSession.mockReset();
    h.resolveAgentDrv.mockReset();
    h.makeSession.mockReturnValue(fakeSession());
    h.resolveAgentDrv.mockResolvedValue("/nix/store/aaa-padi.drv");
  });
  afterEach(() => {
    if (prior === undefined) delete process.env[ENV];
    else process.env[ENV] = prior;
  });

  it("(a) UNSET → seed does NOT throw; resolver rejects TERMINAL with the not-baked reason", async () => {
    delete process.env[ENV];
    const resolve = seedAndCaptureResolver();
    await expect(resolve(resolverContext)).rejects.toThrow(
      /SURFACE_AGENT_FLAKE_REF is not set/,
    );
    // Terminal, not a retry: a missing baked source can't self-heal, so the entry settles failed.
    await expect(resolve(resolverContext)).rejects.toBeInstanceOf(
      ResolveDrvError,
    );
  });

  it("(a') a whitespace-only ref → resolver rejects (same not-baked arm)", async () => {
    process.env[ENV] = "  ";
    const resolve = seedAndCaptureResolver();
    await expect(resolve(resolverContext)).rejects.toThrow(/is not set/);
  });

  it("(b) a baked source ref resolves padi for the remote host", async () => {
    process.env[ENV] = "/nix/store/kolu-source";
    h.resolveAgentDrv.mockResolvedValue("/nix/store/bbb-padi.drv");
    const resolve = seedAndCaptureResolver();
    expect(await resolve(resolverContext)).toBe("/nix/store/bbb-padi.drv");
    expect(h.resolveAgentDrv).toHaveBeenCalledWith(
      "nix@prod",
      "/nix/store/kolu-source",
      "padi",
      {
        signal: resolverContext.signal,
        onProgress: resolverContext.localProgress,
      },
    );
  });

  it("(c) a source that cannot resolve padi becomes a terminal build fault", async () => {
    process.env[ENV] = "/nix/store/kolu-source";
    h.resolveAgentDrv.mockRejectedValue(
      new ResolveDrvError("no padi for aarch64-linux", "remote"),
    );
    const resolve = seedAndCaptureResolver();
    await expect(resolve(resolverContext)).rejects.toThrow(
      /no padi for aarch64-linux/,
    );
    await expect(resolve(resolverContext)).rejects.toBeInstanceOf(
      ResolveDrvError,
    );
  });

  it("(d) an unreachable host remains a retryable transport failure", async () => {
    process.env[ENV] = "/nix/store/kolu-source";
    h.resolveAgentDrv.mockRejectedValue(new Error("ssh timed out"));
    const resolve = seedAndCaptureResolver();
    await expect(resolve(resolverContext)).rejects.toThrow(/ssh timed out/);
    await expect(resolve(resolverContext)).rejects.not.toBeInstanceOf(
      ResolveDrvError,
    );
  });
});

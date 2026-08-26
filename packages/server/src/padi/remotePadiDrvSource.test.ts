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

import { PADI_REMOTE_DIAL } from "@kolu/padi/remote-dial";
import type { padiSurface } from "@kolu/padi-client/surface";
import {
  AgentBinaryCacheUnbakedError,
  AgentSourceUnbakedError,
  ResolveDrvError,
  type ResolveDrvPathContext,
  type SshConnectorOptions,
} from "@kolu/surface-remote";

/** `SshConnectorOptions` is generic over the dialed surface's spec now (the
 *  connector needs the surface as a VALUE to build its link and face). Only the
 *  `resolveDrvPath` field matters here, and it does not vary with the spec — so
 *  the alias is pinned once, at padi's spec, rather than at every reference. */
type PadiSshConnectorOptions = SshConnectorOptions<typeof padiSurface.spec>;

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sshConnector: vi.fn(),
  makeSession: vi.fn(),
  resolveBakedAgentDrv: vi.fn(),
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
    resolveBakedAgentDrv: h.resolveBakedAgentDrv,
  };
});

import { ensureRemotePadiBinding } from "./remotePadiBinding.ts";

/** The `onState` callbacks the arm registered, so a test can push a later frame
 *  (a terminal give-up) at the binder the way the real session would. */
const stateHooks: ((s: unknown) => void)[] = [];

/** Push a state frame at every live binder — the fake transport's stand-in for
 *  the session loop reporting a phase change. */
function pushState(state: unknown): void {
  for (const cb of stateHooks) cb(state);
}

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
      stateHooks.push(cb);
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
  resolveAgentDrv: vi.fn(),
};

/** Seed a binding and keep it LIVE, handing back both the captured resolver thunk
 *  and the session — so an arm can fault the resolver and then read the domain
 *  cause the binder publishes (`entryFailedDetail`). */
function seedLiveBinding(): {
  binding: ReturnType<typeof ensureRemotePadiBinding>;
  resolve: PadiSshConnectorOptions["resolveDrvPath"];
} {
  let captured: PadiSshConnectorOptions["resolveDrvPath"] | undefined;
  h.sshConnector.mockImplementation(
    (opts: { resolveDrvPath: PadiSshConnectorOptions["resolveDrvPath"] }) => {
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
  if (captured === undefined)
    throw new Error("resolver thunk was not captured");
  return { binding, resolve: captured };
}

function seedAndCaptureResolver(): PadiSshConnectorOptions["resolveDrvPath"] {
  const { binding, resolve } = seedLiveBinding();
  binding.destroy();
  return resolve;
}

describe("padi source-flake resolution — LAZY entry-scope fault (F6)", () => {
  beforeEach(() => {
    stateHooks.length = 0;
    h.sshConnector.mockReset();
    h.makeSession.mockReset();
    h.resolveBakedAgentDrv.mockReset();
    h.makeSession.mockReturnValue(fakeSession());
    h.resolveBakedAgentDrv.mockResolvedValue({
      kind: "flake-installable",
      drvPath: "/nix/store/aaa-padi.drv",
      installable: "/nix/store/source#packages.x86_64-linux.padi",
    });
  });

  it("(a) UNSET → seed does NOT throw; resolver rejects TERMINAL with the not-baked reason", async () => {
    h.resolveBakedAgentDrv.mockRejectedValue(new AgentSourceUnbakedError());
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
    h.resolveBakedAgentDrv.mockRejectedValue(new AgentSourceUnbakedError());
    const resolve = seedAndCaptureResolver();
    await expect(resolve(resolverContext)).rejects.toThrow(/is not set/);
  });

  it("(a'') a BAKED ref whose source has no binary-cache declaration gets its OWN cause", async () => {
    // Distinct from (a) on purpose: the ref IS baked here, so the host-down
    // card must not tell the operator to launch through the Nix wrapper. A
    // shared cause would render exactly that false remedy.
    h.resolveBakedAgentDrv.mockRejectedValue(
      new AgentBinaryCacheUnbakedError("/nix/store/pre-contract", "ENOENT"),
    );
    const { binding, resolve } = seedLiveBinding();
    await expect(resolve(resolverContext)).rejects.toMatchObject({
      resolution: {
        kind: "binary-cache-unbaked",
        failureCause: "remote",
        terminal: false,
      },
    });
    expect(binding.entryFailedDetail()).toEqual({
      cause: "agent-cache-unbaked",
    });
    // The binder appends its own unset-host hint, as it does for (a).
    await expect(resolve(resolverContext)).rejects.toThrow(
      /unset KOLU_PADI_HOST/,
    );
    binding.destroy();
  });

  it("(b) a baked source ref resolves padi for the remote host", async () => {
    h.resolveBakedAgentDrv.mockResolvedValue({
      kind: "flake-installable",
      drvPath: "/nix/store/bbb-padi.drv",
      installable: "/nix/store/source#packages.x86_64-linux.padi",
    });
    const resolve = seedAndCaptureResolver();
    expect(await resolve(resolverContext)).toEqual({
      kind: "flake-installable",
      drvPath: "/nix/store/bbb-padi.drv",
      installable: "/nix/store/source#packages.x86_64-linux.padi",
    });
    // `.package` (`padi-agent`), NOT `.binary` (`padi`) — the attr names the
    // CLOSURE shipped to the host (daemon + the client CLIs a terminal there
    // needs); the binary names what runs inside it. Asserted against the shared
    // constant, not a literal: the two dial paths are held equal by ONE value,
    // so this test goes red if either path is repointed rather than only if
    // someone remembers to edit the literal here too.
    expect(h.resolveBakedAgentDrv).toHaveBeenCalledWith(
      PADI_REMOTE_DIAL.package,
      resolverContext,
    );
    expect(PADI_REMOTE_DIAL.package).not.toBe(PADI_REMOTE_DIAL.binary);
  });

  it("(c) a source that cannot resolve padi becomes a terminal build fault", async () => {
    h.resolveBakedAgentDrv.mockRejectedValue(
      new ResolveDrvError("no padi for aarch64-linux", {
        kind: "unavailable",
        failureCause: "remote",
        terminal: false,
      }),
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
    h.resolveBakedAgentDrv.mockRejectedValue(new Error("ssh timed out"));
    const resolve = seedAndCaptureResolver();
    await expect(resolve(resolverContext)).rejects.toThrow(/ssh timed out/);
    await expect(resolve(resolverContext)).rejects.not.toBeInstanceOf(
      ResolveDrvError,
    );
  });

  /** An ssh gate kolu can never pass non-interactively (a credential, a host-key
   *  trust decision) arrives from the framework already TERMINAL; the binder's job
   *  is to name it in padi's own vocabulary so the host-down card can state the
   *  operator's actual remedy. */
  describe.each([
    {
      what: "a credential refusal",
      kind: "auth-refused" as const,
      message: "petit: ssh refused our credentials",
      cause: "auth-required",
    },
    {
      what: "an unverified host key",
      kind: "host-key-unverified" as const,
      message: "petit: ssh does not trust this host's identity key",
      cause: "host-key-unverified",
    },
    {
      what: "a host with no runnable Nix",
      kind: "nix-unavailable" as const,
      message: "petit: could not run `nix-instantiate`",
      cause: "nix-unavailable",
    },
  ])("(f) $what", ({ kind, message, cause }) => {
    const refusal = () =>
      new ResolveDrvError(message, {
        kind,
        failureCause: "remote",
        terminal: true,
      });

    it("keeps the framework's terminal verdict and names padi's domain cause", async () => {
      h.resolveBakedAgentDrv.mockRejectedValue(refusal());
      const { binding, resolve } = seedLiveBinding();
      await expect(resolve(resolverContext)).rejects.toMatchObject({
        // The binder ENRICHES; it never reclassifies retry policy. A refusal
        // that came back retryable would resume the eternal reconnect this
        // whole path exists to end.
        resolution: { kind, failureCause: "remote", terminal: true },
      });
      expect(binding.entryFailedDetail()).toEqual({ cause });
      binding.destroy();
    });

    it("outranks the generic link-failed banner a terminal give-up raises", async () => {
      // The session's terminal give-up sets `convergence = link-failed`, whose
      // card says only "can't reach this host". The dial's own finding is the
      // finer, actionable truth, so it must win — otherwise the remedy the
      // operator needs is masked by a reachability message.
      h.resolveBakedAgentDrv.mockRejectedValue(refusal());
      const { binding, resolve } = seedLiveBinding();
      await expect(resolve(resolverContext)).rejects.toBeInstanceOf(
        ResolveDrvError,
      );
      pushState({ phase: "failed", error: message, log: [] });
      expect(binding.entryFailedDetail()).toEqual({ cause });
      binding.destroy();
    });

    it("clears on a dial that resolves — never a stale cause outliving recovery", async () => {
      h.resolveBakedAgentDrv.mockRejectedValueOnce(refusal());
      const { binding, resolve } = seedLiveBinding();
      await expect(resolve(resolverContext)).rejects.toBeInstanceOf(
        ResolveDrvError,
      );
      expect(binding.entryFailedDetail()).toEqual({ cause });
      // The operator fixed it: the next dial's resolution succeeds.
      await expect(resolve(resolverContext)).resolves.toBeDefined();
      expect(binding.entryFailedDetail()).toBeNull();
      binding.destroy();
    });
  });

  it("(e) preserves a connector-owned exhausted network verdict", async () => {
    const exhausted = new ResolveDrvError(
      "silent evaluation budget exhausted",
      {
        kind: "network-exhausted",
        failureCause: "network",
        terminal: true,
      },
    );
    h.resolveBakedAgentDrv.mockRejectedValue(exhausted);
    const resolve = seedAndCaptureResolver();

    await expect(resolve(resolverContext)).rejects.toBe(exhausted);
    await expect(resolve(resolverContext)).rejects.toMatchObject({
      resolution: {
        kind: "network-exhausted",
        failureCause: "network",
        terminal: true,
      },
    });
  });
});

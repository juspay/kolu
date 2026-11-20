import { PADI_REMOTE_DIAL } from "@kolu/padi/remote-dial";
import type { padiSurface } from "@kolu/padi-client/surface";
import {
  AgentBinaryCacheUnbakedError,
  AgentSourceUnbakedError,
  DEFAULT_SSH_KEEPALIVE,
  ResolveDrvError,
  type ResolveDrvPathContext,
  type SshConnectorOptions,
} from "@kolu/surface-remote";

type PadiSshConnectorOptions = SshConnectorOptions<typeof padiSurface.spec>;

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sshConnector: vi.fn(),
  makeSession: vi.fn(),
  resolveBakedAgentDrv: vi.fn(),
}));

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

const stateHooks: ((s: unknown) => void)[] = [];

function pushState(state: unknown): void {
  for (const cb of stateHooks) cb(state);
}

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

const resolverContext: ResolveDrvPathContext = {
  signal: new AbortController().signal,
  localProgress: vi.fn(),
  onProgress: vi.fn(),
  resolveAgentDrv: vi.fn(),
  resolveSystem: vi.fn(),
  keepalive: DEFAULT_SSH_KEEPALIVE,
};

function seedLiveBinding(): {
  binding: ReturnType<typeof ensureRemotePadiBinding>;
  resolve: PadiSshConnectorOptions["resolveDrvPath"];
} {
  let captured: PadiSshConnectorOptions["resolveDrvPath"] | undefined;
  h.sshConnector.mockImplementation(
    (opts: { resolveDrvPath: PadiSshConnectorOptions["resolveDrvPath"] }) => {
      captured = opts.resolveDrvPath;
      return async () => {
        throw new Error("mock connector should not run");
      };
    },
  );
  const binding = ensureRemotePadiBinding({ host: "nix@prod" });
  expect(binding).toBeDefined();
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
        resolution: { kind, failureCause: "remote", terminal: true },
      });
      expect(binding.entryFailedDetail()).toEqual({ cause });
      binding.destroy();
    });

    it("outranks the generic link-failed banner a terminal give-up raises", async () => {
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

/**
 * Endpoint registry dispatch (hermetic — heavy deps mocked, no ssh).
 *
 * `endpointFor` is the single seam P3 re-introduced. The contract: local/absent
 * hostId is byte-identical to the pre-P3 direct reference; a configured remote
 * builds + caches ONE endpoint per host; an unknown host throws. The local
 * endpoint, the remote endpoint class, the host config, and LOCAL_HOST_ID are
 * all mocked so this exercises ONLY the dispatch logic — constructing a real
 * remote endpoint would dial ssh.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` so the values exist before the hoisted `vi.mock` factories run.
const { localSentinel, hostConfigFor } = vi.hoisted(() => ({
  localSentinel: { __local: true },
  hostConfigFor: vi.fn(),
}));

vi.mock("./local.ts", () => ({ localTerminalEndpoint: localSentinel }));
vi.mock("../ptyHost/index.ts", () => ({ LOCAL_HOST_ID: "local" }));
vi.mock("../hosts/registry.ts", () => ({ hostConfigFor }));
vi.mock("./remote.ts", () => ({
  // A stand-in that records its options instead of dialing ssh.
  RemoteTerminalEndpoint: class {
    constructor(public readonly opts: unknown) {}
  },
}));

import { allEndpoints, endpointFor } from "./registry.ts";

afterEach(() => vi.clearAllMocks());

describe("endpointFor", () => {
  it("returns the local endpoint for undefined / 'local' (byte-identical to pre-P3)", () => {
    expect(endpointFor()).toBe(localSentinel);
    expect(endpointFor("local")).toBe(localSentinel);
    expect(hostConfigFor).not.toHaveBeenCalled();
  });

  it("builds and CACHES one remote endpoint per configured host", () => {
    hostConfigFor.mockReturnValue({
      host: "nix@prod",
      resolveDrvPath: async () => "/drv",
    });
    const first = endpointFor("prod");
    const second = endpointFor("prod");
    expect(first).toBe(second); // cached — one ssh session per host
    expect((first as unknown as { opts: { hostId: string } }).opts.hostId).toBe(
      "prod",
    );
    // Built once despite two resolutions.
    expect(hostConfigFor).toHaveBeenCalledTimes(1);
  });

  it("throws NOT_FOUND for an unconfigured host", () => {
    hostConfigFor.mockReturnValue(undefined);
    expect(() => endpointFor("ghost")).toThrow(/no host configured/);
  });

  it("includes the local endpoint plus every dialed remote in allEndpoints()", () => {
    hostConfigFor.mockReturnValue({
      host: "nix@h",
      resolveDrvPath: async () => "/drv",
    });
    const remote = endpointFor("h2");
    const all = allEndpoints();
    expect(all).toContain(localSentinel);
    expect(all).toContain(remote);
  });
});

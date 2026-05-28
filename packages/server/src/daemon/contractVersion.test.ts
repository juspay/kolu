/**
 * Unit coverage for the agent wire-contract compatibility check. The
 * function lives in `kolu-common/agentSurface` (it's part of the
 * contract), but `kolu-common` has no test runner, so its behavior is
 * pinned here in the server package — the supervisor is its consumer.
 */
import { describe, expect, it } from "vitest";
import { isAgentContractCompatible } from "kolu-common/agentSurface";

describe("isAgentContractCompatible", () => {
  it("exact match is compatible", () => {
    expect(isAgentContractCompatible("1.0", "1.0")).toBe(true);
  });

  it("daemon minor ahead of expected is compatible (additive bump)", () => {
    expect(isAgentContractCompatible("1.3", "1.0")).toBe(true);
  });

  it("daemon minor behind expected is incompatible", () => {
    // kolu-server was built expecting a feature the older daemon lacks.
    expect(isAgentContractCompatible("1.0", "1.3")).toBe(false);
  });

  it("major mismatch is incompatible in both directions", () => {
    expect(isAgentContractCompatible("2.0", "1.0")).toBe(false);
    expect(isAgentContractCompatible("1.0", "2.0")).toBe(false);
  });

  it("tolerates a trailing patch/prerelease suffix (major.minor is load-bearing)", () => {
    expect(isAgentContractCompatible("1.0.4", "1.0")).toBe(true);
    expect(isAgentContractCompatible("1.2-alpha", "1.0")).toBe(true);
  });

  it("unparseable versions are incompatible (fail closed)", () => {
    expect(isAgentContractCompatible("", "1.0")).toBe(false);
    expect(isAgentContractCompatible("garbage", "1.0")).toBe(false);
  });
});

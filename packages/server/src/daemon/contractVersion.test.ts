import { describe, expect, it } from "vitest";
import {
  isPtyHostContractCompatible,
  PTY_HOST_CONTRACT_VERSION,
} from "kolu-common/ptyHostSurface";

describe("isPtyHostContractCompatible", () => {
  it("exact match is compatible", () => {
    expect(isPtyHostContractCompatible("2.0", "2.0")).toBe(true);
  });

  it("daemon minor ahead of server is compatible (additive bump)", () => {
    expect(isPtyHostContractCompatible("2.3", "2.0")).toBe(true);
  });

  it("daemon minor behind server is incompatible", () => {
    expect(isPtyHostContractCompatible("2.0", "2.1")).toBe(false);
  });

  it("major mismatch is incompatible in both directions", () => {
    expect(isPtyHostContractCompatible("1.0", "2.0")).toBe(false);
    expect(isPtyHostContractCompatible("3.0", "2.0")).toBe(false);
  });

  it("the dropped #1031 daemon (1.0) is incompatible with the redo (2.0)", () => {
    // The migration cutover: a surviving #1031 daemon served a "1.0" agent
    // surface; the redo bumped to 2.0 so the first deploy force-restarts it.
    expect(isPtyHostContractCompatible("1.0", PTY_HOST_CONTRACT_VERSION)).toBe(
      false,
    );
  });

  it("tolerates a trailing patch/prerelease suffix (only major.minor counts)", () => {
    expect(isPtyHostContractCompatible("2.0.7", "2.0")).toBe(true);
    expect(isPtyHostContractCompatible("2.1-rc1", "2.0")).toBe(true);
  });

  it("unparseable versions fail closed", () => {
    expect(isPtyHostContractCompatible("", "2.0")).toBe(false);
    expect(isPtyHostContractCompatible("garbage", "2.0")).toBe(false);
  });
});

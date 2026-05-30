import { describe, expect, it } from "vitest";
import {
  isPtyHostContractCompatible,
  PTY_HOST_CONTRACT_VERSION,
} from "./ptyHostSurface.ts";

describe("isPtyHostContractCompatible", () => {
  it("an exact match is compatible", () => {
    expect(isPtyHostContractCompatible("2.0", "2.0")).toBe(true);
  });

  it("a higher reported minor is compatible (additive bumps stay back-compat)", () => {
    expect(isPtyHostContractCompatible("2.3", "2.0")).toBe(true);
  });

  it("a lower reported minor is incompatible (consumer expects a newer field)", () => {
    expect(isPtyHostContractCompatible("2.0", "2.3")).toBe(false);
  });

  it("a major mismatch is incompatible in either direction", () => {
    expect(isPtyHostContractCompatible("3.0", "2.0")).toBe(false);
    expect(isPtyHostContractCompatible("1.9", "2.0")).toBe(false);
  });

  it("tolerates a trailing patch / prerelease suffix (only major.minor matters)", () => {
    expect(isPtyHostContractCompatible("2.0.1", "2.0")).toBe(true);
    expect(isPtyHostContractCompatible("2.0.0-rc1", "2.0")).toBe(true);
  });

  it("unparseable versions are incompatible", () => {
    expect(isPtyHostContractCompatible("", "2.0")).toBe(false);
    expect(isPtyHostContractCompatible("abc", "2.0")).toBe(false);
    expect(isPtyHostContractCompatible("2.0", "nope")).toBe(false);
  });

  it("the shipped contract version is self-compatible", () => {
    expect(
      isPtyHostContractCompatible(
        PTY_HOST_CONTRACT_VERSION,
        PTY_HOST_CONTRACT_VERSION,
      ),
    ).toBe(true);
  });
});

import { isContractVersionCompatible } from "@kolu/surface/define";
import { describe, expect, it } from "vitest";
import { PTY_HOST_CONTRACT_VERSION } from "./ptyHostSurface.ts";

describe("PTY_HOST_CONTRACT_VERSION", () => {
  it("removing system.processMemory is the 6.0 breaking wire", () => {
    expect(PTY_HOST_CONTRACT_VERSION).toBe("6.0");
    expect(isContractVersionCompatible("5.3", PTY_HOST_CONTRACT_VERSION)).toBe(
      false,
    );
    expect(isContractVersionCompatible(PTY_HOST_CONTRACT_VERSION, "5.3")).toBe(
      false,
    );
  });

  it("the shipped contract version is self-compatible", () => {
    expect(
      isContractVersionCompatible(
        PTY_HOST_CONTRACT_VERSION,
        PTY_HOST_CONTRACT_VERSION,
      ),
    ).toBe(true);
  });
});

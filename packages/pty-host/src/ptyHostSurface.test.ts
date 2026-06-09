import { isContractVersionCompatible } from "@kolu/surface/define";
import { describe, expect, it } from "vitest";
import { PTY_HOST_CONTRACT_VERSION } from "./ptyHostSurface.ts";

describe("PTY_HOST_CONTRACT_VERSION", () => {
  it("the shipped contract version is self-compatible", () => {
    expect(
      isContractVersionCompatible(
        PTY_HOST_CONTRACT_VERSION,
        PTY_HOST_CONTRACT_VERSION,
      ),
    ).toBe(true);
  });
});

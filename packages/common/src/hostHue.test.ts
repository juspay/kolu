import { describe, expect, it } from "vitest";
import { HOST_HUE_PALETTE, hostHueFor } from "./hostHue";

describe("hostHueFor", () => {
  it("pins the deterministic FNV-1a palette mapping for known seeds", () => {
    // These are the CONTRACT: the server's PWA theme-color and the client's
    // host tabs both read this function, so a drift here recolours real hosts.
    expect(hostHueFor("atlas")).toBe("#0f766e");
    expect(hostHueFor("boreal")).toBe("#7c3aed");
    expect(hostHueFor("deneb")).toBe("#047857");
    expect(hostHueFor("local")).toBe(hostHueFor("local"));
  });

  it("is case-insensitive on the seed", () => {
    expect(hostHueFor("Atlas")).toBe(hostHueFor("atlas"));
    expect(hostHueFor("ZEST")).toBe(hostHueFor("zest"));
  });

  it("always returns a palette member", () => {
    for (const seed of ["a", "atlas", "boreal", "cygnus", "x@y", "local"]) {
      expect(HOST_HUE_PALETTE).toContain(hostHueFor(seed));
    }
  });
});

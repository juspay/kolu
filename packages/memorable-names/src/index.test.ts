import { describe, expect, it } from "vitest";
import { randomName } from "./index";

describe("randomName", () => {
  it("returns ADJ-NOUN format", () => {
    const name = randomName();
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("returns different names on subsequent calls", () => {
    const names = new Set(Array.from({ length: 20 }, () => randomName()));
    expect(names.size).toBeGreaterThan(1);
  });
});

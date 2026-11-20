import { describe, expect, it } from "vitest";
import { parseReaderHash, readerHash } from "./useReader";

describe("the reader's route", () => {
  it("carries a work and a path through, whatever is in them", () => {
    for (const target of [
      { work: "w-1", path: ".waterfall/plan.md" },
      { work: "work/with/slashes", path: "a b/c?d#e.md" },
      { work: "w-2", path: "docs/plan with spaces.md" },
    ]) {
      expect(parseReaderHash(readerHash(target))).toEqual(target);
    }
  });

  it("reads the route with or without its leading hash", () => {
    const want = { work: "w", path: ".waterfall/plan.md" };
    expect(parseReaderHash("/reader/w/.waterfall%2Fplan.md")).toEqual(want);
    expect(parseReaderHash("#/reader/w/.waterfall%2Fplan.md")).toEqual(want);
  });

  it("ignores a query the way the rest of the app's routes do", () => {
    expect(parseReaderHash("#/reader/w/plan.md?v=2")).toEqual({
      work: "w",
      path: "plan.md",
    });
  });

  it("is null for every address that is not a reader window", () => {
    for (const hash of [
      "",
      "#",
      "#/",
      "#/settings",
      "#/h/local",
      "#/t/local/8d8a0e3e-6b37-4a3f-9f0a-2a2a2a2a2a2a",
      "#/reader",
      "#/reader/w",
      "#/reader/w/plan.md/extra",
      "#/reader//plan.md",
      "#/reader/w/",
      "#/reader/w/%ZZ",
    ]) {
      expect(parseReaderHash(hash), hash).toBeNull();
    }
  });
});

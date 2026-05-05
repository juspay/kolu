import { describe, expect, it } from "vitest";
import { projectFileTreeSearch } from "./fileSearch";

describe("projectFileTreeSearch", () => {
  const paths = [
    "common/src/index.tsx",
    "common/src/Button.tsx",
    "packages/client/src/index.tsx",
  ];

  it("leaves single-token queries to Pierre", () => {
    expect(projectFileTreeSearch(paths, "index")).toEqual({
      projectedPaths: paths,
      pierreSearchQuery: "index",
    });
    expect(projectFileTreeSearch(paths, "index").projectedPaths).toBe(paths);
  });

  it("matches whitespace-separated path tokens in order", () => {
    expect(projectFileTreeSearch(paths, "common index.ts")).toEqual({
      projectedPaths: ["common/src/index.tsx"],
      pierreSearchQuery: "index.ts",
    });
  });

  it("normalizes backslashes and case", () => {
    expect(projectFileTreeSearch(paths, "COMMON\\src button")).toEqual({
      projectedPaths: ["common/src/Button.tsx"],
      pierreSearchQuery: "button",
    });
  });

  it("does not match tokens out of order", () => {
    expect(projectFileTreeSearch(paths, "index common")).toEqual({
      projectedPaths: [],
      pierreSearchQuery: "common",
    });
  });
});

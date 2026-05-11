import { describe, expect, it } from "vitest";
import { projectFileTreeSearch } from "./fileSearch";

describe("projectFileTreeSearch", () => {
  const paths = [
    "common/src/index.tsx",
    "common/src/Button.tsx",
    "packages/client/src/index.tsx",
  ];

  it("leaves blank queries unfiltered", () => {
    expect(projectFileTreeSearch(paths, "")).toEqual({
      projectedPaths: paths,
      expandedPathsOnReset: null,
      pierreSearchQuery: null,
    });
    expect(projectFileTreeSearch(paths, "").projectedPaths).toBe(paths);
  });

  it("projects single-token queries", () => {
    expect(projectFileTreeSearch(paths, "index")).toEqual({
      projectedPaths: ["common/src/index.tsx", "packages/client/src/index.tsx"],
      expandedPathsOnReset: [
        "common/",
        "common/src/",
        "packages/",
        "packages/client/",
        "packages/client/src/",
      ],
      pierreSearchQuery: null,
    });
  });

  it("matches whitespace-separated path tokens in order", () => {
    expect(projectFileTreeSearch(paths, "common index.ts")).toEqual({
      projectedPaths: ["common/src/index.tsx"],
      expandedPathsOnReset: ["common/", "common/src/"],
      pierreSearchQuery: null,
    });
  });

  it("normalizes backslashes and case", () => {
    expect(projectFileTreeSearch(paths, "COMMON\\src button")).toEqual({
      projectedPaths: ["common/src/Button.tsx"],
      expandedPathsOnReset: ["common/", "common/src/"],
      pierreSearchQuery: null,
    });
  });

  it("does not match tokens out of order", () => {
    expect(projectFileTreeSearch(paths, "index common")).toEqual({
      projectedPaths: [],
      expandedPathsOnReset: [],
      pierreSearchQuery: null,
    });
  });
});

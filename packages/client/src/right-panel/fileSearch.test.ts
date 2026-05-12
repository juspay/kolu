import { describe, expect, it } from "vitest";
import { projectFileTreeSearch } from "./fileSearch";

describe("projectFileTreeSearch", () => {
  const paths = [
    "common/src/index.tsx",
    "common/src/Button.tsx",
    "packages/client/src/index.tsx",
  ];

  it("returns the original path inventory and no expansions for an empty query", () => {
    expect(projectFileTreeSearch(paths, "")).toEqual({
      projectedPaths: paths,
      expandedAncestors: [],
    });
    expect(projectFileTreeSearch(paths, "").projectedPaths).toBe(paths);
  });

  it("matches a single token against the path string", () => {
    expect(projectFileTreeSearch(paths, "index")).toEqual({
      projectedPaths: [
        "common/src/index.tsx",
        "packages/client/src/index.tsx",
      ],
      expandedAncestors: [
        "common/",
        "common/src/",
        "packages/",
        "packages/client/",
        "packages/client/src/",
      ],
    });
  });

  it("matches whitespace-separated path tokens in order", () => {
    expect(projectFileTreeSearch(paths, "common index.ts")).toEqual({
      projectedPaths: ["common/src/index.tsx"],
      expandedAncestors: ["common/", "common/src/"],
    });
  });

  it("normalizes backslashes and case", () => {
    expect(projectFileTreeSearch(paths, "COMMON\\src button")).toEqual({
      projectedPaths: ["common/src/Button.tsx"],
      expandedAncestors: ["common/", "common/src/"],
    });
  });

  it("does not match tokens out of order", () => {
    expect(projectFileTreeSearch(paths, "index common")).toEqual({
      projectedPaths: [],
      expandedAncestors: [],
    });
  });
});

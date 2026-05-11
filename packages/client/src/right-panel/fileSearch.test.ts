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
      paths,
    });
    expect(projectFileTreeSearch(paths, "").paths).toBe(paths);
  });

  it("projects single-token queries", () => {
    expect(projectFileTreeSearch(paths, "index")).toEqual({
      paths: ["common/src/index.tsx", "packages/client/src/index.tsx"],
      initialExpandedPaths: [
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
      paths: ["common/src/index.tsx"],
      initialExpandedPaths: ["common/", "common/src/"],
    });
  });

  it("normalizes backslashes and case", () => {
    expect(projectFileTreeSearch(paths, "COMMON\\src button")).toEqual({
      paths: ["common/src/Button.tsx"],
      initialExpandedPaths: ["common/", "common/src/"],
    });
  });

  it("does not match tokens out of order", () => {
    expect(projectFileTreeSearch(paths, "index common")).toEqual({
      paths: [],
      initialExpandedPaths: [],
    });
  });
});

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
      paths,
      treeSearchQuery: "index",
    });
  });

  it("matches whitespace-separated path tokens in order", () => {
    expect(projectFileTreeSearch(paths, "common index.ts")).toEqual({
      paths: ["common/src/index.tsx"],
      treeSearchQuery: "index.ts",
    });
  });

  it("normalizes backslashes and case", () => {
    expect(projectFileTreeSearch(paths, "COMMON\\src button")).toEqual({
      paths: ["common/src/Button.tsx"],
      treeSearchQuery: "button",
    });
  });

  it("does not match tokens out of order", () => {
    expect(projectFileTreeSearch(paths, "index common")).toEqual({
      paths: [],
      treeSearchQuery: "common",
    });
  });
});

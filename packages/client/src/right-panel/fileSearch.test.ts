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
      projectedPaths: ["common/src/index.tsx", "packages/client/src/index.tsx"],
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

  it("matches an NFD path against an NFC query (and vice versa)", () => {
    // A git/macOS path can arrive NFD (`e` + U+0301 combining acute) while the
    // typed query is NFC (single U+00E9). Both sides normalize to NFC before
    // the substring search, so the accented name still matches. The two forms
    // below are literal accented characters; the `.not.toBe(.normalize("NFC"))`
    // guard asserts the NFD one really is decomposed, so the test holds
    // regardless of this file's on-disk bytes.
    const eAcuteNfc = "é"; // é, composed (one code point)
    const eAcuteNfd = "é"; // e + combining acute, decomposed
    const nfdPath = `People/Caf${eAcuteNfd}.md`;
    const nfcQuery = `caf${eAcuteNfc}`;
    expect(nfdPath).not.toBe(nfdPath.normalize("NFC")); // guard: truly NFD
    expect(projectFileTreeSearch([nfdPath], nfcQuery).projectedPaths).toEqual([
      nfdPath,
    ]);

    // Symmetric: NFC path, NFD query.
    const nfcPath = `People/Caf${eAcuteNfc}.md`;
    const nfdQuery = `caf${eAcuteNfd}`;
    expect(projectFileTreeSearch([nfcPath], nfdQuery).projectedPaths).toEqual([
      nfcPath,
    ]);
  });
});

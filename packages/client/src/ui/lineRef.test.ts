import { describe, expect, it } from "vitest";
import { findLineRefs, parseLineRef, resolveLineRefPath } from "./lineRef";

describe("line refs", () => {
  it("parses single-line and range references", () => {
    expect(parseLineRef("packages/a/src/Main.hs:109")).toEqual({
      path: "packages/a/src/Main.hs",
      start: 109,
      end: 109,
    });
    expect(parseLineRef("./src/app.ts:4-8")).toEqual({
      path: "./src/app.ts",
      start: 4,
      end: 8,
    });
  });

  it("finds references inside terminal text without trailing punctuation", () => {
    expect(findLineRefs("see packages/a/src/Main.hs:109).")).toEqual([
      {
        path: "packages/a/src/Main.hs",
        start: 109,
        end: 109,
        text: "packages/a/src/Main.hs:109",
        startIndex: 4,
        endIndex: 30,
      },
    ]);
  });

  it("ignores urls and non-path labels", () => {
    expect(findLineRefs("http://example.com/src/app.ts:12")).toEqual([]);
    expect(findLineRefs("error:12")).toEqual([]);
  });
});

describe("resolveLineRefPath", () => {
  const repoRoot = "/tmp/work";
  const repoPaths = [
    "packages/a/src/Main.hs",
    "src/app.ts",
    "nested/src/app.ts",
  ];

  it("resolves repo-relative paths", () => {
    expect(
      resolveLineRefPath({
        rawPath: "packages/a/src/Main.hs",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toBe("packages/a/src/Main.hs");
  });

  it("resolves cwd-relative paths inside the repo", () => {
    expect(
      resolveLineRefPath({
        rawPath: "src/app.ts",
        repoRoot,
        cwd: "/tmp/work/nested",
        repoPaths,
      }),
    ).toBe("nested/src/app.ts");
  });

  it("resolves absolute paths under the repo", () => {
    expect(
      resolveLineRefPath({
        rawPath: "/tmp/work/nested/src/app.ts",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toBe("nested/src/app.ts");
  });

  it("rejects paths outside the repo or not in git's file list", () => {
    expect(
      resolveLineRefPath({
        rawPath: "/tmp/other/src/app.ts",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toBeNull();
    expect(
      resolveLineRefPath({
        rawPath: "../outside.ts",
        repoRoot,
        cwd: "/tmp/work/nested",
        repoPaths,
      }),
    ).toBeNull();
  });
});

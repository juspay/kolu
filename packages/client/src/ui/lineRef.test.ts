import { describe, expect, it } from "vitest";
import {
  formatLineRef,
  lineRefCandidates,
  parseLineRefs,
  resolveLineRefPath,
} from "./lineRef";

describe("formatLineRef", () => {
  it("formats a single line and a range", () => {
    expect(formatLineRef("src/a.ts", 5, 5)).toBe("src/a.ts:5");
    expect(formatLineRef("src/a.ts", 5, 9)).toBe("src/a.ts:5-9");
  });

  it("returns the bare path when start is null", () => {
    expect(formatLineRef("src/a.ts", null, null)).toBe("src/a.ts");
  });
});

describe("parseLineRefs", () => {
  it("matches a simple repo-relative path with a line number", () => {
    const refs = parseLineRefs("see packages/foo/bar.ts:42 for details");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: "packages/foo/bar.ts",
      startLine: 42,
      endLine: 42,
      text: "packages/foo/bar.ts:42",
    });
  });

  it("matches absolute paths", () => {
    const refs = parseLineRefs(
      "/home/u/proj/src/main.rs:10:4 — column dropped",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: "/home/u/proj/src/main.rs",
      startLine: 10,
      endLine: 10,
    });
  });

  it("matches a line range", () => {
    const refs = parseLineRefs("hunk at src/lib.rs:12-30 needs review");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: "src/lib.rs",
      startLine: 12,
      endLine: 30,
    });
  });

  it("matches ./ and ../ relative paths", () => {
    expect(parseLineRefs("./src/app.ts:4-8")[0]?.path).toBe("./src/app.ts");
    expect(parseLineRefs("../shared/util.ts:12")[0]?.path).toBe(
      "../shared/util.ts",
    );
  });

  it("ignores tokens that look like time or version strings", () => {
    expect(parseLineRefs("12:30 PM — Makefile:5 — neither is a ref")).toEqual(
      [],
    );
  });

  it("ignores IPv4-like patterns by requiring a letter-led extension", () => {
    expect(parseLineRefs("server: 192.168.1.1:8080")).toEqual([]);
    expect(parseLineRefs("version 1.2.3:5")).toEqual([]);
  });

  it("matches bare filenames with letter-led extensions", () => {
    const refs = parseLineRefs("open Type.hs:109");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ path: "Type.hs", startLine: 109 });
  });

  it("matches multiple refs on one line", () => {
    const refs = parseLineRefs("a/b.ts:1 and c/d.rs:5-9 should both link");
    expect(refs.map((r) => r.path)).toEqual(["a/b.ts", "c/d.rs"]);
  });

  it("matches the deeply-nested Haskell path from #861", () => {
    const refs = parseLineRefs(
      "packages/vira-ci-types/src/Vira/CI/Pipeline/Type.hs:109",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.path).toBe(
      "packages/vira-ci-types/src/Vira/CI/Pipeline/Type.hs",
    );
    expect(refs[0]?.startLine).toBe(109);
  });

  it("rejects line numbers of zero", () => {
    expect(parseLineRefs("foo/bar.ts:0 — invalid")).toEqual([]);
  });

  it("rejects end < start ranges", () => {
    expect(parseLineRefs("foo/bar.ts:10-5 — backwards")).toEqual([]);
  });

  it("rejects URL embeds", () => {
    expect(
      parseLineRefs("see https://github.com/u/r/blob/main/a.ts:42"),
    ).toEqual([]);
    expect(parseLineRefs("http://example.com/src/app.ts:12")).toEqual([]);
  });

  it("rejects ~/ home-relative refs", () => {
    // No worktree-aware resolver contract for these — better to skip
    // than guess and silently open the wrong file.
    expect(parseLineRefs("see ~/src/app.ts:12 for notes")).toEqual([]);
  });

  it("reports correct index for ranges starting mid-line", () => {
    const line = "    error in packages/foo.ts:7";
    const refs = parseLineRefs(line);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.index).toBe(line.indexOf("packages/"));
    expect(refs[0]?.text).toBe("packages/foo.ts:7");
  });

  it("matches a bare slash-containing path without a line number", () => {
    const refs = parseLineRefs("see src/Main.hs for details");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: "src/Main.hs",
      startLine: null,
      endLine: null,
      text: "src/Main.hs",
    });
  });

  it("matches a bare filename with an extension and no line number", () => {
    const refs = parseLineRefs("open Main.hs to start");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: "Main.hs",
      startLine: null,
      endLine: null,
    });
  });

  it("does not linkify plain words without a `/` or `.ext`", () => {
    // `react`, `init`, `Makefile` etc. — common terminal output that
    // would be noisy if every word became hover-decorated.
    expect(parseLineRefs("npm i react")).toEqual([]);
    expect(parseLineRefs("git init")).toEqual([]);
    expect(parseLineRefs("run Makefile")).toEqual([]);
  });
});

describe("resolveLineRefPath", () => {
  const repoRoot = "/tmp/work";
  const repoPaths = [
    "packages/a/src/Main.hs",
    "src/app.ts",
    "nested/src/app.ts",
  ];

  it("resolves repo-relative paths against the file list", () => {
    expect(
      resolveLineRefPath({
        rawPath: "packages/a/src/Main.hs",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toBe("packages/a/src/Main.hs");
  });

  it("prefers cwd-relative when the user is in a subdirectory", () => {
    expect(
      resolveLineRefPath({
        rawPath: "src/app.ts",
        repoRoot,
        cwd: "/tmp/work/nested",
        repoPaths,
      }),
    ).toBe("nested/src/app.ts");
  });

  it("falls back to repo-relative when cwd-relative misses", () => {
    expect(
      resolveLineRefPath({
        rawPath: "packages/a/src/Main.hs",
        repoRoot,
        cwd: "/tmp/work/nested",
        repoPaths,
      }),
    ).toBe("packages/a/src/Main.hs");
  });

  it("strips repoRoot from absolute paths under the repo", () => {
    expect(
      resolveLineRefPath({
        rawPath: "/tmp/work/nested/src/app.ts",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toBe("nested/src/app.ts");
  });

  it("returns null for paths outside the repo or absent from the file list", () => {
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

  it("normalizes redundant ./ and trailing slashes in cwd", () => {
    expect(
      resolveLineRefPath({
        rawPath: "./app.ts",
        repoRoot,
        cwd: "/tmp/work/nested/src/",
        repoPaths,
      }),
    ).toBe("nested/src/app.ts");
  });

  it("resolves a bare filename whose basename is unique in the repo", () => {
    expect(
      resolveLineRefPath({
        rawPath: "Main.hs",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toBe("packages/a/src/Main.hs");
  });

  it("returns null when the basename is ambiguous", () => {
    expect(
      resolveLineRefPath({
        rawPath: "app.ts",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toBeNull();
  });

  it("falls back to basename when a slash-containing path doesn't match", () => {
    expect(
      resolveLineRefPath({
        rawPath: "wrong/Main.hs",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toBe("packages/a/src/Main.hs");
  });

  it("prefers an exact path candidate over the basename fallback", () => {
    expect(
      resolveLineRefPath({
        rawPath: "src/app.ts",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toBe("src/app.ts");
  });
});

describe("lineRefCandidates", () => {
  const repoRoot = "/tmp/work";

  it("yields cwd-relative then repo-relative for a bare path in a subdirectory", () => {
    expect(
      lineRefCandidates({
        rawPath: "app.ts",
        repoRoot,
        cwd: "/tmp/work/nested/src",
      }),
    ).toEqual(["nested/src/app.ts", "app.ts"]);
  });

  it("yields only the repo-stripped form for an absolute path under repoRoot", () => {
    expect(
      lineRefCandidates({
        rawPath: "/tmp/work/dist/build.js",
        repoRoot,
        cwd: repoRoot,
      }),
    ).toEqual(["dist/build.js"]);
  });

  it("yields nothing for an absolute path outside repoRoot", () => {
    expect(
      lineRefCandidates({
        rawPath: "/tmp/other/foo.ts",
        repoRoot,
        cwd: repoRoot,
      }),
    ).toEqual([]);
  });

  it("yields the repo-relative candidate when cwd is undefined", () => {
    expect(
      lineRefCandidates({
        rawPath: "src/app.ts",
        repoRoot,
        cwd: undefined,
      }),
    ).toEqual(["src/app.ts"]);
  });

  it("yields the repo-relative form even when the cwd-relative compose escapes the root", () => {
    expect(
      lineRefCandidates({
        rawPath: "../app.ts",
        repoRoot,
        cwd: "/tmp/work",
      }),
    ).toEqual([]);
  });
});

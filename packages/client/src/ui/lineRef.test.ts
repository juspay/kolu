import { describe, expect, it } from "vitest";
import { formatLineRef, parseLineRefs, resolveRef } from "./lineRef";

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

  it("matches a single-segment trailing-slash folder ref and keeps the slash", () => {
    const refs = parseLineRefs("see src/ for sources");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: "src/",
      startLine: null,
      endLine: null,
      text: "src/",
    });
  });

  it("matches a multi-segment trailing-slash folder ref and keeps the slash", () => {
    const refs = parseLineRefs("open packages/client/ in the tree");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: "packages/client/",
      startLine: null,
      endLine: null,
      text: "packages/client/",
    });
  });

  it("linkifies each directory in `ls -F` style output", () => {
    const refs = parseLineRefs("src/ dist/ node_modules/");
    expect(refs.map((r) => r.path)).toEqual(["src/", "dist/", "node_modules/"]);
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
    expect(parseLineRefs("npm i react")).toEqual([]);
    expect(parseLineRefs("git init")).toEqual([]);
    expect(parseLineRefs("run Makefile")).toEqual([]);
  });

  it("does not absorb a trailing sentence period into a slash-path", () => {
    const refs = parseLineRefs(
      "There is now a single docs/plans/electricity.html.",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: "docs/plans/electricity.html",
      text: "docs/plans/electricity.html",
      startLine: null,
      endLine: null,
    });
  });

  it("drops a run of trailing periods (ellipsis after a path)", () => {
    expect(parseLineRefs("opened src/notes.txt...")[0]).toMatchObject({
      path: "src/notes.txt",
      text: "src/notes.txt",
    });
  });

  it("keeps a trailing `+` so C++-style extensions still link", () => {
    expect(parseLineRefs("see src/foo.c++ now")[0]?.path).toBe("src/foo.c++");
  });

  it("keeps a unicode filename in one piece (does not split at the accent)", () => {
    const refs = parseLineRefs("see People/Amélie.md:3 for the bio");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: "People/Amélie.md",
      startLine: 3,
      endLine: 3,
      text: "People/Amélie.md:3",
    });
  });

  it("keeps a decomposed (NFD) unicode filename in one piece", () => {
    const line = "see People/Amélie.md:3 here".normalize("NFD");
    expect(line).not.toBe(line.normalize("NFC"));
    const refs = parseLineRefs(line);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.path.normalize("NFC")).toBe("People/Amélie.md");
    expect(refs[0]?.startLine).toBe(3);
  });

  it("matches a bare unicode filename and CJK/path segments", () => {
    expect(parseLineRefs("open Amélie.md now")[0]?.path).toBe("Amélie.md");
    expect(parseLineRefs("see 日本語/メモ.txt:7 here")[0]).toMatchObject({
      path: "日本語/メモ.txt",
      startLine: 7,
    });
  });

  it("reports a byte-accurate index/text for a unicode ref mid-line", () => {
    const line = "café at docs/Amélie.md:9";
    const refs = parseLineRefs(line);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.index).toBe(line.indexOf("docs/"));
    expect(refs[0]?.text).toBe("docs/Amélie.md:9");
  });

  it("keeps a :line suffix intact when a sentence period follows", () => {
    const refs = parseLineRefs("see a/b.c:42.");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      path: "a/b.c",
      startLine: 42,
      endLine: 42,
      text: "a/b.c:42",
    });
  });
});

describe("resolveRef", () => {
  const repoRoot = "/tmp/work";
  const repoPaths = [
    "packages/a/src/Main.hs",
    "src/app.ts",
    "nested/src/app.ts",
  ];

  const file = (path: string) => ({ kind: "file", path });
  const dir = (path: string) => ({ kind: "directory", path });

  it("resolves repo-relative paths against the file list", () => {
    expect(
      resolveRef({
        rawPath: "packages/a/src/Main.hs",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toEqual(file("packages/a/src/Main.hs"));
  });

  it("prefers cwd-relative when the user is in a subdirectory", () => {
    expect(
      resolveRef({
        rawPath: "src/app.ts",
        repoRoot,
        cwd: "/tmp/work/nested",
        repoPaths,
      }),
    ).toEqual(file("nested/src/app.ts"));
  });

  it("falls back to repo-relative when cwd-relative misses", () => {
    expect(
      resolveRef({
        rawPath: "packages/a/src/Main.hs",
        repoRoot,
        cwd: "/tmp/work/nested",
        repoPaths,
      }),
    ).toEqual(file("packages/a/src/Main.hs"));
  });

  it("strips repoRoot from absolute paths under the repo", () => {
    expect(
      resolveRef({
        rawPath: "/tmp/work/nested/src/app.ts",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toEqual(file("nested/src/app.ts"));
  });

  it("returns null for paths outside the repo or absent from the file list", () => {
    expect(
      resolveRef({
        rawPath: "/tmp/other/src/app.ts",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toBeNull();
    expect(
      resolveRef({
        rawPath: "../outside.ts",
        repoRoot,
        cwd: "/tmp/work/nested",
        repoPaths,
      }),
    ).toBeNull();
  });

  it("normalizes redundant ./ and trailing slashes in cwd", () => {
    expect(
      resolveRef({
        rawPath: "./app.ts",
        repoRoot,
        cwd: "/tmp/work/nested/src/",
        repoPaths,
      }),
    ).toEqual(file("nested/src/app.ts"));
  });

  it("resolves a bare filename whose basename is unique in the repo", () => {
    expect(
      resolveRef({
        rawPath: "Main.hs",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toEqual(file("packages/a/src/Main.hs"));
  });

  it("returns null when the basename is ambiguous", () => {
    expect(
      resolveRef({
        rawPath: "app.ts",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toBeNull();
  });

  it("falls back to basename when a slash-containing path doesn't match", () => {
    expect(
      resolveRef({
        rawPath: "wrong/Main.hs",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toEqual(file("packages/a/src/Main.hs"));
  });

  it("prefers an exact path candidate over the basename fallback", () => {
    expect(
      resolveRef({
        rawPath: "src/app.ts",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
      }),
    ).toEqual(file("src/app.ts"));
  });

  it("returns null on an exact miss when basename fallback is disabled", () => {
    expect(
      resolveRef({
        rawPath: "docs/Main.hs",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
        allowBasenameFallback: false,
      }),
    ).toBeNull();
  });

  it("still resolves an exact path when basename fallback is disabled", () => {
    expect(
      resolveRef({
        rawPath: "packages/a/src/Main.hs",
        repoRoot,
        cwd: repoRoot,
        repoPaths,
        allowBasenameFallback: false,
      }),
    ).toEqual(file("packages/a/src/Main.hs"));
  });

  it("resolves an NFC terminal ref against an NFD repo path (and returns the verbatim repo entry)", () => {
    const nfdRepoPath = "People/Amélie.md".normalize("NFD");
    expect(nfdRepoPath).not.toBe(nfdRepoPath.normalize("NFC"));
    const resolved = resolveRef({
      rawPath: "People/Amélie.md".normalize("NFC"),
      repoRoot,
      cwd: repoRoot,
      repoPaths: [nfdRepoPath],
    });
    expect(resolved).toEqual(file(nfdRepoPath));
  });

  it("resolves an NFD terminal ref against an NFC repo path via basename too", () => {
    const nfcRepoPath = "People/Amélie.md".normalize("NFC");
    expect(
      resolveRef({
        rawPath: "Amélie.md".normalize("NFD"),
        repoRoot,
        cwd: repoRoot,
        repoPaths: [nfcRepoPath],
      }),
    ).toEqual(file(nfcRepoPath));
  });

  it("returns null when two distinct repo paths collide under NFC", () => {
    const nfc = "People/Amélie.md".normalize("NFC");
    const nfd = "People/Amélie.md".normalize("NFD");
    expect(
      resolveRef({
        rawPath: nfc,
        repoRoot,
        cwd: repoRoot,
        repoPaths: [nfc, nfd],
        allowBasenameFallback: false,
      }),
    ).toBeNull();
  });

  const dirRepoPaths = [
    "src/app.ts",
    "src/lib/util.ts",
    "src/lib/helpers/format.ts",
    "docs/guide.md",
  ];

  it("resolves a directory path to its trailing-slash folder key", () => {
    expect(
      resolveRef({
        rawPath: "src/lib",
        repoRoot,
        cwd: repoRoot,
        repoPaths: dirRepoPaths,
      }),
    ).toEqual(dir("src/lib/"));
  });

  it("resolves a nested directory path", () => {
    expect(
      resolveRef({
        rawPath: "src/lib/helpers",
        repoRoot,
        cwd: repoRoot,
        repoPaths: dirRepoPaths,
      }),
    ).toEqual(dir("src/lib/helpers/"));
  });

  it("tolerates a trailing slash on a directory ref", () => {
    expect(
      resolveRef({
        rawPath: "src/lib/",
        repoRoot,
        cwd: repoRoot,
        repoPaths: dirRepoPaths,
      }),
    ).toEqual(dir("src/lib/"));
  });

  it("resolves a cwd-relative directory ref", () => {
    expect(
      resolveRef({
        rawPath: "lib",
        repoRoot,
        cwd: "/tmp/work/src",
        repoPaths: dirRepoPaths,
      }),
    ).toEqual(dir("src/lib/"));
  });

  it("resolves an absolute directory path under the repo", () => {
    expect(
      resolveRef({
        rawPath: "/tmp/work/src/lib",
        repoRoot,
        cwd: repoRoot,
        repoPaths: dirRepoPaths,
      }),
    ).toEqual(dir("src/lib/"));
  });

  it("prefers a real directory over a same-basename file elsewhere", () => {
    expect(
      resolveRef({
        rawPath: "app/core",
        repoRoot,
        cwd: repoRoot,
        repoPaths: ["app/core/one.ts", "lib/core"],
      }),
    ).toEqual(dir("app/core/"));
  });

  it("resolves a directory even when basename fallback is disabled", () => {
    expect(
      resolveRef({
        rawPath: "src/lib",
        repoRoot,
        cwd: repoRoot,
        repoPaths: dirRepoPaths,
        allowBasenameFallback: false,
      }),
    ).toEqual(dir("src/lib/"));
  });

  it("does not reveal a directory for a line-bearing ref", () => {
    expect(
      resolveRef({
        rawPath: "src/lib",
        repoRoot,
        cwd: repoRoot,
        repoPaths: dirRepoPaths,
        hasLine: true,
      }),
    ).toBeNull();
  });

  it("fails closed (no basename fuzzy) for a line-bearing directory ref", () => {
    expect(
      resolveRef({
        rawPath: "app/core",
        repoRoot,
        cwd: repoRoot,
        repoPaths: ["app/core/one.ts", "lib/core"],
        hasLine: true,
      }),
    ).toBeNull();
  });

  it("still resolves an exact file for a line-bearing ref", () => {
    expect(
      resolveRef({
        rawPath: "src/app.ts",
        repoRoot,
        cwd: repoRoot,
        repoPaths: dirRepoPaths,
        hasLine: true,
      }),
    ).toEqual(file("src/app.ts"));
  });

  it("returns null for a path that is neither a file nor a directory", () => {
    expect(
      resolveRef({
        rawPath: "src/nope",
        repoRoot,
        cwd: repoRoot,
        repoPaths: dirRepoPaths,
      }),
    ).toBeNull();
  });

  it("does not treat the repo root itself as a directory", () => {
    expect(
      resolveRef({
        rawPath: "/tmp/work",
        repoRoot,
        cwd: repoRoot,
        repoPaths: dirRepoPaths,
      }),
    ).toBeNull();
  });

  it("resolves an NFC directory ref against an NFD repo path (verbatim folder key)", () => {
    const nfdFile = "People/Amélie/note.md".normalize("NFD");
    const nfdDirKey = "People/Amélie/".normalize("NFD");
    expect(
      resolveRef({
        rawPath: "People/Amélie".normalize("NFC"),
        repoRoot,
        cwd: repoRoot,
        repoPaths: [nfdFile],
      }),
    ).toEqual(dir(nfdDirKey));
  });
});

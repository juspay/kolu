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

  it("matches a single-segment trailing-slash folder ref and keeps the slash", () => {
    // `ls -F` prints top-level directories as `src/`. The trailing slash must
    // stay inside the link range so the whole visible token is clickable.
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
    // The docs/tip examples use `packages/client/`; the slash must be part of
    // the match, not left outside the link (the old `+`-final-segment regex
    // stopped at `packages/client`).
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
    // `react`, `init`, `Makefile` etc. — common terminal output that
    // would be noisy if every word became hover-decorated.
    expect(parseLineRefs("npm i react")).toEqual([]);
    expect(parseLineRefs("git init")).toEqual([]);
    expect(parseLineRefs("run Makefile")).toEqual([]);
  });

  it("does not absorb a trailing sentence period into a slash-path", () => {
    // The reported bug: `…a single docs/plans/electricity.html.` — the
    // sentence period sat in the path char class, so the greedy match
    // swallowed it and the link pointed at `…electricity.html.`, which
    // never resolved. The reference must stop at the real filename.
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
    // Only `.` is stripped from the end — `+`/`@`/`-` are legitimate path
    // tails (`foo.c++`, `bin/g++`), so the dot-only rule must leave them.
    expect(parseLineRefs("see src/foo.c++ now")[0]?.path).toBe("src/foo.c++");
  });

  it("keeps a unicode filename in one piece (does not split at the accent)", () => {
    // The reported bug: `\w` is ASCII-only, so the path char class stopped
    // at `é` and the terminal linkified `People/Am` and `lie.md` as two
    // separate stubs. Unicode letters must stay inside the ref.
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
    // A git/macOS path can arrive decomposed: `Ame` + U+0301 (combining
    // acute) + `lie.md`. The combining mark is `\p{M}`, not `\p{L}`/`\p{N}`,
    // so without `\p{M}` in the char class the ref splits at the accent
    // exactly like the original ASCII bug.
    const line = "see People/Amélie.md:3 here".normalize("NFD");
    expect(line).not.toBe(line.normalize("NFC")); // guard: truly NFD
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
    // The xterm link provider builds its cell range from `index` +
    // `text.length`, so a non-ASCII char before/within the match must not
    // desync those. `é` is one UTF-16 code unit, so the offsets stay exact.
    const line = "café at docs/Amélie.md:9";
    const refs = parseLineRefs(line);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.index).toBe(line.indexOf("docs/"));
    expect(refs[0]?.text).toBe("docs/Amélie.md:9");
  });

  it("keeps a :line suffix intact when a sentence period follows", () => {
    // The end-anchored `(?<!\.)` lookbehind is placed after the whole
    // regex rather than inside the slash-path branch — safe only because
    // a `:line` suffix ends in a digit, so the lookbehind never trims it.
    // This pins that invariant: moving the lookbehind into the path branch
    // would change `:line` immunity, and this test would catch it.
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
    // GitHub-exact semantics (Markdown relative links, #1161): the linked
    // path is absent, but a unique same-basename file exists elsewhere. The
    // fuzzy fallback would silently open the wrong file — disabling it must
    // fail closed instead.
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
    // The repo path is decomposed (git/macOS NFD: `Ame` + combining acute),
    // the terminal text is composed (NFC). An exact `Set.has` would miss; we
    // compare under NFC. The resolved value must be the *verbatim* NFD repo
    // entry — that's the byte sequence the OS/git addresses the file by.
    const nfdRepoPath = "People/Amélie.md".normalize("NFD");
    expect(nfdRepoPath).not.toBe(nfdRepoPath.normalize("NFC")); // guard
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
    // Slash path differs only by normalization; also exercise the bare
    // basename fallback with mismatched forms.
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
    // A repo can contain both the NFC and NFD encodings of the same name as
    // genuinely distinct files. An NFC ref is ambiguous between them, so we
    // fail closed rather than open whichever happened to be indexed first.
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

  // ── Directory resolution (terminal folder-link front door) ──
  // A slash path that names no file but *is* a real directory resolves to a
  // `directory` reveal, keyed by its trailing-slash folder key (Pierre's
  // directory-row id). Directories are inferred from the file list's prefixes.
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
    // `app/core` is a real directory; `lib/core` is a file whose basename
    // (`core`) the fuzzy fallback would otherwise match. The directory must
    // win — clicking a folder path should reveal that folder, never guess at a
    // stray same-named file (the whole point of checking dirs before basename).
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
    // The exact-file and exact-directory steps aren't gated by
    // allowBasenameFallback — a Markdown relative link to a folder still
    // reveals it; only the fuzzy basename guess is disabled.
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
    // `app/core:12` carries a `:line` suffix, which only makes sense for a
    // file. A directory match would silently reveal `app/core/` and drop the
    // `:12`, so a line-bearing folder ref must fail closed to not-found.
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
    // `app/core:12` names a real directory (`app/core/`), and `core` is also a
    // unique file basename elsewhere (`lib/core`). The line suffix means a
    // file, so we don't reveal the folder — but because the path already names
    // a real directory we must NOT fall through to the basename fallback and
    // open the unrelated `lib/core`. It fails closed to not-found.
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
    // The line gate only suppresses the *directory* step — a real file with a
    // `:line` still resolves (and the caller paints the highlight).
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
    // An absolute ref equal to repoRoot strips to the empty candidate, which
    // names no folder row — resolve to nothing rather than a phantom root.
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
    // Same NFC/NFD concern as files: the folder key returned must be the
    // verbatim (NFD) prefix Pierre's tree is built from, not the NFC ref.
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

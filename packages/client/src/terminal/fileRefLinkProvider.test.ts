import { describe, expect, it } from "vitest";
import { parseFileRefs } from "./fileRefLinkProvider";

describe("parseFileRefs", () => {
  it("matches a simple repo-relative path with a line number", () => {
    const refs = parseFileRefs("see packages/foo/bar.ts:42 for details");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.ref).toEqual({
      path: "packages/foo/bar.ts",
      startLine: 42,
      endLine: 42,
    });
    expect(refs[0]?.text).toBe("packages/foo/bar.ts:42");
  });

  it("matches absolute paths", () => {
    const refs = parseFileRefs(
      "/home/u/proj/src/main.rs:10:4 — column dropped",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.ref).toEqual({
      path: "/home/u/proj/src/main.rs",
      startLine: 10,
      endLine: 10,
    });
  });

  it("matches a line range", () => {
    const refs = parseFileRefs("hunk at src/lib.rs:12-30 needs review");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.ref).toEqual({
      path: "src/lib.rs",
      startLine: 12,
      endLine: 30,
    });
  });

  it("ignores tokens that look like time or version strings", () => {
    // No slash AND no `.` → both regex branches fail.
    const refs = parseFileRefs("12:30 PM — Makefile:5 — these are not refs");
    expect(refs).toEqual([]);
  });

  it("ignores IPv4-like patterns by requiring a letter-led extension", () => {
    // The bare-filename branch demands the extension start with a
    // letter, so `192.168.1.1:8080` and `1.2.3:5` don't match.
    expect(parseFileRefs("server: 192.168.1.1:8080")).toEqual([]);
    expect(parseFileRefs("version 1.2.3:5")).toEqual([]);
  });

  it("matches bare filenames with letter-led extensions", () => {
    // `Type.hs:109` from the issue description but without a leading
    // directory — still a useful click target.
    const refs = parseFileRefs("open Type.hs:109");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.ref).toEqual({
      path: "Type.hs",
      startLine: 109,
      endLine: 109,
    });
  });

  it("matches multiple refs on one line", () => {
    const refs = parseFileRefs("a/b.ts:1 and c/d.rs:5-9 should both link");
    expect(refs.map((r) => r.ref.path)).toEqual(["a/b.ts", "c/d.rs"]);
  });

  it("matches the deeply-nested Haskell path from the issue", () => {
    const refs = parseFileRefs(
      "packages/vira-ci-types/src/Vira/CI/Pipeline/Type.hs:109",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.ref.path).toBe(
      "packages/vira-ci-types/src/Vira/CI/Pipeline/Type.hs",
    );
    expect(refs[0]?.ref.startLine).toBe(109);
  });

  it("rejects line numbers of zero", () => {
    // 0-line refs are nonsensical (Pierre/editors are 1-based) — the
    // regex matches them but the post-filter rejects them.
    const refs = parseFileRefs("foo/bar.ts:0 — invalid");
    expect(refs).toEqual([]);
  });

  it("rejects end < start ranges", () => {
    const refs = parseFileRefs("foo/bar.ts:10-5 — backwards");
    expect(refs).toEqual([]);
  });

  it("reports correct index for ranges starting mid-line", () => {
    const line = "    error in packages/foo.ts:7";
    const refs = parseFileRefs(line);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.index).toBe(line.indexOf("packages/"));
    expect(refs[0]?.text).toBe("packages/foo.ts:7");
  });
});

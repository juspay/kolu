/** Unit tests for `resolveUnder` — the path-containment guard. */

import path from "node:path";
import { describe, it, expect } from "vitest";
import { resolveUnder } from "./safe-path.ts";

const ROOT = "/tmp/kolu-test-repo";

describe("resolveUnder", () => {
  describe("accepts paths inside the root", () => {
    it.each([
      ["file.txt", "file.txt"],
      ["dir/file.txt", "dir/file.txt"],
      ["a/b/c/d.txt", "a/b/c/d.txt"],
      // path.resolve normalizes redundant separators / "."
      ["./file.txt", "file.txt"],
      ["dir//file.txt", path.join("dir", "file.txt")],
      ["dir/./file.txt", path.join("dir", "file.txt")],
      // "foo/../bar" normalizes to "bar" — still inside.
      ["dir/../other.txt", "other.txt"],
      // absolute path that *is* inside the root
      [`${ROOT}/inner/file.txt`, path.join("inner", "file.txt")],
    ])("child %j → rel %j", (child, expectedRel) => {
      const { abs, rel } = resolveUnder(ROOT, child);
      expect(rel).toBe(expectedRel);
      expect(abs).toBe(path.resolve(ROOT, child));
    });

    it("returns empty rel when child is the root itself", () => {
      const { abs, rel } = resolveUnder(ROOT, ".");
      expect(rel).toBe("");
      expect(abs).toBe(path.resolve(ROOT));
    });
  });

  describe("rejects paths that escape the root", () => {
    it.each([
      "../escape.txt",
      "../../etc/passwd",
      "dir/../../escape.txt",
      "a/b/../../../out.txt",
      // absolute path outside the root
      "/etc/passwd",
      // sibling directory that shares a name prefix — the classic
      // `startsWith(root + sep)` bug if the check is written wrong.
      // `/tmp/kolu-test-repo-evil` is outside `/tmp/kolu-test-repo`.
      "/tmp/kolu-test-repo-evil/file.txt",
    ])("child %j throws", (child) => {
      expect(() => resolveUnder(ROOT, child)).toThrow(/escapes root/);
    });
  });

  describe("normalizes the root argument", () => {
    it("accepts a relative root by resolving against cwd", () => {
      const { abs } = resolveUnder(".", "file.txt");
      expect(abs).toBe(path.resolve(".", "file.txt"));
    });

    it("accepts a root with a trailing slash", () => {
      const { rel } = resolveUnder(`${ROOT}/`, "inner/file.txt");
      expect(rel).toBe(path.join("inner", "file.txt"));
    });
  });
});

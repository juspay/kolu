import { describe, expect, it } from "vitest";
import { contentCacheKey, diffItems, fileItem } from "./codeViewItem";

const newFileDiff = (body: string): string =>
  `diff --git a/note.txt b/note.txt
new file mode 100644
index 0000000..aaaaaaaa
--- /dev/null
+++ b/note.txt
@@ -0,0 +1 @@
+${body}
`;

describe("contentCacheKey", () => {
  it("changes when the payload changes, stays put when it doesn't", () => {
    const a = contentCacheKey("note.txt", "before\n");
    const b = contentCacheKey("note.txt", "after\n");
    const again = contentCacheKey("note.txt", "before\n");
    expect(a).not.toBe(b);
    expect(a).toBe(again);
    expect(a.startsWith("note.txt:")).toBe(true);
  });
});

describe("diffItems", () => {
  it("stamps a content cacheKey so a live hunk swap is a new Pierre target", () => {
    const errors: Error[] = [];
    const [before] = diffItems("note.txt", newFileDiff("before"), (e) =>
      errors.push(e),
    );
    const [after] = diffItems("note.txt", newFileDiff("after"), (e) =>
      errors.push(e),
    );
    expect(errors).toEqual([]);
    expect(
      before?.fileDiff.additionLines.some((l) => l.includes("before")),
    ).toBe(true);
    expect(after?.fileDiff.additionLines.some((l) => l.includes("after"))).toBe(
      true,
    );
    expect(before?.fileDiff.cacheKey).toBeDefined();
    expect(after?.fileDiff.cacheKey).toBeDefined();
    expect(before?.fileDiff.cacheKey).not.toBe(after?.fileDiff.cacheKey);
    // Pierre 1.3 would otherwise fill cacheKey with the filename, making
    // these two look like the same highlight target.
    expect(before?.fileDiff.cacheKey).not.toBe("note.txt");
    expect(after?.fileDiff.cacheKey).not.toBe("note.txt");
  });

  it("yields every file of a type-changed path's pathspec patch", () => {
    // `git diff <base> -- skills/odu` after the directory `skills/odu/` was
    // replaced by a symlink: the new link plus the files that used to live
    // under it. Keeping only the first file would hide the old children.
    const raw = `diff --git a/skills/odu b/skills/odu
new file mode 120000
index 0000000..1111111
--- /dev/null
+++ b/skills/odu
@@ -0,0 +1 @@
+../../agent-plugin/skills/odu
\\ No newline at end of file
diff --git a/skills/odu/SKILL.md b/skills/odu/SKILL.md
deleted file mode 100644
index 2222222..0000000
--- a/skills/odu/SKILL.md
+++ /dev/null
@@ -1 +0,0 @@
-# odu
`;
    const errors: Error[] = [];
    const items = diffItems("skills/odu", raw, (e) => errors.push(e));
    expect(errors).toEqual([]);
    expect(items.map((i) => i.id)).toEqual([
      "skills/odu",
      "skills/odu/SKILL.md",
    ]);
  });

  it("reports a non-empty diff that parses to no file", () => {
    const errors: Error[] = [];
    expect(diffItems("x", "not a diff\n", (e) => errors.push(e))).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});

describe("fileItem", () => {
  it("stamps a content cacheKey so a live body swap is a new Pierre target", () => {
    const before = fileItem("letters.txt", "letters.txt", "first version\n");
    const after = fileItem("letters.txt", "letters.txt", "second version\n");
    expect(before.file.cacheKey).toBeDefined();
    expect(after.file.cacheKey).toBeDefined();
    expect(before.file.cacheKey).not.toBe(after.file.cacheKey);
    expect(before.file.cacheKey).not.toBe("letters.txt");
  });
});

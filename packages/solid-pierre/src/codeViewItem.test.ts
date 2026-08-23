import { describe, expect, it } from "vitest";
import { contentCacheKey, diffItem, fileItem } from "./codeViewItem";

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

describe("diffItem", () => {
  it("stamps a content cacheKey so a live hunk swap is a new Pierre target", () => {
    const errors: Error[] = [];
    const before = diffItem("note.txt", newFileDiff("before"), (e) =>
      errors.push(e),
    );
    const after = diffItem("note.txt", newFileDiff("after"), (e) =>
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

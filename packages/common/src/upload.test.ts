import { describe, expect, it } from "vitest";
import { sanitizeUploadName } from "./upload.ts";

describe("sanitizeUploadName", () => {
  it("preserves unicode letters and digits in the name", () => {
    // The old ASCII allowlist replaced every non-ASCII byte with `_`, so a
    // name like `berichte_märz.pdf` became `berichte______.pdf`.
    const a = "berichte_märz.pdf";
    expect(sanitizeUploadName(a)).toBe(a.normalize("NFC"));
    const b = "文件.txt";
    expect(sanitizeUploadName(b)).toBe(b.normalize("NFC"));
  });

  it("composes decomposed (NFD) input to NFC", () => {
    const nfd = "Café.md".normalize("NFD");
    expect(nfd).not.toBe(nfd.normalize("NFC")); // guard: truly NFD
    expect(sanitizeUploadName(nfd)).toBe("Café.md".normalize("NFC"));
  });

  it("still strips directory components and traversal", () => {
    expect(sanitizeUploadName("a/b/c.png")).toBe("c.png");
    expect(sanitizeUploadName("../../etc/passwd")).toBe("passwd");
    // basename doesn't split backslashes on POSIX, but the allowlist still
    // collapses them so a name can't smuggle a separator through.
    expect(sanitizeUploadName("a\\b.png")).toBe("a_b.png");
  });

  it("collapses control chars and shell metacharacters to underscores", () => {
    expect(sanitizeUploadName("na;me$().png")).toBe("na_me___.png");
  });

  it("falls back to 'upload' when nothing survives", () => {
    expect(sanitizeUploadName("...")).toBe("upload");
    expect(sanitizeUploadName("")).toBe("upload");
    expect(sanitizeUploadName("a/b/")).toBe("b"); // trailing slash stripped
  });
});

import {
  ALLOWED_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  extensionOf,
  isAllowedUploadName,
  rejectionFor,
} from "kolu-common/upload";
import { describe, expect, it } from "vitest";

describe("extensionOf", () => {
  it.each([
    { input: "notes.md", expected: "md" },
    { input: "Cargo.lock", expected: "lock" },
    { input: "screenshot.PNG", expected: "png" },
    { input: "archive.tar.gz", expected: "gz" },
    { input: "README", expected: null },
    { input: ".gitignore", expected: null },
    { input: "trailing.", expected: null },
  ])("extensionOf($input) → $expected", ({ input, expected }) => {
    expect(extensionOf(input)).toBe(expected);
  });
});

describe("isAllowedUploadName", () => {
  it.each([
    { input: "notes.md", expected: true },
    { input: "data.JSON", expected: true },
    { input: "image.png", expected: true },
    { input: "malware.exe", expected: false },
    { input: "shipping.tar", expected: false },
    { input: "README", expected: false },
  ])("isAllowedUploadName($input) → $expected", ({ input, expected }) => {
    expect(isAllowedUploadName(input)).toBe(expected);
  });
});

describe("rejectionFor", () => {
  it("accepts a small allowed file", () => {
    expect(rejectionFor("notes.md", 1024)).toBeNull();
  });

  it("rejects a file with disallowed extension", () => {
    expect(rejectionFor("malware.exe", 1024)).toMatch(/not allowed/);
  });

  it("rejects a file above the size cap", () => {
    expect(rejectionFor("big.txt", MAX_UPLOAD_BYTES + 1)).toMatch(/too large/);
  });

  it("reports the extension rejection before the size rejection", () => {
    // A malicious file that is also oversized — surfacing the type
    // mismatch first is the more actionable error for the user.
    expect(rejectionFor("malware.exe", MAX_UPLOAD_BYTES + 1)).toMatch(
      /not allowed/,
    );
  });

  it("allowlist exposes common code, data, and image extensions", () => {
    for (const ext of ["ts", "json", "md", "png", "pdf"]) {
      expect(ALLOWED_UPLOAD_EXTENSIONS).toContain(ext);
    }
  });
});

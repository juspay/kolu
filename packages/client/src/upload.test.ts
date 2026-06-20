import { VIDEO_EXTENSIONS } from "kolu-common/preview";
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  extensionOf,
  isAllowedUploadName,
  MAX_UPLOAD_BYTES,
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
    { input: "clip.mov", expected: true },
    { input: "demo.mp4", expected: true },
    { input: "render.WEBM", expected: true },
    { input: "malware.exe", expected: false },
    { input: "shipping.tar", expected: false },
    { input: "movie.mkv", expected: false },
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

  it("accepts a dropped screen recording", () => {
    expect(
      rejectionFor("Screen Recording 2026-06-20 at 8.42.14 AM.mov", 1024),
    ).toBeNull();
  });

  it("still enforces the size cap for video — it is not lifted for video", () => {
    // The cap is a deliberate, video-inclusive policy: a video can be
    // dropped, but the 10 MB ceiling is shared with every other file type.
    expect(rejectionFor("recording.mov", MAX_UPLOAD_BYTES + 1)).toMatch(
      /too large/,
    );
  });

  it("allowlist covers every previewable video container", () => {
    // Drift guard: the upload allowlist reuses preview.ts's canonical video
    // set, so a container Kolu can preview is also one you can drop. Strip the
    // leading dot the same way the source spread does.
    for (const ext of VIDEO_EXTENSIONS) {
      expect(ALLOWED_UPLOAD_EXTENSIONS).toContain(ext.slice(1));
    }
  });
});

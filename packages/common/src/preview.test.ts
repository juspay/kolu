import { describe, expect, it } from "vitest";
import {
  binaryPreviewFamily,
  BINARY_PREVIEWABLE_EXTENSIONS,
  decodePreviewPath,
  encodePreviewPath,
  isBinaryPreviewable,
  isMarkdown,
  isRasterImage,
  isSandboxPreviewable,
  isVideo,
  MARKDOWN_EXTENSIONS,
  PDF_PREVIEWABLE_EXTENSIONS,
  RASTER_IMAGE_EXTENSIONS,
  SANDBOX_PREVIEWABLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "./preview.ts";

const binaryFamilies = [
  {
    name: "sandbox",
    extensions: SANDBOX_PREVIEWABLE_EXTENSIONS,
    matches: isSandboxPreviewable,
  },
  {
    name: "PDF",
    extensions: PDF_PREVIEWABLE_EXTENSIONS,
    matches: (path: string) => binaryPreviewFamily(path) === "pdf",
  },
  {
    name: "raster",
    extensions: RASTER_IMAGE_EXTENSIONS,
    matches: isRasterImage,
  },
  { name: "video", extensions: VIDEO_EXTENSIONS, matches: isVideo },
] as const;

describe("isBinaryPreviewable", () => {
  it("classifies sandbox documents, PDFs, raster images, and videos (regression: images were UTF-8 garbage)", () => {
    expect(isBinaryPreviewable("out.html")).toBe(true);
    expect(isBinaryPreviewable("logo.svg")).toBe(true);
    expect(isBinaryPreviewable("doc.pdf")).toBe(true);
    expect(isBinaryPreviewable("icon-512.png")).toBe(true);
    expect(isBinaryPreviewable("photo.JPG")).toBe(true);
    expect(isBinaryPreviewable("favicon.ico")).toBe(true);
    expect(isBinaryPreviewable("demo.mp4")).toBe(true);
    expect(isBinaryPreviewable("clip.WEBM")).toBe(true);
  });

  it("leaves source files on the text path", () => {
    expect(isBinaryPreviewable("main.ts")).toBe(false);
    expect(isBinaryPreviewable("README.md")).toBe(false);
  });
});

describe("isRasterImage", () => {
  it("matches raster extensions case-insensitively", () => {
    expect(isRasterImage("icon-512.png")).toBe(true);
    expect(isRasterImage("a/b/photo.JPEG")).toBe(true);
    expect(isRasterImage("anim.gif")).toBe(true);
    expect(isRasterImage("hero.webp")).toBe(true);
  });

  it("excludes sandbox documents — SVG can carry scripts and stays in the iframe", () => {
    expect(isRasterImage("logo.svg")).toBe(false);
    expect(isRasterImage("out.html")).toBe(false);
    expect(isRasterImage("doc.pdf")).toBe(false);
  });

  it("excludes videos — they get the <video> element, not <img>", () => {
    expect(isRasterImage("demo.mp4")).toBe(false);
    expect(isRasterImage("clip.webm")).toBe(false);
  });
});

describe("binaryPreviewFamily", () => {
  it("classifies each binary renderer family case-insensitively", () => {
    expect(binaryPreviewFamily("out.html")).toBe("sandbox");
    expect(binaryPreviewFamily("a/b/logo.SVG")).toBe("sandbox");
    expect(binaryPreviewFamily("doc.pdf")).toBe("pdf");
    expect(binaryPreviewFamily("a/b/spec.PDF")).toBe("pdf");
    expect(binaryPreviewFamily("icon-512.png")).toBe("raster");
    expect(binaryPreviewFamily("demo.MP4")).toBe("video");
  });

  it("returns null for non-binary-previewable paths", () => {
    expect(binaryPreviewFamily("README.md")).toBe(null);
    expect(binaryPreviewFamily("main.ts")).toBe(null);
  });
});

describe("isVideo", () => {
  it("matches video extensions case-insensitively", () => {
    expect(isVideo("demo.mp4")).toBe(true);
    expect(isVideo("a/b/clip.WEBM")).toBe(true);
    expect(isVideo("trailer.mov")).toBe(true);
    expect(isVideo("short.m4v")).toBe(true);
    expect(isVideo("old.ogv")).toBe(true);
  });

  it("excludes images, sandbox documents, and non-web containers", () => {
    expect(isVideo("hero.webp")).toBe(false);
    expect(isVideo("logo.svg")).toBe(false);
    expect(isVideo("movie.mkv")).toBe(false);
    expect(isVideo("movie.avi")).toBe(false);
  });
});

describe("isSandboxPreviewable", () => {
  it("matches sandbox extensions case-insensitively", () => {
    expect(isSandboxPreviewable("out.html")).toBe(true);
    expect(isSandboxPreviewable("page.HTM")).toBe(true);
    expect(isSandboxPreviewable("logo.svg")).toBe(true);
  });

  it("excludes PDFs, raster images, and videos — those get dedicated renderers, not the sandbox", () => {
    expect(isSandboxPreviewable("doc.PDF")).toBe(false);
    expect(isSandboxPreviewable("icon-512.png")).toBe(false);
    expect(isSandboxPreviewable("photo.jpeg")).toBe(false);
    expect(isSandboxPreviewable("demo.mp4")).toBe(false);
    expect(isSandboxPreviewable("clip.webm")).toBe(false);
  });
});

describe("isMarkdown", () => {
  it("matches markdown extensions case-insensitively", () => {
    expect(isMarkdown("README.md")).toBe(true);
    expect(isMarkdown("docs/Guide.MD")).toBe(true);
    expect(isMarkdown("notes.markdown")).toBe(true);
  });

  it("excludes non-markdown text and binary-previewable files", () => {
    expect(isMarkdown("main.ts")).toBe(false);
    expect(isMarkdown("out.html")).toBe(false);
    expect(isMarkdown("logo.svg")).toBe(false);
  });
});

describe("the binary-previewable partition is structural", () => {
  it("is exactly sandbox ∪ PDF ∪ raster ∪ video", () => {
    expect([...BINARY_PREVIEWABLE_EXTENSIONS].sort()).toEqual(
      binaryFamilies.flatMap((family) => [...family.extensions]).sort(),
    );
  });

  it("has disjoint sandbox, PDF, raster, and video sets (no extension is in two)", () => {
    for (const [i, left] of binaryFamilies.entries()) {
      for (const right of binaryFamilies.slice(i + 1)) {
        const rightExtensions = new Set<string>(right.extensions);
        expect(
          left.extensions.filter((extension) => rightExtensions.has(extension)),
          `${left.name} overlaps ${right.name}`,
        ).toEqual([]);
      }
    }
  });

  it("every binary-previewable extension matches exactly one renderer family — no silent extra category", () => {
    // Guards the client's `binaryPreviewFamily` dispatch: a future
    // non-image, non-video, non-PDF, non-document binary
    // (`.wasm`, a font) cannot slip in without landing in exactly one set —
    // the runtime counterpart to the explicit "unsupported" no-match renderer.
    for (const ext of BINARY_PREVIEWABLE_EXTENSIONS) {
      const path = `file${ext}`;
      expect(binaryPreviewFamily(path)).not.toBe(null);
      const matched = binaryFamilies
        .map((family) => family.matches(path))
        .filter(Boolean);
      expect(matched).toHaveLength(1);
    }
  });

  it("markdown is its own axis — never binary-previewable (stays kind:text)", () => {
    // Markdown renders client-side from `content`, so it must never be
    // routed to the binary URL path; it's a text file with a rendered form.
    for (const ext of MARKDOWN_EXTENSIONS) {
      expect(isBinaryPreviewable(`file${ext}`)).toBe(false);
      expect(isMarkdown(`file${ext}`)).toBe(true);
    }
  });
});

describe("encodePreviewPath / decodePreviewPath", () => {
  it("keeps slashes literal and percent-encodes each segment", () => {
    expect(encodePreviewPath("docs/a.html")).toBe("docs/a.html");
    expect(encodePreviewPath("my notes/page one.html")).toBe(
      "my%20notes/page%20one.html",
    );
    expect(encodePreviewPath("100%/=done?.html")).toBe(
      "100%25/%3Ddone%3F.html",
    );
  });

  it("round-trips any repo path (decode ∘ encode = id)", () => {
    for (const p of [
      "first.html",
      "docs/nested/dir/b.html",
      "weird & name.html",
      "café/résumé.html",
      "100%/=done?.html",
    ]) {
      expect(decodePreviewPath(encodePreviewPath(p))).toBe(p);
    }
  });
});

// Cross-package drift guard: padi owns the terminal UPLOAD allowlist and must
// NOT import this app-shared preview module (the dependency arrow points OUT of
// padi). Its `UPLOAD_VIDEO_EXTENSIONS` is a hand-kept copy of the playable set;
// this test — in kolu-common, which legitimately consumes @kolu/padi (app→padi)
// — fails LOUD if the two ever diverge, replacing the old shared import.
import { UPLOAD_VIDEO_EXTENSIONS } from "@kolu/padi/upload";

describe("padi upload video list stays in lockstep with preview VIDEO_EXTENSIONS", () => {
  it("padi's UPLOAD_VIDEO_EXTENSIONS equals preview VIDEO_EXTENSIONS (dot-stripped)", () => {
    expect([...UPLOAD_VIDEO_EXTENSIONS].sort()).toEqual(
      VIDEO_EXTENSIONS.map((e) => e.slice(1)).sort(),
    );
  });
});

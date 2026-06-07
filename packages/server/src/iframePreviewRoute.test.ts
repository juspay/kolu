/** Tests for kolu's preview-serving glue (`iframePreviewRoute.ts`) — the
 *  kolu-specific contracts the agnostic `@kolu/serve-dir` package can't own:
 *    1. kolu's `BINARY_PREVIEWABLE_EXTENSIONS` classifier is fully covered by
 *       serve-dir's Content-Type map (and the per-family MIME invariants the
 *       client's `<video>`/`<img>` dispatch relies on);
 *    2. the realpath guard kolu actually ships (`previewRealpathGuard`, the
 *       adapter `index.ts` injects into `createDirServer`) rejects a symlink
 *       whose real target escapes the root — exercising the shipped adapter, not
 *       a re-derived copy. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentTypeForPath, serveFile } from "@kolu/serve-dir";
import {
  BINARY_PREVIEWABLE_EXTENSIONS,
  RASTER_IMAGE_EXTENSIONS,
  SANDBOX_PREVIEWABLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "kolu-common/preview";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { previewRealpathGuard } from "./iframePreviewRoute.ts";

describe("@kolu/serve-dir Content-Type covers kolu's binary-previewable classifier", () => {
  // If any previewable extension lacked a real type, serve-dir would serve it as
  // `application/octet-stream` and the browser would download instead of render.
  it.each(
    BINARY_PREVIEWABLE_EXTENSIONS,
  )("%s has a non-octet Content-Type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).not.toBe(
      "application/octet-stream",
    );
  });

  // Beyond "non-octet", assert the MIME FAMILY per classifier bucket: the client
  // dispatches `VIDEO_EXTENSIONS` into a `<video>` element and
  // `RASTER_IMAGE_EXTENSIONS` into an `<img>`, so a video extension typo'd to
  // `image/*` (or vice versa) would pass the non-octet check yet break playback.
  it.each(VIDEO_EXTENSIONS)("%s maps to a video/* type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).toMatch(/^video\//);
  });

  it.each(RASTER_IMAGE_EXTENSIONS)("%s maps to an image/* type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).toMatch(/^image\//);
  });

  // Sandbox-previewable kinds (.html/.htm/.svg/.pdf) span families (text/html,
  // image/svg+xml, application/pdf), so the non-octet check is the right
  // invariant for that bucket.
  it.each(
    SANDBOX_PREVIEWABLE_EXTENSIONS,
  )("%s has a non-octet Content-Type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).not.toBe(
      "application/octet-stream",
    );
  });
});

describe("previewRealpathGuard (the guard index.ts injects) blocks symlink escape", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-preview-guard-"));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("403s a symlink whose real target escapes the root (no content leaks)", async () => {
    // Drives the SHIPPED adapter — the same `previewRealpathGuard(root)` value
    // `index.ts` hands to `createDirServer` — through `serveFile`, so this
    // verifies what runs in production, not a hand-rolled mirror.
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "kolu-preview-guard-outside-"),
    );
    try {
      const secret = path.join(outside, "secret.html");
      fs.writeFileSync(secret, "<!doctype html><h1>SECRET</h1>");
      fs.symlinkSync(secret, path.join(tmpRoot, "leak.html"));
      const res = await serveFile(
        tmpRoot,
        "leak.html",
        undefined,
        previewRealpathGuard(tmpRoot),
      );
      expect(res.status).toBe(403);
      expect(res.body.toString()).not.toContain("SECRET");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("allows an in-root file through the same guard", async () => {
    fs.writeFileSync(
      path.join(tmpRoot, "ok.html"),
      "<!doctype html><h1>ok</h1>",
    );
    const res = await serveFile(
      tmpRoot,
      "ok.html",
      undefined,
      previewRealpathGuard(tmpRoot),
    );
    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain("ok");
  });
});

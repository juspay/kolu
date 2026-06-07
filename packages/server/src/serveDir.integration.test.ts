/** kolu-server integration tests for `@kolu/serve-dir` — the couplings that
 *  belong to the consumer, not the agnostic package:
 *    1. kolu's `BINARY_PREVIEWABLE_EXTENSIONS` classifier is fully covered by
 *       serve-dir's Content-Type map (and the per-family MIME invariants the
 *       client's `<video>`/`<img>` dispatch relies on);
 *    2. the realpath guard kolu actually wires (`assertRealpathUnder`) rejects a
 *       symlink escaping the root with 403 — i.e. the SHIPPED guard, not a
 *       hand-rolled mirror.
 *  serve-dir's own tests stay agnostic (no kolu imports); these live here so the
 *  kolu-specific contracts are verified against the code kolu ships. */

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
import { assertRealpathUnder } from "kolu-git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("serve-dir Content-Type covers kolu's binary-previewable classifier", () => {
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

describe("kolu's wired realpath guard (assertRealpathUnder) blocks symlink escape", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-serve-dir-int-"));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("403s a symlink whose real target escapes the root (no content leaks)", async () => {
    // This is the EXACT guard `index.ts` injects into createDirServer, verified
    // against the shipped `assertRealpathUnder` rather than a test-local mirror.
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "kolu-serve-dir-int-outside-"),
    );
    try {
      const secret = path.join(outside, "secret.html");
      fs.writeFileSync(secret, "<!doctype html><h1>SECRET</h1>");
      fs.symlinkSync(secret, path.join(tmpRoot, "leak.html"));
      const res = await serveFile(
        tmpRoot,
        "leak.html",
        undefined,
        async (abs) => (await assertRealpathUnder(tmpRoot, abs)).ok,
      );
      expect(res.status).toBe(403);
      expect(res.body.toString()).not.toContain("SECRET");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

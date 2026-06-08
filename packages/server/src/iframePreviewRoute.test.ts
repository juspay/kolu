/** Tests for kolu's preview-serving glue (`iframePreviewRoute.ts`) — the
 *  kolu-specific contracts the agnostic `@kolu/serve-dir` package can't own:
 *    1. kolu's `BINARY_PREVIEWABLE_EXTENSIONS` classifier is fully covered by
 *       serve-dir's Content-Type map (and the per-family MIME invariants the
 *       client's `<video>`/`<img>` dispatch relies on);
 *    2. the realpath guard kolu actually ships (`previewRealpathGuard`, the
 *       adapter `index.ts` injects into `createDirServer`) rejects a symlink
 *       whose real target escapes the root — exercising the shipped adapter, not
 *       a re-derived copy. */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import type { HttpBindings } from "@hono/node-server";
import {
  contentTypeForPath,
  createDirServer,
  serveFile,
} from "@kolu/serve-dir";
import { Hono } from "hono";
import {
  BINARY_PREVIEWABLE_EXTENSIONS,
  buildTerminalFileUrl,
  RASTER_IMAGE_EXTENSIONS,
  SANDBOX_PREVIEWABLE_EXTENSIONS,
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
  VIDEO_EXTENSIONS,
} from "kolu-common/preview";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  previewRealpathGuard,
  previewTailFromRawUrl,
  rawTargetFromContext,
} from "./iframePreviewRoute.ts";

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
    // Success bodies stream (200 and 206 alike), so read the stream rather than
    // `.toString()`-ing it directly.
    expect(await readServeBody(res.body)).toContain("ok");
  });
});

// Success bodies come back as a `ReadableStream` (bytes flow from a bounded file
// handle straight to the socket); read it as text.
async function readServeBody(body: string | ReadableStream): Promise<string> {
  if (typeof body === "string") return body;
  return new Response(body).text();
}

describe("previewTailFromRawUrl (the tail extraction index.ts feeds serve-dir)", () => {
  const terminalId = "abc";

  it("round-trips a filename with a literal % through encode → extract → serve-dir decode", async () => {
    // The bug class: a real file `100% done.mp4` is built as
    // `100%25%20done.mp4`. Decoding the tail once before serve-dir (as
    // `c.req.path`'s `decodeURI` would) yields `100% done.mp4`, and serve-dir's
    // `decodeURIComponent` then throws on the bare `% ` → a spurious 400. The raw
    // tail keeps it encoded so serve-dir's single decode recovers the real name.
    const filePath = "100% done.mp4";
    const url = `http://host${buildTerminalFileUrl(terminalId, filePath)}`;
    const tail = previewTailFromRawUrl(url, terminalId);
    expect(tail).toBe("100%25%20done.mp4");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      fs.writeFileSync(path.join(tmpRoot, filePath), "video-bytes");
      const res = await serveFile(tmpRoot, tail);
      expect(res.status).toBe(200);
      expect(await readServeBody(res.body)).toBe("video-bytes");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("preserves segment boundaries so an encoded %2f traversal is rejected", async () => {
    // An attacker sends a literal `%2f` to smuggle a `/` past the per-segment
    // `..` check. The raw tail keeps `%2f` encoded; serve-dir decodes it to `/`,
    // splits, and the per-segment check rejects the `..` → 400 (not a traversal).
    const url = `http://host/api/terminals/${terminalId}/file/foo%2f..%2fpasswd`;
    const tail = previewTailFromRawUrl(url, terminalId);
    expect(tail).toBe("foo%2f..%2fpasswd");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      const res = await serveFile(tmpRoot, tail);
      expect(res.status).toBe(400);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("keeps a literal `..` dot segment intact (no URL normalization)", async () => {
    // `new URL(rawUrl).pathname` would collapse `foo/../secret.html` to
    // `secret.html` BEFORE the slice, so serve-dir would never see the `..` and
    // would serve the sibling. Slicing the raw string keeps the `..` segment so
    // serve-dir's per-segment check rejects it with 400.
    const url = `http://host/api/terminals/${terminalId}/file/foo/../secret.html`;
    const tail = previewTailFromRawUrl(url, terminalId);
    expect(tail).toBe("foo/../secret.html");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");
      const res = await serveFile(tmpRoot, tail);
      expect(res.status).toBe(400);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("keeps an encoded `%2e%2e` dot segment intact (no URL normalization)", async () => {
    // WHATWG normalization also decodes-then-collapses `%2e%2e` → `..`. Slicing
    // the raw string leaves it encoded for serve-dir's single decode, which then
    // produces a `..` segment the per-segment check rejects with 400.
    const url = `http://host/api/terminals/${terminalId}/file/foo/%2e%2e/secret.html`;
    const tail = previewTailFromRawUrl(url, terminalId);
    expect(tail).toBe("foo/%2e%2e/secret.html");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");
      const res = await serveFile(tmpRoot, tail);
      expect(res.status).toBe(400);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("extracts the tail from an origin-form URL (path only, no authority)", () => {
    // Node may hand the handler an origin-form target (`/path?query`); the raw
    // slicer must handle it as well as absolute-form.
    expect(
      previewTailFromRawUrl(
        `/api/terminals/${terminalId}/file/clip.mp4?v=123`,
        terminalId,
      ),
    ).toBe("clip.mp4");
  });

  it("returns empty for a URL that doesn't match the prefix", () => {
    expect(previewTailFromRawUrl("http://host/other/path", terminalId)).toBe(
      "",
    );
  });
});

// The unit tests above feed `previewTailFromRawUrl` a literal raw string, but
// production hands it a value from a real Hono + @hono/node-server request. That
// adapter builds `c.req.raw.url` via `new URL(...).href`, which WHATWG-normalizes
// dot segments BEFORE the handler runs — so a route reading `c.req.raw.url` would
// have the `..` collapsed away and serve the sibling file. These tests boot the
// real adapter and drive it over HTTP to prove the shipped route sources the RAW
// target (`c.env.incoming.url`) and the `..` guard holds end-to-end.
describe("iframe-preview route over real @hono/node-server (raw target survives the adapter)", () => {
  const terminalId = "abc";
  let tmpRoot: string;
  let server: ReturnType<typeof serve>;
  let baseUrl: string;

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-route-int-"));
    fs.writeFileSync(path.join(tmpRoot, "clip.mp4"), "video-bytes");
    fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");

    // Drive the SAME shipped target-selection adapter production uses
    // (`rawTargetFromContext`, which reads the RAW `c.env.incoming.url` and
    // fails CLOSED to a 500 when `incoming` is absent rather than serving the
    // WHATWG-normalized `c.req.raw.url`), slice the tail, hand it to serve-dir
    // with the shipped realpath guard — so this test can't drift from index.ts.
    const app = new Hono<{ Bindings: HttpBindings }>();
    const pattern = `${TERMINAL_FILE_ROUTE_BASE}/:terminalId/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/*`;
    app.get(pattern, async (c) => {
      const id = c.req.param("terminalId");
      const rawTarget = rawTargetFromContext(c);
      if (rawTarget === undefined) {
        return c.text("raw request target unavailable", 500);
      }
      const rawTail = previewTailFromRawUrl(rawTarget, id);
      return createDirServer(tmpRoot, previewRealpathGuard(tmpRoot)).fetch(
        rawTail,
        c.req.raw,
      );
    });

    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) =>
      server.on("listening", () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected a TCP address from the test server");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // Issue a raw GET with a verbatim request target (no `new URL` normalization
  // on our side) so the dot segment reaches the server exactly as sent.
  function rawGet(target: string): Promise<{ status: number; body: string }> {
    const { port, hostname } = new URL(baseUrl);
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: hostname, port: Number(port), method: "GET", path: target },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("serves an in-root file (sanity: the route is wired)", async () => {
    const res = await rawGet(`/api/terminals/${terminalId}/file/clip.mp4?v=1`);
    expect(res.status).toBe(200);
    expect(res.body).toBe("video-bytes");
  });

  it("400s a literal `..` dot segment instead of serving the sibling", async () => {
    const res = await rawGet(
      `/api/terminals/${terminalId}/file/foo/../secret.html`,
    );
    expect(res.status).toBe(400);
    expect(res.body).not.toContain("SECRET");
  });

  it("400s an encoded `%2e%2e` dot segment instead of serving the sibling", async () => {
    const res = await rawGet(
      `/api/terminals/${terminalId}/file/foo/%2e%2e/secret.html`,
    );
    expect(res.status).toBe(400);
    expect(res.body).not.toContain("SECRET");
  });
});

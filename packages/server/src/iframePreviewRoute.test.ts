import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { NodeHttpServer } from "@effect/platform-node";
import { withArtifactSdk } from "@kolu/artifact-sdk/server";
import { padiClientOver } from "@kolu/padi-client/dial";
import { contentTypeForPath, serveFile } from "@kolu/serve-dir";
import type { RemotePool } from "@kolu/surface-remote";
import { Effect, Exit, Scope, Stream } from "effect";
import { HttpRouter } from "effect/http";
import {
  BINARY_PREVIEWABLE_EXTENSIONS,
  buildTerminalFileUrl,
  PDF_PREVIEWABLE_EXTENSIONS,
  RASTER_IMAGE_EXTENSIONS,
  SANDBOX_PREVIEWABLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "kolu-common/preview";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assembleRemotePreview,
  PREVIEW_ROUTE_PATTERN,
  type PreviewHostPool,
  type PreviewPadiClient,
  type PreviewRangeReader,
  type PreviewReadResult,
  previewRouteHandler,
  previewTailFromRawUrl,
  REMOTE_PREVIEW_CHUNK_BYTES,
  remotePreviewReader,
} from "./iframePreviewRoute.ts";
import type { PadiSession } from "./padi/padiSession.ts";

describe("@kolu/serve-dir Content-Type covers kolu's binary-previewable classifier", () => {
  it.each(
    BINARY_PREVIEWABLE_EXTENSIONS,
  )("%s has a non-octet Content-Type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).not.toBe(
      "application/octet-stream",
    );
  });

  it.each(VIDEO_EXTENSIONS)("%s maps to a video/* type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).toMatch(/^video\//);
  });

  it.each(RASTER_IMAGE_EXTENSIONS)("%s maps to an image/* type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).toMatch(/^image\//);
  });

  it.each(PDF_PREVIEWABLE_EXTENSIONS)("%s maps to application/pdf", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).toBe("application/pdf");
  });

  it.each(
    SANDBOX_PREVIEWABLE_EXTENSIONS,
  )("%s has a non-octet Content-Type", (ext) => {
    expect(contentTypeForPath(`file${ext}`)).not.toBe(
      "application/octet-stream",
    );
  });
});

describe("assembleRemotePreview — the remote-bind chunked range-loop", () => {
  let tmpRoot: string;
  const HELLO = "hello world";
  const BLOB = Buffer.from(Array.from({ length: 300 }, (_, i) => i % 256));

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-remote-preview-"));
    fs.writeFileSync(path.join(tmpRoot, "hello.txt"), HELLO);
    fs.writeFileSync(path.join(tmpRoot, "empty.txt"), "");
    fs.writeFileSync(path.join(tmpRoot, "blob.png"), BLOB);
  });
  afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  function serveDirReader(name: string): PreviewRangeReader {
    return (range) =>
      Effect.flatMap(serveFile(tmpRoot, name, range ?? null), (r) =>
        Effect.promise(async () => {
          const bodyBase64 =
            typeof r.body === "string"
              ? Buffer.from(r.body, "utf8").toString("base64")
              : Buffer.from(await new Response(r.body).arrayBuffer()).toString(
                  "base64",
                );
          return { status: r.status, headers: r.headers, bodyBase64 };
        }),
      );
  }

  function recording(inner: PreviewRangeReader): {
    read: PreviewRangeReader;
    ranges: (string | undefined)[];
  } {
    const ranges: (string | undefined)[] = [];
    return {
      ranges,
      read: (range) => {
        ranges.push(range);
        return inner(range);
      },
    };
  }

  async function drain(body: ReadableStream | string): Promise<Buffer> {
    if (typeof body === "string") return Buffer.from(body, "utf8");
    return Buffer.from(await new Response(body).arrayBuffer());
  }

  function headerCI(
    headers: Record<string, string>,
    name: string,
  ): string | undefined {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers))
      if (k.toLowerCase() === lower) return v;
    return undefined;
  }

  const runPreview = (...args: Parameters<typeof assembleRemotePreview>) =>
    Effect.runPromise(assembleRemotePreview(...args));

  it("serves a whole file (no Range) as a 200 with the real Content-Type and exact bytes", async () => {
    const r = await runPreview(serveDirReader("hello.txt"), undefined);
    expect(r.status).toBe(200);
    expect(headerCI(r.headers, "content-type")).toMatch(/^text\/plain/);
    expect(headerCI(r.headers, "content-length")).toBeUndefined();
    expect((await drain(r.body)).toString("utf8")).toBe(HELLO);
  });

  it("round-trips BINARY bytes exactly across multiple chunks (no base64 corruption)", async () => {
    const r = await runPreview(
      serveDirReader("blob.png"),
      undefined,
      undefined,
      128,
    );
    expect(r.status).toBe(200);
    expect(headerCI(r.headers, "content-type")).toBe("image/png");
    const body = await drain(r.body);
    expect(body.byteLength).toBe(BLOB.byteLength);
    expect(Buffer.compare(body, BLOB)).toBe(0);
  });

  it("drives bounded chunk ranges at exact boundaries incl. a partial last chunk", async () => {
    const rec = recording(serveDirReader("blob.png"));
    const r = await runPreview(rec.read, undefined, undefined, 128);
    await drain(r.body);
    expect(rec.ranges).toEqual([
      "bytes=0-0",
      "bytes=0-127",
      "bytes=128-255",
      "bytes=256-299",
    ]);
  });

  it("serves a satisfiable Range as a 206 with Content-Range + Content-Length", async () => {
    const r = await runPreview(serveDirReader("hello.txt"), "bytes=0-4");
    expect(r.status).toBe(206);
    expect(headerCI(r.headers, "content-range")).toBe("bytes 0-4/11");
    expect(headerCI(r.headers, "content-length")).toBe("5");
    expect((await drain(r.body)).toString("utf8")).toBe("hello");
  });

  it("resolves a suffix range via serve-dir's own parser (bytes=-5 → last 5 bytes)", async () => {
    const r = await runPreview(serveDirReader("hello.txt"), "bytes=-5");
    expect(r.status).toBe(206);
    expect(headerCI(r.headers, "content-range")).toBe("bytes 6-10/11");
    expect((await drain(r.body)).toString("utf8")).toBe("world");
  });

  it("416s an unsatisfiable Range on a non-empty file", async () => {
    const r = await runPreview(serveDirReader("hello.txt"), "bytes=100-200");
    expect(r.status).toBe(416);
    expect(headerCI(r.headers, "content-range")).toBe("bytes */11");
  });

  it("honors a matching If-Range (206) and collapses a STALE If-Range to a full 200", async () => {
    const reader = serveDirReader("blob.png");
    const probe = await Effect.runPromise(reader("bytes=0-0"));
    const etag = headerCI(probe.headers, "etag");
    expect(etag).toBeDefined();
    const match = await runPreview(reader, "bytes=0-63", etag);
    expect(match.status).toBe(206);
    expect(headerCI(match.headers, "content-range")).toBe("bytes 0-63/300");
    const stale = await runPreview(reader, "bytes=0-63", '"stale-nomatch"');
    expect(stale.status).toBe(200);
    expect(headerCI(stale.headers, "content-range")).toBeUndefined();
    expect((await drain(stale.body)).byteLength).toBe(300);
  });

  it("serves a ZERO-length file (no Range) as a 200 with an empty body", async () => {
    const r = await runPreview(serveDirReader("empty.txt"), undefined);
    expect(r.status).toBe(200);
    expect(headerCI(r.headers, "content-type")).toMatch(/^text\/plain/);
    expect((await drain(r.body)).byteLength).toBe(0);
  });

  it("416s a Range against a ZERO-length file (bytes */0)", async () => {
    const r = await runPreview(serveDirReader("empty.txt"), "bytes=0-100");
    expect(r.status).toBe(416);
    expect(headerCI(r.headers, "content-range")).toBe("bytes */0");
  });

  it("propagates a missing-file error status verbatim (404, not a masked 200)", async () => {
    const r = await runPreview(serveDirReader("nope.txt"), undefined);
    expect(r.status).toBe(404);
    expect(typeof r.body).toBe("string");
  });

  it("FAILS LOUDLY when a chunk mid-stream returns the wrong status — never a silent truncation", async () => {
    const inner = serveDirReader("blob.png");
    let chunkDials = 0;
    const faulty: PreviewRangeReader = (range) =>
      Effect.suspend(() => {
        if (range && range !== "bytes=0-0") {
          chunkDials += 1;
          if (chunkDials === 2)
            return Effect.succeed({ status: 500, headers: {}, bodyBase64: "" });
        }
        return inner(range);
      });
    const r = await runPreview(faulty, undefined, undefined, 128);
    expect(r.status).toBe(200);
    await expect(drain(r.body)).rejects.toThrow(/expected 206, got 500/);
  });

  it("FAILS LOUDLY when a chunk returns a short body — never a silent truncation", async () => {
    const inner = serveDirReader("blob.png");
    const faulty: PreviewRangeReader = (range) =>
      Effect.map(inner(range), (r) =>
        range === "bytes=0-127"
          ? { ...r, bodyBase64: r.bodyBase64.slice(0, 8) }
          : r,
      );
    const r = await runPreview(faulty, undefined, undefined, 128);
    await expect(drain(r.body)).rejects.toThrow(/expected 128 bytes/);
  });

  it("FAILS LOUDLY when the file size changes mid-stream — refuses an inconsistent body", async () => {
    const inner = serveDirReader("blob.png");
    const faulty: PreviewRangeReader = (range) =>
      Effect.map(inner(range), (r) =>
        range === "bytes=128-255"
          ? {
              ...r,
              headers: { ...r.headers, "Content-Range": "bytes 128-255/999" },
            }
          : r,
      );
    const r = await runPreview(faulty, undefined, undefined, 128);
    await expect(drain(r.body)).rejects.toThrow(/size changed mid-stream/);
  });

  it("FAILS LOUDLY when the file is REPLACED by a same-size file mid-stream — the validator catches what the size check can't", async () => {
    const inner = serveDirReader("blob.png");
    const faulty: PreviewRangeReader = (range) =>
      Effect.map(inner(range), (r) =>
        range === "bytes=128-255"
          ? { ...r, headers: { ...r.headers, ETag: '"deadbeef-swap"' } }
          : r,
      );
    const r = await runPreview(faulty, undefined, undefined, 128);
    await expect(drain(r.body)).rejects.toThrow(/validator/);
  });

  it("FAILS LOUDLY when a 206 probe carries NO ETag — the snapshot guard can't be silently defeated", async () => {
    const inner = serveDirReader("blob.png");
    const noEtag: PreviewRangeReader = (range) =>
      Effect.map(inner(range), (r) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.headers))
          if (k.toLowerCase() !== "etag") headers[k] = v;
        return { ...r, headers };
      });
    await expect(runPreview(noEtag, undefined)).rejects.toThrow(
      /no ETag validator/,
    );
  });

  it("FAILS LOUDLY when a chunk answers the WRONG slice at the right length — refuses a mismatched body", async () => {
    const inner = serveDirReader("blob.png");
    const faulty: PreviewRangeReader = (range) =>
      Effect.map(inner(range), (r) =>
        range === "bytes=128-255"
          ? {
              ...r,
              headers: { ...r.headers, "Content-Range": "bytes 0-127/300" },
            }
          : r,
      );
    const r = await runPreview(faulty, undefined, undefined, 128);
    await expect(drain(r.body)).rejects.toThrow(/wrong slice/);
  });

  it("FAILS LOUDLY when the metadata probe returns an unexpected 200 — never a UTF-8-mangled binary body under a success status", async () => {
    const faulty: PreviewRangeReader = (range) =>
      Effect.suspend(() =>
        range === "bytes=0-0"
          ? Effect.succeed({ status: 200, headers: {}, bodyBase64: "" })
          : serveDirReader("blob.png")(range),
      );
    await expect(runPreview(faulty, undefined)).rejects.toThrow(
      /unexpected status 200/,
    );
  });

  it("propagates a probe-phase reader rejection (so the route maps a link fault to a logged 503, not a silent 500)", async () => {
    const linkFault = new Error("ssh link dropped mid-probe");
    const read: PreviewRangeReader = () => Effect.fail(linkFault);
    await expect(runPreview(read, undefined)).rejects.toBe(linkFault);
  });

  it("uses an 8 MiB production chunk bound", () => {
    expect(REMOTE_PREVIEW_CHUNK_BYTES).toBe(8 * 1024 * 1024);
  });
});

async function readServeBody(body: string | ReadableStream): Promise<string> {
  if (typeof body === "string") return body;
  return new Response(body).text();
}

describe("previewTailFromRawUrl (the tail extraction index.ts feeds serve-dir)", () => {
  const host = "local";
  const terminalId = "abc";

  it("round-trips a filename with a literal % through encode → extract → serve-dir decode", async () => {
    const filePath = "100% done.mp4";
    const url = `http://host${buildTerminalFileUrl(host, terminalId, filePath)}`;
    const tail = previewTailFromRawUrl(url, host, terminalId);
    expect(tail).toBe("100%25%20done.mp4");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      fs.writeFileSync(path.join(tmpRoot, filePath), "video-bytes");
      const res = await Effect.runPromise(serveFile(tmpRoot, tail));
      expect(res.status).toBe(200);
      expect(await readServeBody(res.body)).toBe("video-bytes");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("preserves segment boundaries so an encoded %2f traversal is rejected", async () => {
    const url = `http://host/api/terminals/${host}/${terminalId}/file/foo%2f..%2fpasswd`;
    const tail = previewTailFromRawUrl(url, host, terminalId);
    expect(tail).toBe("foo%2f..%2fpasswd");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      const res = await Effect.runPromise(serveFile(tmpRoot, tail));
      expect(res.status).toBe(400);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("keeps a literal `..` dot segment intact (no URL normalization)", async () => {
    const url = `http://host/api/terminals/${host}/${terminalId}/file/foo/../secret.html`;
    const tail = previewTailFromRawUrl(url, host, terminalId);
    expect(tail).toBe("foo/../secret.html");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");
      const res = await Effect.runPromise(serveFile(tmpRoot, tail));
      expect(res.status).toBe(400);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("keeps an encoded `%2e%2e` dot segment intact (no URL normalization)", async () => {
    const url = `http://host/api/terminals/${host}/${terminalId}/file/foo/%2e%2e/secret.html`;
    const tail = previewTailFromRawUrl(url, host, terminalId);
    expect(tail).toBe("foo/%2e%2e/secret.html");

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tail-"));
    try {
      fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");
      const res = await Effect.runPromise(serveFile(tmpRoot, tail));
      expect(res.status).toBe(400);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("extracts the tail from an origin-form URL (path only, no authority)", () => {
    expect(
      previewTailFromRawUrl(
        `/api/terminals/${host}/${terminalId}/file/clip.mp4?v=123`,
        host,
        terminalId,
      ),
    ).toBe("clip.mp4");
  });

  it("returns empty for a URL that doesn't match the prefix", () => {
    expect(
      previewTailFromRawUrl("http://host/other/path", host, terminalId),
    ).toBe("");
  });
});

describe("iframe-preview route over a real node server (the raw target survives)", () => {
  const host = "local";
  const terminalId = "abc";
  let tmpRoot: string;
  let server: http.Server;
  let handlerScope: Scope.Closeable;
  let baseUrl: string;

  const client: PreviewPadiClient = {
    surface: {
      preview: {
        repoRootForTerminal: () => Effect.succeed({ repoRoot: tmpRoot }),
        read: () =>
          Effect.fail(new Error("the local arm must never dial preview.read")),
      },
    },
  };
  const pool: PreviewHostPool = {
    getSession: (encoded) =>
      encoded === "local"
        ? { currentClient: () => Promise.resolve(client) }
        : undefined,
  };

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-route-int-"));
    fs.writeFileSync(path.join(tmpRoot, "clip.mp4"), "video-bytes");
    fs.writeFileSync(path.join(tmpRoot, "secret.html"), "SECRET");

    handlerScope = await Effect.runPromise(Scope.make());
    const handler = await Effect.runPromise(
      Effect.gen(function* () {
        const httpEffect = yield* HttpRouter.toHttpEffect(
          HttpRouter.add(
            "GET",
            PREVIEW_ROUTE_PATTERN,
            previewRouteHandler({ pool, log: { error: () => {} } }),
          ),
        );
        return yield* NodeHttpServer.makeHandler(httpEffect, {
          scope: handlerScope,
        });
      }).pipe(Scope.provide(handlerScope)),
    );

    server = http.createServer();
    server.on("request", handler);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected a TCP address from the test server");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Effect.runPromise(Scope.close(handlerScope, Exit.void));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

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

  it("the narrow seam accepts the REAL pool the composition root passes", () => {
    const asSeam = (p: RemotePool<PadiSession, undefined>): PreviewHostPool =>
      p;
    expect(typeof asSeam).toBe("function");
  });

  it("serves an in-root file (sanity: the route is wired)", async () => {
    const res = await rawGet(
      `/api/terminals/${host}/${terminalId}/file/clip.mp4?v=1`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toBe("video-bytes");
  });

  it("400s a literal `..` dot segment instead of serving the sibling", async () => {
    const res = await rawGet(
      `/api/terminals/${host}/${terminalId}/file/foo/../secret.html`,
    );
    expect(res.status).toBe(400);
    expect(res.body).not.toContain("SECRET");
  });

  it("400s an encoded `%2e%2e` dot segment instead of serving the sibling", async () => {
    const res = await rawGet(
      `/api/terminals/${host}/${terminalId}/file/foo/%2e%2e/secret.html`,
    );
    expect(res.status).toBe(400);
    expect(res.body).not.toContain("SECRET");
  });

  it("400s a host segment that is not a canonical host key", async () => {
    const res = await rawGet(
      `/api/terminals/not-a-key/${terminalId}/file/clip.mp4`,
    );
    expect(res.status).toBe(400);
    expect(res.body).toBe("invalid host key");
  });

  it("404s a canonical host key that is not a pool member", async () => {
    const res = await rawGet(
      `/api/terminals/remote%3Abox/${terminalId}/file/clip.mp4`,
    );
    expect(res.status).toBe(404);
    expect(res.body).toBe('unknown host "remote:box"');
  });

  it("serves a filename carrying a literal % through the whole route", async () => {
    fs.writeFileSync(path.join(tmpRoot, "100% done.mp4"), "pct-bytes");
    const res = await rawGet(
      buildTerminalFileUrl(host, terminalId, "100% done.mp4"),
    );
    expect(res.status).toBe(200);
    expect(res.body).toBe("pct-bytes");
  });
});

describe("remotePreviewReader — the UNRANGED dial must stay key-absent (#17)", () => {
  function recordingPadi(): {
    read: (input: {
      repoPath: string;
      filePath: string;
      range?: string;
    }) => Effect.Effect<PreviewReadResult, unknown>;
    inputs: unknown[];
  } {
    const inputs: unknown[] = [];
    const client = padiClientOver({
      unary: (_tag, payload) => {
        inputs.push(payload);
        return Effect.succeed({ status: 200, headers: {}, bodyBase64: "" });
      },
      stream: () => Stream.empty,
    });
    return { inputs, read: (input) => client.padi.surface.preview.read(input) };
  }

  it("OMITS the key on an unranged dial", async () => {
    const { read, inputs } = recordingPadi();
    await Effect.runPromise(
      remotePreviewReader(read, "/repo", "a.ts")(undefined),
    );
    expect(inputs.at(-1)).toEqual({ repoPath: "/repo", filePath: "a.ts" });
    expect(Object.hasOwn(inputs.at(-1) as object, "range")).toBe(false);
  });

  it("OMITS the key for the empty-file re-read the assembler performs", async () => {
    const { read, inputs } = recordingPadi();
    const reader = remotePreviewReader(read, "/repo", "empty.txt");
    await Effect.runPromise(reader("bytes=0-0"));
    await Effect.runPromise(reader(undefined));
    expect(inputs.map((i) => (i as { range?: string }).range)).toEqual([
      "bytes=0-0",
      undefined,
    ]);
    expect(Object.hasOwn(inputs[1] as object, "range")).toBe(false);
  });

  it("still sends a real Range verbatim", async () => {
    const { read, inputs } = recordingPadi();
    await Effect.runPromise(
      remotePreviewReader(read, "/repo", "blob.png")("bytes=0-127"),
    );
    expect(inputs.at(-1)).toEqual({
      repoPath: "/repo",
      filePath: "blob.png",
      range: "bytes=0-127",
    });
  });
});

describe("iframe-preview route confines every non-PDF preview with a CSP sandbox", () => {
  const terminalId = "abc";
  const REMOTE = "remote%3Abox";
  let tmpRoot: string;
  let server: http.Server;
  let handlerScope: Scope.Closeable;
  let port: number;

  const remoteHeaders: Record<string, string>[] = [];

  const remoteClient: PreviewPadiClient = {
    surface: {
      preview: {
        repoRootForTerminal: () => Effect.succeed({ repoRoot: tmpRoot }),
        read: ({ repoPath, filePath, range }) =>
          Effect.flatMap(serveFile(repoPath, filePath, range ?? null), (r) =>
            Effect.promise(async () => {
              const headers =
                filePath === "weak.html"
                  ? { ...r.headers, "Content-Security-Policy": "default-src *" }
                  : r.headers;
              remoteHeaders.push(headers);
              const bodyBase64 =
                typeof r.body === "string"
                  ? Buffer.from(r.body, "utf8").toString("base64")
                  : Buffer.from(
                      await new Response(r.body).arrayBuffer(),
                    ).toString("base64");
              return { status: r.status, headers, bodyBase64 };
            }),
          ),
      },
    },
  };
  const localClient: PreviewPadiClient = {
    surface: {
      preview: {
        repoRootForTerminal: () => Effect.succeed({ repoRoot: tmpRoot }),
        read: () =>
          Effect.fail(new Error("the local arm must never dial preview.read")),
      },
    },
  };
  const pool: PreviewHostPool = {
    getSession: (encoded) =>
      encoded === "local"
        ? { currentClient: () => Promise.resolve(localClient) }
        : encoded === "remote:box"
          ? { currentClient: () => Promise.resolve(remoteClient) }
          : undefined,
  };

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-route-csp-"));
    fs.writeFileSync(
      path.join(tmpRoot, "page.html"),
      "<html><body><script>1</script></body></html>",
    );
    fs.writeFileSync(
      path.join(tmpRoot, "weak.html"),
      "<html><body></body></html>",
    );
    fs.writeFileSync(
      path.join(tmpRoot, "art.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );
    fs.writeFileSync(path.join(tmpRoot, "doc.pdf"), "%PDF-1.4\n");

    handlerScope = await Effect.runPromise(Scope.make());
    const handler = await Effect.runPromise(
      Effect.gen(function* () {
        const httpEffect = yield* HttpRouter.toHttpEffect(
          HttpRouter.add(
            "GET",
            PREVIEW_ROUTE_PATTERN,
            withArtifactSdk("/sdk.js")(
              previewRouteHandler({ pool, log: { error: () => {} } }),
            ),
          ),
        );
        return yield* NodeHttpServer.makeHandler(httpEffect, {
          scope: handlerScope,
        });
      }).pipe(Scope.provide(handlerScope)),
    );
    server = http.createServer();
    server.on("request", handler);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected a TCP address from the test server");
    }
    port = addr.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Effect.runPromise(Scope.close(handlerScope, Exit.void));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function get(
    host: string,
    file: string,
  ): Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method: "GET",
          path: `/api/terminals/${host}/${terminalId}/file/${file}`,
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  for (const [arm, host] of [
    ["local", "local"],
    ["remote", REMOTE],
  ] as const) {
    it(`${arm} arm: a decorated html 200 keeps the CSP sandbox`, async () => {
      const res = await get(host, "page.html");
      expect(res.status).toBe(200);
      expect(res.body).toContain('src="/sdk.js?v=');
      expect(res.headers["content-security-policy"]).toBe(
        "sandbox allow-scripts",
      );
    });

    it(`${arm} arm: svg carries the CSP sandbox`, async () => {
      const res = await get(host, "art.svg");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^image\/svg\+xml/);
      expect(res.headers["content-security-policy"]).toBe(
        "sandbox allow-scripts",
      );
    });

    it(`${arm} arm: pdf carries NO CSP (Chromium's viewer won't run under it)`, async () => {
      const res = await get(host, "doc.pdf");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^application\/pdf/);
      expect(res.headers["content-security-policy"]).toBeUndefined();
    });

    it(`${arm} arm: an error response is confined too`, async () => {
      const res = await get(host, "missing.html");
      expect(res.status).toBe(404);
      expect(res.headers["content-security-policy"]).toBe(
        "sandbox allow-scripts",
      );
    });
  }

  it("remote arm: the CSP is added by kolu-server — the padi headers lacked it", async () => {
    remoteHeaders.length = 0;
    const res = await get(REMOTE, "page.html");
    expect(res.headers["content-security-policy"]).toBe(
      "sandbox allow-scripts",
    );
    expect(remoteHeaders.length).toBeGreaterThan(0);
    for (const h of remoteHeaders)
      expect(
        Object.keys(h).some(
          (k) => k.toLowerCase() === "content-security-policy",
        ),
      ).toBe(false);
  });

  it("remote arm: a padi's own weaker CSP is replaced, not merged", async () => {
    const res = await get(REMOTE, "weak.html");
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(
      "sandbox allow-scripts",
    );
  });
});

/**
 * The socket, end to end: a dist `buildSurfaceClient` wrote, served by the
 * `freshStaticLayer` it was written for.
 *
 * The defect this pins is not a bug in either half — each half was right on its
 * own. The server has negotiated `br`/`zstd`/`gzip` since it replaced Hono's
 * `serve-static`; the builder emitted content-hashed assets behind a `no-store`
 * shell. What was missing was any place the two were checked against each other,
 * so a build could ship a dist its own server could only half serve, and did:
 * every consumer's hand-rolled post-step wrote `.br` and `.gz` and none wrote the
 * `.zst` the server PREFERS. A comment cannot catch that. A request can.
 *
 * So every assertion below goes through the real layer: build the dist, ask for
 * each encoding a client would offer, and require that what comes back
 * decompresses to the identity bytes. The bundler itself is a stand-in
 * (`./bunRuntime.testlib` says why); everything downstream of it — prune,
 * compression, the shell rewrite, the static layer — is the shipping code.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  brotliDecompressSync,
  gunzipSync,
  zstdDecompressSync,
} from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSurfaceClient } from "./bun";
import { installStandInBun, type StandInBun } from "./bunRuntime.testlib";
import { drive } from "./httpDrive.testlib";
import { ASSET_DIR, PRECOMPRESSED_ENCODINGS } from "./index";
import { freshStaticLayer } from "./server";

const DECODE: Record<string, (bytes: Buffer) => Buffer> = {
  br: brotliDecompressSync,
  zstd: zstdDecompressSync,
  gzip: gunzipSync,
};

/** A client entry big and repetitive enough to be worth compressing — a real
 *  one is megabytes. The marker splits off the half the stand-in bundler emits
 *  as a dynamic-import chunk. */
const clientSource = (label: string): string =>
  [
    `export const label = ${JSON.stringify(label)};`,
    ...Array.from(
      { length: 80 },
      (_, i) => `export const pad${i} = "the quick brown fox jumps over ${i}";`,
    ),
    "//--dynamic--",
    ...Array.from(
      { length: 80 },
      (_, i) => `export const heavy${i} = "a markdown pipeline weighs ${i}";`,
    ),
  ].join("\n");

const TEMPLATE = `<!doctype html>
<html><head><title>t</title><link rel="stylesheet" href="./styles.css" /></head>
<body><script type="module" src="./main.ts"></script></body></html>
`;

describe("buildSurfaceClient — the dist freshStaticLayer is built to serve", () => {
  let work: string;
  let clientDir: string;
  let distDir: string;
  let stand: StandInBun;

  const build = (label = "one") => {
    writeFileSync(join(clientDir, "main.ts"), clientSource(label));
    return buildSurfaceClient({
      entrypoint: join(clientDir, "main.ts"),
      distDir,
      htmlTemplate: join(clientDir, "index.html"),
      entryHtmlPlaceholder: `src="./main.ts"`,
      commit: "abc1234",
      extraAssets: [
        {
          name: "styles",
          ext: "css",
          build: () =>
            Buffer.from(
              Array.from({ length: 60 }, (_, i) => `.c${i}{color:#fff}`).join(
                "\n",
              ),
            ),
          htmlPlaceholder: `href="./styles.css"`,
        },
      ],
    });
  };

  const assetsDir = () => join(distDir, ASSET_DIR);
  const names = () => readdirSync(assetsDir()).sort();

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "dist-socket-"));
    clientDir = join(work, "client");
    distDir = join(work, "dist");
    mkdirSync(clientDir);
    writeFileSync(join(clientDir, "index.html"), TEMPLATE);
    stand = installStandInBun();
  });
  afterEach(() => {
    stand.restore();
    rmSync(work, { recursive: true, force: true });
  });

  it("serves every sibling it emitted, decoding back to the identity bytes", async () => {
    // The whole contract in one loop: for each asset the build reported a
    // sibling for, ask the layer for that encoding the way a browser would and
    // require the response to BE that asset. A sibling the server declines (or
    // one written under a suffix it does not know) fails here.
    const { assets } = await build();
    const layer = freshStaticLayer({ root: distDir });
    let checked = 0;
    for (const asset of assets) {
      const identity = await drive(layer, `/${ASSET_DIR}/${asset.file}`, {
        "Accept-Encoding": "identity",
      });
      for (const encoding of Object.keys(asset.siblings)) {
        const res = await drive(layer, `/${ASSET_DIR}/${asset.file}`, {
          "Accept-Encoding": encoding,
        });
        expect(res.status).toBe(200);
        expect(res.header("Content-Encoding")).toBe(encoding);
        expect(res.header("Vary")).toContain("Accept-Encoding");
        expect(DECODE[encoding]!(res.bytes)).toEqual(identity.bytes);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("emits EVERY encoding the server negotiates — the .zst nobody was writing", async () => {
    // The regression with a name: the server has preferred `zstd` all along, and
    // for as long as each consumer hand-rolled the post-step, the preferred
    // encoding simply was not on disk. Both halves read one table now, so this
    // asserts against the table rather than against three literals.
    const { assets, jsHref } = await build();
    const entry = assets.find((a) => jsHref.endsWith(a.file));
    expect(entry).toBeDefined();
    expect(Object.keys(entry!.siblings).sort()).toEqual(
      PRECOMPRESSED_ENCODINGS.map(([encoding]) => encoding).sort(),
    );
  });

  it("leaves the no-store shell uncompressed, with no sibling to be tempted by", async () => {
    // kolu#1319: a compressed shell is how a returning browser gets pinned to a
    // stale post-build stamp. The layer refuses to negotiate outside the asset
    // prefix, and the builder never writes a shell sibling in the first place —
    // both halves, so neither is the only thing standing between them.
    await build();
    expect(existsSync(join(distDir, "index.html.br"))).toBe(false);
    const res = await drive(
      freshStaticLayer({ root: distDir }),
      "/index.html",
      {
        "Accept-Encoding": "br, zstd, gzip",
      },
    );
    expect(res.status).toBe(200);
    expect(res.header("Content-Encoding")).toBeUndefined();
    expect(res.header("Cache-Control")).toBe("no-store");
    expect(res.text).toContain("__SURFACE_APP_COMMIT__");
  });

  it("splits a dynamic import into its own hashed, immutable, negotiable chunk", async () => {
    // What `splitting: false` cost: a consumer that wrote `import()` got it
    // inlined, so the only way to actually defer bytes was a second `Bun.build`
    // plus a hand-rewrite of the shell this helper had just written.
    const { assets } = await build();
    expect(stand.builds[0]!.splitting).toBe(true);
    const chunk = assets.find((a) => a.file.startsWith("chunk-"));
    expect(chunk).toBeDefined();
    // A chunk pinned `immutable` for a year is only safe because it is hashed.
    expect(chunk!.file).toMatch(/^chunk-[0-9a-f]{8}\.js$/);
    const res = await drive(
      freshStaticLayer({ root: distDir }),
      `/${ASSET_DIR}/${chunk!.file}`,
      { "Accept-Encoding": "br" },
    );
    expect(res.header("Content-Encoding")).toBe("br");
    expect(res.header("Cache-Control")).toContain("immutable");
  });

  it("skips sourcemaps — they are not on the first-paint path", async () => {
    await build();
    const maps = names().filter((n) => n.endsWith(".js.map"));
    expect(maps.length).toBeGreaterThan(0);
    for (const map of maps) {
      for (const [, suffix] of PRECOMPRESSED_ENCODINGS) {
        expect(existsSync(join(assetsDir(), map + suffix))).toBe(false);
      }
    }
  });

  it("prunes the previous build out of the hashed dir instead of growing it", async () => {
    // The dev tax this kills: a dist that is never pruned keeps every old hashed
    // asset AND every old sibling, so each rebuild pays brotli over a pile
    // nothing can request — the hashed name that makes an old asset unreachable
    // is the same fact that makes deleting it safe.
    const first = await build("one");
    const before = names();
    const second = await build("two");
    const after = names();
    expect(second.jsHref).not.toBe(first.jsHref);
    expect(after).not.toEqual(before);
    for (const name of after) {
      expect(
        name.startsWith("chunk-") ||
          name.startsWith("main-") ||
          name.startsWith("styles-"),
      ).toBe(true);
    }
    // Nothing from the first build survived — not the asset, not its siblings.
    const stale = first.jsHref.split("/").pop()!;
    expect(after.some((n) => n.startsWith(stale))).toBe(false);
  });

  it("does not recompress a sibling that already sits beside an unchanged asset", async () => {
    // Content hashing is what makes the skip sound: same name ⇒ same bytes ⇒ the
    // sibling beside it was compressed FROM those bytes and cannot be stale.
    const suffixes = PRECOMPRESSED_ENCODINGS.map(([, suffix]) => suffix);
    const isSibling = (name: string) => suffixes.some((s) => name.endsWith(s));
    await build("one");
    const stamps = new Map(
      names()
        .filter(isSibling)
        .map((n) => [n, statSync(join(assetsDir(), n)).mtimeMs]),
    );
    expect(stamps.size).toBeGreaterThan(0);
    await build("one");
    // The bundler rewrites the primaries either way; what must NOT be paid again
    // is the compression beside them.
    expect(names().filter(isSibling)).toEqual([...stamps.keys()]);
    for (const [name, mtime] of stamps) {
      expect(statSync(join(assetsDir(), name)).mtimeMs).toBe(mtime);
    }
  });
});

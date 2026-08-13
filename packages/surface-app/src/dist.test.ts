/**
 * The socket, end to end: a dist `buildSurfaceClient` wrote, served by the
 * `freshStaticLayer` it was written for.
 *
 * The defect this pins is not a bug in either half — each half was right on its
 * own. The server has negotiated `br`/`zstd`/`gzip` since it replaced Hono's
 * `serve-static`; the builder emitted content-hashed assets behind a `no-store`
 * shell. What was missing was any place the two were checked against each other,
 * so a build could ship a dist its own server could only half serve, and did:
 * every consumer's hand-rolled post-step wrote `.br` and `.gz`, and none wrote
 * the `.zst` the server has been able to serve since day one — so that arm of
 * the negotiation never once ran in production. A comment cannot catch that. A
 * request can.
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
  readFileSync,
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

/** 80 repetitive exports — the bulk that makes a fixture worth compressing at
 *  all (a real client entry is megabytes). */
const half = (prefix: string, text: string): string =>
  Array.from(
    { length: 80 },
    (_, i) => `export const ${prefix}${i} = "${text} ${i}";`,
  ).join("\n");

/** A client entry, composed from the halves it should split INTO. The markers
 *  are the stand-in bundler's protocol for "this half becomes its own chunk", so
 *  the three fixtures below are BUILT from them rather than carved back out of a
 *  bigger one — a marker that changes then breaks the protocol in one place,
 *  loudly, instead of silently producing a fixture that no longer splits. */
const entrySource = (label: string, ...halves: readonly string[]): string =>
  [
    `export const label = ${JSON.stringify(label)};`,
    half("pad", "the quick brown fox jumps over"),
    ...halves,
  ].join("\n");

/** The half the entry STATICALLY imports — what a real bundler hoists when the
 *  entry and the deferred half both need it, and the one worth preloading. */
const SHARED = ["//--shared--", half("common", "both halves parse markdown")];
/** The half an `import()` defers — the one that must never be preloaded. */
const DYNAMIC = ["//--dynamic--", half("heavy", "a markdown pipeline weighs")];

/** The ordinary split app: a shared chunk and a deferred one. */
const splitSource = (label = "one"): string =>
  entrySource(label, ...SHARED, ...DYNAMIC);

/** An app that writes `import()` and shares nothing with it, so the only chunk
 *  is deferred. */
const dynamicOnlySource = (): string => entrySource("lazy", ...DYNAMIC);

/** An entry that splits into nothing — one entrypoint, no `import()`. Most apps.
 */
const noSplitSource = (): string => entrySource("solo");

const TEMPLATE = `<!doctype html>
<html><head><title>t</title><link rel="stylesheet" href="./styles.css" /></head>
<body><script type="module" src="./main.ts"></script></body></html>
`;

describe("buildSurfaceClient — the dist freshStaticLayer is built to serve", () => {
  let work: string;
  let clientDir: string;
  let distDir: string;
  let stand: StandInBun;

  const build = (source = splitSource()) => {
    writeFileSync(join(clientDir, "main.ts"), source);
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
          // Comfortably over MIN_BYTES: a real extra asset is a Tailwind
          // bundle, and a fixture under the threshold would make every
          // assertion about extra-asset compression vacuously true.
          build: () =>
            Buffer.from(
              Array.from(
                { length: 200 },
                (_, i) => `.class-number-${i} { color: #ffffff; }`,
              ).join("\n"),
            ),
          htmlPlaceholder: `href="./styles.css"`,
        },
      ],
    });
  };

  const assetsDir = () => join(distDir, ASSET_DIR);
  const names = () => readdirSync(assetsDir()).sort();
  /** The shell as it was written to the dist — what a browser is actually served. */
  const shell = () => readFileSync(join(distDir, "index.html"), "utf8");

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
    // The regression with a name: the server has been able to serve `zstd` all
    // along, and for as long as each consumer hand-rolled the post-step it was
    // simply not on disk anywhere.
    //
    // Asserted against LITERALS, not against the table. Comparing the emitter to
    // the table proves only that the two halves agree — which they would also do
    // if the table quietly lost a row, since both read it. `index.test.ts` pins
    // the table's own contents; this pins what a built dist actually carries.
    const { assets, jsHref } = await build();
    const entry = assets.find((a) => jsHref.endsWith(a.file));
    expect(entry).toBeDefined();
    expect(Object.keys(entry!.siblings).sort()).toEqual(["br", "gzip", "zstd"]);
    for (const suffix of [".br", ".zst", ".gz"]) {
      expect(existsSync(join(assetsDir(), entry!.file + suffix))).toBe(true);
    }
  });

  it("compresses an EXTRA asset too — the Tailwind-sized one an app hands in", async () => {
    // An extra asset is bytes the app produced, not bytes the bundler emitted,
    // so it travels a different path into the hashed dir and could plausibly
    // miss the emitter entirely. It is also the second-largest thing a real app
    // ships.
    const { assets, assetHrefs } = await build();
    const styles = assets.find((a) => assetHrefs.styles!.endsWith(a.file));
    expect(styles).toBeDefined();
    expect(styles!.file).toMatch(/^styles-[0-9a-f]+\.css$/);
    expect(Object.keys(styles!.siblings).sort()).toEqual([
      "br",
      "gzip",
      "zstd",
    ]);
    const res = await drive(
      freshStaticLayer({ root: distDir }),
      `/${ASSET_DIR}/${styles!.file}`,
      { "Accept-Encoding": "zstd" },
    );
    expect(res.header("Content-Encoding")).toBe("zstd");
    expect(res.header("Content-Type")).toContain("css");
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

  it("preloads the entry's STATIC chunk from the shell — the round trip splitting adds, handed back", async () => {
    // What splitting costs and nothing else pays back: the entry imports the
    // shared chunk at its top, so a browser given only the entry's URL cannot
    // ask for that file until the entry has been fetched AND parsed. The shell
    // knows the name now, so it says it now.
    const { assets, jsHref } = await build();
    const shared = assets.find((a) => a.file.startsWith("shared-"));
    expect(shared).toBeDefined();
    const html = shell();
    expect(html).toContain(
      `<link rel="modulepreload" href="/${ASSET_DIR}/${shared!.file}">`,
    );
    // Exactly one — the entry has exactly one static chunk here, and a second
    // tag would mean something else (the dynamic chunk, the entry itself) crept
    // into the walk.
    expect(html.match(/rel="modulepreload"/g)).toHaveLength(1);
    // First thing in the head, and so ahead of the script that needs it: a
    // preload the parser reaches after the entry saves nothing at all.
    expect(html.indexOf("modulepreload")).toBeLessThan(html.indexOf(jsHref));
    expect(html.indexOf("modulepreload")).toBeLessThan(
      html.indexOf("__SURFACE_APP_COMMIT__"),
    );
    // Same reason the `splitting` pin above exists: the chunk graph is reported
    // only because the config asks for it, and nothing else here would notice
    // the ask going missing.
    expect(stand.builds[0]!.metafile).toBe(true);
  });

  it("fails loud when the bundler reports no chunk graph", async () => {
    // The arm the throw exists for: a Bun that ignored `metafile: true` hands
    // back exactly this. The alternative to saying so is a shell that quietly
    // drops back to costing the round trip the tags were added to save — and a
    // silent regression in a build nobody re-inspects.
    stand.restore();
    stand = installStandInBun({ withholdMetafile: true });
    await expect(build()).rejects.toThrow(/metafile/);
  });

  it("does NOT preload the dynamic chunk — that would undo the very split it rides on", async () => {
    // The failure this forbids is the tempting one: preload everything the build
    // emitted, and `import()` becomes a slower way to fetch the bytes eagerly.
    const { assets } = await build(dynamicOnlySource());
    const deferred = assets.find((a) => a.file.startsWith("chunk-"));
    expect(deferred).toBeDefined();
    const html = shell();
    expect(html).not.toContain(deferred!.file);
    expect(html).not.toContain("modulepreload");
  });

  it("leaves a shell alone when the entry split into nothing — no empty artifact", async () => {
    // Most apps. A helper shared by every consumer must add nothing at all to
    // the one that has nothing to add.
    const { assets } = await build(noSplitSource());
    expect(assets.some((a) => a.file.endsWith(".js"))).toBe(true);
    expect(assets.some((a) => a.file.startsWith("chunk-"))).toBe(false);
    expect(assets.some((a) => a.file.startsWith("shared-"))).toBe(false);
    expect(shell()).not.toContain("modulepreload");
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
    const first = await build(splitSource("one"));
    const before = names();
    const second = await build(splitSource("two"));
    const after = names();
    expect(second.jsHref).not.toBe(first.jsHref);
    expect(after).not.toEqual(before);
    for (const name of after) {
      expect(
        name.startsWith("chunk-") ||
          name.startsWith("shared-") ||
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
    await build();
    const stamps = new Map(
      names()
        .filter(isSibling)
        .map((n) => [n, statSync(join(assetsDir(), n)).mtimeMs]),
    );
    expect(stamps.size).toBeGreaterThan(0);
    await build();
    // The bundler rewrites the primaries either way; what must NOT be paid again
    // is the compression beside them.
    expect(names().filter(isSibling)).toEqual([...stamps.keys()]);
    for (const [name, mtime] of stamps) {
      expect(statSync(join(assetsDir(), name)).mtimeMs).toBe(mtime);
    }
  });
});

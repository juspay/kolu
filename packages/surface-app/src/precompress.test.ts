/**
 * The emitter's own rules, at close range: which files get a sibling, which are
 * left alone, and what a rebuild is allowed to cost.
 *
 * `dist.test.ts` proves the siblings this writes are the ones the server serves;
 * this file is about the decisions that never reach the wire — the `.png` that
 * must not be wrapped, the 40-byte file whose "compressed" form is bigger, and
 * the previous build that must not still be sitting there paying brotli.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRECOMPRESSED_ENCODINGS } from "./index";
import { precompressAssets, pruneAssets } from "./precompress";

const BIG = Array.from(
  { length: 200 },
  (_, i) => `export const value${i} = "compress me";`,
).join("\n");

describe("precompressAssets", () => {
  let dir: string;
  const write = (name: string, content: string | Buffer) =>
    writeFileSync(join(dir, name), content);
  const has = (name: string) => existsSync(join(dir, name));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "precompress-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes one sibling per encoding the server negotiates, each smaller than identity", async () => {
    write("main-a1b2c3d4.js", BIG);
    const [report] = await precompressAssets(dir);
    for (const [encoding, suffix] of PRECOMPRESSED_ENCODINGS) {
      expect(has(`main-a1b2c3d4.js${suffix}`)).toBe(true);
      expect(report!.siblings[encoding]).toBeLessThan(report!.bytes);
    }
    const br = readFileSync(join(dir, "main-a1b2c3d4.js.br"));
    expect(brotliDecompressSync(br).toString()).toBe(BIG);
  });

  it("never compresses a media type the server would refuse to serve compressed", async () => {
    // Writing a `.png.br` is not a bug the server can be hurt by — it refuses
    // already-compressed types — it is just a file nothing will ever read.
    write("logo-a1b2c3d4.png", Buffer.alloc(4096, 7));
    write("photo-a1b2c3d4.woff2", Buffer.alloc(4096, 9));
    const reports = await precompressAssets(dir);
    expect(reports).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual([
      "logo-a1b2c3d4.png",
      "photo-a1b2c3d4.woff2",
    ]);
  });

  it("leaves a tiny file alone, and reports it honestly rather than silently", async () => {
    write("tiny-a1b2c3d4.js", "export const a = 1;\n");
    const [report] = await precompressAssets(dir);
    expect(report).toEqual({
      file: "tiny-a1b2c3d4.js",
      bytes: 20,
      siblings: {},
    });
    expect(readdirSync(dir)).toEqual(["tiny-a1b2c3d4.js"]);
  });

  it("is not fed its own output — a sibling is never itself compressed", async () => {
    write("main-a1b2c3d4.js", BIG);
    await precompressAssets(dir);
    const after = readdirSync(dir).sort();
    await precompressAssets(dir);
    expect(readdirSync(dir).sort()).toEqual(after);
    expect(has("main-a1b2c3d4.js.br.br")).toBe(false);
  });

  it("reports an existing sibling's real size rather than claiming none", async () => {
    // A rebuild skips work it already did; a report that then said "no siblings"
    // would make the skip look like a regression to whoever reads the build log.
    write("main-a1b2c3d4.js", BIG);
    const [first] = await precompressAssets(dir);
    const [second] = await precompressAssets(dir);
    expect(second).toEqual(first);
  });
});

describe("pruneAssets", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prune-"));
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps this build's files with their siblings and sourcemaps, and drops the rest", async () => {
    const live = ["main-new.js", "styles-new.css"];
    for (const name of [
      "main-new.js",
      "main-new.js.br",
      "main-new.js.map",
      "styles-new.css",
      "old-gone.js",
      "old-gone.js.br",
      "old-gone.js.map",
    ]) {
      writeFileSync(join(dir, name), "x");
    }
    const removed = await pruneAssets(dir, live);
    expect([...removed].sort()).toEqual([
      "old-gone.js",
      "old-gone.js.br",
      "old-gone.js.map",
    ]);
    expect(readdirSync(dir).sort()).toEqual([
      "main-new.js",
      "main-new.js.br",
      "main-new.js.map",
      "styles-new.css",
    ]);
  });
});

/**
 * A stand-in `Bun` global, so kolu's own suite can drive `buildSurfaceClient`.
 *
 * kolu has no Bun: its client is Vite-built and the devShell ships none, while
 * `./bun` is the build path drishti and olai run under `bun`. That is a fine
 * reason to leave the BUNDLER untested here — Bun's own splitting is Bun's to
 * get right — and no reason at all to leave the CONTRACT untested, because the
 * contract is the part that was broken: what lands in the hashed dir, what gets
 * a precompressed sibling, what the shell ends up naming, and whether
 * `freshStaticLayer` can then serve every byte of it.
 *
 * So the bundling is a stand-in and everything downstream of it is real: real
 * files on a real temp dist, the real prune, the real brotli/zstd/gzip, and the
 * real static layer reading them back off disk (`dist.test.ts`). The stand-in
 * emits what a real `Bun.build` emits — a hashed entry, a hashed chunk when
 * `splitting` is on and the source dynamically imports, and linked sourcemaps —
 * and records the config it was handed, so the test can also pin the two build
 * settings the freshness contract rests on rather than trusting a comment.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

/** The `Bun.build` config as `./bun` writes it — the fields this stand-in reads
 *  or a test asserts on. Structural, like `./bun`'s own view of the runtime. */
export interface RecordedBuildConfig {
  entrypoints: string[];
  outdir: string;
  naming?: { entry: string; chunk: string; asset: string };
  splitting?: boolean;
  format?: string;
  sourcemap?: string;
  [extra: string]: unknown;
}

export interface StandInBun {
  /** The configs `buildSurfaceClient` handed `Bun.build`, in call order. */
  readonly builds: RecordedBuildConfig[];
  /** Restore whatever `globalThis.Bun` was before (usually nothing). */
  restore(): void;
}

/** Deterministic 8-hex-char stand-in for `Bun.hash` — the point is that equal
 *  bytes give an equal name, which is the whole basis of the immutable pin. */
const hash8 = (data: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h = Math.imul(h ^ data.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

const render = (pattern: string, name: string, content: string): string =>
  pattern
    .replace("[name]", name)
    .replace("[hash]", hash8(content))
    .replace("[ext]", "js");

/**
 * Install the stand-in on `globalThis.Bun`.
 *
 * `build` writes the entry from the entrypoint's own source; when the source
 * contains a `import(` and `splitting` is on, the dynamically imported half is
 * emitted as a SEPARATE hashed chunk the entry names by a relative URL — which
 * is exactly the shape whose absence made every consumer stand up a second
 * `Bun.build` of its own.
 */
export const installStandInBun = (): StandInBun => {
  const previous = (globalThis as { Bun?: unknown }).Bun;
  const builds: RecordedBuildConfig[] = [];

  const build = async (config: RecordedBuildConfig) => {
    builds.push(config);
    const naming = config.naming;
    if (naming === undefined)
      throw new Error("stand-in Bun.build: no `naming` — nothing would hash");
    const entrypoint = config.entrypoints[0]!;
    const source = readFileSync(entrypoint, "utf8");
    const outputs: { path: string; kind: string }[] = [];

    const emit = (fileName: string, content: string, kind: string): string => {
      const path = join(config.outdir, fileName);
      writeFileSync(path, content);
      outputs.push({ path, kind });
      if (config.sourcemap === "linked") {
        writeFileSync(`${path}.map`, `{"version":3,"file":"${fileName}"}`);
        outputs.push({ path: `${path}.map`, kind: "sourcemap" });
      }
      return fileName;
    };

    // The dynamically-imported half, split out only when splitting is on —
    // otherwise it is inlined into the entry, which is precisely the old
    // behaviour (deferred in evaluation, identical on the wire).
    const [head, dynamic = ""] = source.split("//--dynamic--\n");
    let entrySource = source;
    if (dynamic !== "" && config.splitting === true) {
      const chunkName = emit(
        render(naming.chunk, "chunk", dynamic),
        dynamic,
        "chunk",
      );
      entrySource = `${head}await import("./${chunkName}");\n`;
    }
    const entryBase = basename(entrypoint, extname(entrypoint));
    emit(
      render(naming.entry, entryBase, entrySource),
      entrySource,
      "entry-point",
    );
    return { success: true, logs: [], outputs };
  };

  (globalThis as { Bun?: unknown }).Bun = {
    build,
    hash: (data: string | ArrayBuffer | Uint8Array) =>
      BigInt(
        `0x${hash8(
          typeof data === "string"
            ? data
            : Buffer.from(data as ArrayBuffer).toString("utf8"),
        )}`,
      ),
    file: (path: string) => ({
      text: async () => readFileSync(path, "utf8"),
      arrayBuffer: async () => new Uint8Array(readFileSync(path)).buffer,
      exists: async () => {
        try {
          readFileSync(path);
          return true;
        } catch {
          return false;
        }
      },
    }),
    write: async (path: string, data: string | ArrayBuffer | Uint8Array) => {
      const bytes =
        typeof data === "string"
          ? Buffer.from(data)
          : Buffer.from(data as never);
      writeFileSync(path, bytes);
      return bytes.byteLength;
    },
  };

  return {
    builds,
    restore: () => {
      (globalThis as { Bun?: unknown }).Bun = previous;
    },
  };
};

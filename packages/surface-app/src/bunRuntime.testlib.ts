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
 * emits what a real `Bun.build` emits — a hashed entry, hashed chunks when
 * `splitting` is on and the source splits, linked sourcemaps, and the metafile
 * describing which output imports which and how — and records the config it was
 * handed, so the test can also pin the build settings the freshness contract
 * rests on rather than trusting a comment.
 *
 * The metafile is written from what this emitter itself did — and each output's
 * SOURCE is written from the same edge list the metafile records, so the emitted
 * bytes cannot claim a different graph than the record does. Its shape is a
 * copy of a real `Bun.build` metafile (bun 1.3.13): outputs keyed `./<file>`,
 * each with `imports: [{ path, kind }]` where `kind` is `import-statement` for a
 * shared chunk and `dynamic-import` for a deferred one, and sourcemaps absent.
 * `modulePreload.test.ts` pins the walk against a metafile captured from a real
 * bun build, so the shape here is checked against the real thing rather than
 * being the only description of it.
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
  metafile?: boolean;
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

/** Shapes of `Bun.build` a test needs to DRIVE and a fixture cannot otherwise
 *  produce. These are test-double knobs, not a mirror of any option the shipping
 *  build has — `buildSurfaceClient` takes no flags at all (see `./bun`). */
export interface StandInBunOptions {
  /** Report NO metafile even though the config asked for one — exactly what a
   *  Bun that ignored `metafile: true` would hand back. `buildSurfaceClient`'s
   *  fail-loud check is the only thing between that and a shell that silently
   *  drops back to costing the extra round trip, so it is driven by a test
   *  rather than described by a comment. */
  withholdMetafile?: boolean;
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
 * `build` writes the entry from the entrypoint's own source. It does NOT parse
 * JavaScript: the fixture marks its halves with literal `//--shared--` and
 * `//--dynamic--` lines, and when `splitting` is on each is emitted as a
 * SEPARATE hashed chunk the entry names by a relative URL — the `//--shared--`
 * half the way a real bundler hoists code the entry and the deferred chunk both
 * need (a STATIC import of the entry, which is what earns a modulepreload), the
 * `//--dynamic--` half the way an `import()` defers one. A fixture that writes a
 * real `import("./x")` and no marker gets no chunk here, which is a limit of the
 * stand-in and not a statement about Bun.
 */
export const installStandInBun = (
  options: StandInBunOptions = {},
): StandInBun => {
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
    const graph: Record<string, { imports: { path: string; kind: string }[] }> =
      {};

    /** The statements an output's outgoing edges are written as. One output's
     *  imports are stated ONCE — in the edge list the metafile records — and its
     *  bytes are rendered FROM that list, so the emitted source can never claim
     *  a different graph than the metafile does. */
    const importStatements = (
      imports: { path: string; kind: string }[],
    ): string =>
      imports
        .map((i) =>
          i.kind === "dynamic-import"
            ? `await import(${JSON.stringify(i.path)});\n`
            : `import ${JSON.stringify(i.path)};\n`,
        )
        .join("");

    const emit = (
      pattern: string,
      stem: string,
      body: string,
      kind: string,
      imports: { path: string; kind: string }[] = [],
    ): string => {
      const content = importStatements(imports) + body;
      // Hashed over what is actually written, so equal bytes keep their name —
      // the whole basis of the immutable pin.
      const fileName = render(pattern, stem, content);
      const path = join(config.outdir, fileName);
      writeFileSync(path, content);
      outputs.push({ path, kind });
      // Keyed and referenced the way a real metafile is: relative to the outdir,
      // and sourcemaps not among the outputs at all.
      graph[`./${fileName}`] = { imports };
      if (config.sourcemap === "linked") {
        writeFileSync(`${path}.map`, `{"version":3,"file":"${fileName}"}`);
        outputs.push({ path: `${path}.map`, kind: "sourcemap" });
      }
      return fileName;
    };

    // The two split halves, emitted only when splitting is on — otherwise both
    // are inlined into the entry, which is precisely the old behaviour
    // (deferred in evaluation, identical on the wire).
    const [beforeDynamic = "", dynamic] = source.split("//--dynamic--\n");
    const [head = "", shared] = beforeDynamic.split("//--shared--\n");

    let entryBody = source;
    const entryImports: { path: string; kind: string }[] = [];
    if (
      config.splitting === true &&
      (shared !== undefined || dynamic !== undefined)
    ) {
      entryBody = head;
      let sharedName: string | undefined;
      if (shared !== undefined) {
        sharedName = emit(naming.chunk, "shared", shared, "chunk");
        entryImports.push({
          path: `./${sharedName}`,
          kind: "import-statement",
        });
      }
      if (dynamic !== undefined) {
        // The deferred chunk needs the shared half too — that is WHY the shared
        // half is its own chunk rather than part of either one.
        const chunkName = emit(
          naming.chunk,
          "chunk",
          dynamic,
          "chunk",
          sharedName === undefined
            ? []
            : [{ path: `./${sharedName}`, kind: "import-statement" }],
        );
        entryImports.push({ path: `./${chunkName}`, kind: "dynamic-import" });
      }
    }
    const entryBase = basename(entrypoint, extname(entrypoint));
    emit(naming.entry, entryBase, entryBody, "entry-point", entryImports);
    return {
      success: true,
      logs: [],
      outputs,
      metafile:
        config.metafile === true && options.withholdMetafile !== true
          ? { outputs: graph }
          : undefined,
    };
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

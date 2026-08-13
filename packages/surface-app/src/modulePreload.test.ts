/**
 * The chunk-graph walk that decides what the shell preloads.
 *
 * kolu has no Bun (see `./bunRuntime.testlib`), so the risk this file exists to
 * cover is not the algorithm — it is READING BUN WRONG. The first fixture is
 * therefore not invented: it is the metafile a real `bun 1.3.13` printed for a
 * split entry, pasted verbatim. Everything else the walk has to survive (a
 * transitive chunk, a diamond, a cycle, an import that is not an output) is a
 * hand-built graph, because those shapes are properties of module graphs in
 * general and not of any one build.
 */

import { describe, expect, it } from "vitest";
import {
  type ChunkGraph,
  modulePreloadLinks,
  staticImportChunks,
} from "./modulePreload";

/**
 * `Bun.build({ metafile: true })`, bun 1.3.13, for an entry that imports a
 * shared module and `import()`s a heavy one:
 *
 *     main.ts  ──static──▶ shared.ts ──▶ base.ts
 *        └────dynamic───▶ heavy.ts  ──▶ base.ts
 *
 * The bundler hoisted `base` into its own chunk (`main-e5h1afbt.js`) because
 * both halves need it — that chunk is a STATIC import of the entry and the one
 * file worth preloading. Two details this pins that a hand-written fixture
 * would have flattered away: the entry lists its DYNAMIC import first, and the
 * dynamic chunk carries an `entryPoint` of its own, so neither "the first
 * import" nor "the output with an entryPoint" is a sound way to read this.
 */
const REAL_BUN_METAFILE = {
  outputs: {
    "./main-dwfpg55a.js": {
      bytes: 183,
      inputs: {
        "src/shared.ts": { bytesInOutput: 43 },
        "src/main.ts": { bytesInOutput: 136 },
      },
      imports: [
        { path: "./heavy-47zas50t.js", kind: "dynamic-import" },
        { path: "./main-e5h1afbt.js", kind: "import-statement" },
      ],
      exports: [],
      entryPoint: "src/main.ts",
    },
    "./main-e5h1afbt.js": {
      bytes: 316,
      inputs: { "src/base.ts": { bytesInOutput: 41 } },
      imports: [],
      exports: [],
    },
    "./heavy-47zas50t.js": {
      bytes: 75,
      inputs: { "src/heavy.ts": { bytesInOutput: 34 } },
      imports: [{ path: "./main-e5h1afbt.js", kind: "import-statement" }],
      exports: ["heavy"],
      entryPoint: "src/heavy.ts",
    },
  },
};

/** A graph in the shape the walk cares about, spelled as `chunk: [edges]`. */
const graph = (outputs: Record<string, [string, string][]>): ChunkGraph => ({
  outputs: Object.fromEntries(
    Object.entries(outputs).map(([file, edges]) => [
      `./${file}`,
      { imports: edges.map(([path, kind]) => ({ path: `./${path}`, kind })) },
    ]),
  ),
});

describe("staticImportChunks", () => {
  it("preloads the shared chunk a real bun build split out, and only it", () => {
    expect(staticImportChunks(REAL_BUN_METAFILE, "main-dwfpg55a.js")).toEqual([
      "main-e5h1afbt.js",
    ]);
  });

  it("does NOT preload a dynamic chunk — that would undo the split it was written for", () => {
    // The whole point of `import()` is bytes NOT fetched on first paint. A
    // preload for `heavy-47zas50t.js` would fetch them anyway, and the app would
    // be paying for code splitting while getting none of it.
    const preloads = staticImportChunks(REAL_BUN_METAFILE, "main-dwfpg55a.js");
    expect(preloads).not.toContain("heavy-47zas50t.js");
  });

  it("walks transitively — a static chunk's own static imports load before it runs too", () => {
    // The browser must fetch `b` before `a` can execute, so discovering `b` only
    // after `a` has parsed is the same round trip one level down.
    const chunks = staticImportChunks(
      graph({
        "main-1.js": [["a-2.js", "import-statement"]],
        "a-2.js": [["b-3.js", "import-statement"]],
        "b-3.js": [["c-4.js", "import-statement"]],
        "c-4.js": [],
      }),
      "main-1.js",
    );
    expect(chunks).toEqual(["a-2.js", "b-3.js", "c-4.js"]);
  });

  it("stops at a dynamic edge — nothing reachable only THROUGH it is preloaded", () => {
    const chunks = staticImportChunks(
      graph({
        "main-1.js": [
          ["a-2.js", "import-statement"],
          ["lazy-3.js", "dynamic-import"],
        ],
        "a-2.js": [],
        // Reachable from the entry, but only by first taking the dynamic edge.
        "lazy-3.js": [["deep-4.js", "import-statement"]],
        "deep-4.js": [],
      }),
      "main-1.js",
    );
    expect(chunks).toEqual(["a-2.js"]);
  });

  it("names a diamond once, in discovery order", () => {
    // Two chunks sharing a third is the ordinary shape, and a duplicated
    // `<link>` is a wasted parse at best.
    const chunks = staticImportChunks(
      graph({
        "main-1.js": [
          ["a-2.js", "import-statement"],
          ["b-3.js", "import-statement"],
        ],
        "a-2.js": [["shared-4.js", "import-statement"]],
        "b-3.js": [["shared-4.js", "import-statement"]],
        "shared-4.js": [],
      }),
      "main-1.js",
    );
    expect(chunks).toEqual(["a-2.js", "b-3.js", "shared-4.js"]);
  });

  it("terminates on a cycle, including one back to the entry", () => {
    const chunks = staticImportChunks(
      graph({
        "main-1.js": [["a-2.js", "import-statement"]],
        "a-2.js": [
          ["b-3.js", "import-statement"],
          ["main-1.js", "import-statement"],
        ],
        "b-3.js": [["a-2.js", "import-statement"]],
      }),
      "main-1.js",
    );
    // The entry is never preloaded: the shell's `<script>` already names it.
    expect(chunks).toEqual(["a-2.js", "b-3.js"]);
  });

  it("emits nothing for an entry that split into nothing", () => {
    // The no-split app — one entrypoint, no `import()` — must come out of this
    // with an untouched shell, not an empty artifact in it.
    expect(staticImportChunks(graph({ "main-1.js": [] }), "main-1.js")).toEqual(
      [],
    );
  });

  it("ignores a static import that is not an output of this build", () => {
    // An external (`https://…`, or anything the bundler left unbundled) is not
    // a file in the hashed dir, so `/assets/<basename>` would 404.
    const chunks = staticImportChunks(
      {
        outputs: {
          "./main-1.js": {
            imports: [
              { path: "https://esm.sh/solid-js", kind: "import-statement" },
              { path: "./a-2.js", kind: "import-statement" },
            ],
          },
          "./a-2.js": { imports: [] },
        },
      },
      "main-1.js",
    );
    expect(chunks).toEqual(["a-2.js"]);
  });

  it("throws when the entry is not in the metafile — a graph it cannot read is not an empty one", () => {
    expect(() =>
      staticImportChunks(graph({ "main-1.js": [] }), "other-9.js"),
    ).toThrow(/other-9\.js/);
  });

  it("does not preload a non-JS static import — `modulepreload` means 'a JS module'", () => {
    // The edge kind and the FILE kind are two questions. A stylesheet the entry
    // `import`s is a real static edge and the wrong tag: fetched as a module,
    // refused on MIME, warned about. Bun 1.3.13 does not record it as an
    // `imports` edge (see `PRELOADABLE`), so this pins the rule, not the
    // bundler — and the walk still passes THROUGH the non-JS output.
    const chunks = staticImportChunks(
      graph({
        "main-1.js": [
          ["styles-2.css", "import-statement"],
          ["a-3.js", "import-statement"],
        ],
        "styles-2.css": [["deep-4.js", "import-statement"]],
        "a-3.js": [],
        "deep-4.js": [],
      }),
      "main-1.js",
    );
    expect(chunks).toEqual(["a-3.js", "deep-4.js"]);
  });
});

describe("modulePreloadLinks", () => {
  it("emits one tag per href, in order, as one string", () => {
    // Pinned as a LITERAL: `rel="modulepreload"` is the whole instruction to the
    // browser, and a test that rebuilt the tag from the same helper would agree
    // with any typo in it.
    expect(
      modulePreloadLinks([
        "/assets/shared-a1b2c3d4.js",
        "/assets/base-e5f6a7b8.js",
      ]),
    ).toBe(
      '<link rel="modulepreload" href="/assets/shared-a1b2c3d4.js">' +
        '<link rel="modulepreload" href="/assets/base-e5f6a7b8.js">',
    );
  });

  it("emits nothing at all for no hrefs", () => {
    expect(modulePreloadLinks([])).toBe("");
  });

  it("refuses an href that is not a plain /path instead of ending the attribute early", () => {
    // The sibling `shellCommitScript` ESCAPES its input because a commit message
    // is arbitrary by nature; a build output name that carries a quote means
    // something upstream is already wrong, so this one refuses.
    expect(() => modulePreloadLinks(['/assets/a".js'])).toThrow(/href/);
    expect(() => modulePreloadLinks(["https://cdn.example/a.js"])).toThrow(
      /plain \/path/,
    );
  });
});

/**
 * The entry's STATIC chunk graph, read off the build's own metafile.
 *
 * Code splitting hands the entry chunks it imports at the top: the module the
 * bundler hoisted out because both the entry and a dynamic chunk need it. The
 * browser cannot know that file exists until it has fetched and PARSED the
 * entry, so a split entry costs one extra round trip on first paint — small in
 * bytes (olai's was 786 on the wire), a whole RTT in time, and paid by every
 * first visit. A `<link rel="modulepreload">` in the shell moves that fetch to
 * the moment the HTML is parsed, in parallel with the entry itself.
 *
 * Which files those are is a question only the BUILD can answer, and only from
 * the graph — which is why this lives beside the build rather than in a
 * consumer's shell template, where it would be a hand-maintained list of hashed
 * filenames that nobody can keep true. Bun answers it directly: `metafile: true`
 * makes `Bun.build` report each output's imports with their kind, so the walk
 * below is a read of the bundler's own record, not a re-derivation of it.
 *
 * The one rule that makes this safe: only `import-statement` edges are
 * followed. A `dynamic-import` chunk is code the app deliberately deferred, and
 * preloading it would fetch on first paint exactly what `import()` was written
 * to NOT fetch — the split, undone by the thing meant to speed it up.
 *
 * The TAG lives here too, beside the walk that decides what goes in it: what
 * `modulepreload` asserts about a file is the same fact the walk filters on
 * (`PRELOADABLE` below), and a package that spelled the two in two modules
 * would be free to change one without the other. Both are internal — the shell
 * is written through `./shellHead`, which owns where the head starts and in
 * what order its prelude is written.
 */

import { basename } from "node:path";

/** One edge out of a built output, as the metafile records it. `kind` is Bun's
 *  `ImportKind` — `"import-statement"`, `"dynamic-import"`, and the rest —
 *  typed as a plain string here for the same reason `./bun` types the runtime
 *  structurally: no upstream type dependency for a two-field shape. */
export interface ChunkImport {
  /** The imported output, as it is named FROM the importer (e.g. `./x-abc.js`). */
  path: string;
  kind: string;
}

/** The slice of `Bun.build`'s metafile this reads: every emitted output and the
 *  edges out of it. Sourcemaps are not outputs here, so they never appear. */
export interface ChunkGraph {
  outputs: Record<string, { imports: readonly ChunkImport[] }>;
}

/** The one edge kind a preload may follow — a plain `import ... from`, which
 *  the browser will fetch before the importer can run either way. Everything
 *  else (most of all `dynamic-import`) is left alone. */
const STATIC_IMPORT = "import-statement";

/** The one FILE kind a preload may name. `modulepreload` asserts the target is
 *  a JavaScript module, so the edge kind above and the file kind here are two
 *  different questions and both have to be asked: an entry that does
 *  `import "./app.css"` has a real static edge to something that is not a
 *  module, and a `.css` fetched as one is requested with a module `Accept`,
 *  refused on MIME, and warned about — a wasted first-paint request for a file
 *  that wanted `rel="stylesheet"`.
 *
 *  Measured, not assumed: a real `bun 1.3.13` build of an entry containing
 *  `import "./app.css"` plus a static and a dynamic chunk records the stylesheet
 *  on the JS output as `"cssBundle": "./main-g7y8rkax.css"` and does NOT list it
 *  in that output's `imports`, so today the edge cannot occur. The gate stays
 *  because what makes it right is the tag's meaning, not this version's
 *  bookkeeping — and it costs one test. */
const PRELOADABLE = /\.js$/;

/** The tags themselves — one `<link rel="modulepreload">` per href, in order,
 *  concatenated (no hrefs ⇒ the empty string). Spelled ONCE, and here rather
 *  than beside the other head injectors, because `rel="modulepreload"` is the
 *  whole instruction to the browser and it is the same assertion `PRELOADABLE`
 *  above filters on.
 *
 *  An href that is not a plain `/path` is REFUSED, not escaped: these are hashed
 *  build outputs named from the app's own source filenames, so a quote in one
 *  means something upstream is already wrong, and interpolating it would end the
 *  attribute early and ship a silently broken shell. (Its sibling
 *  `shellCommitScript` escapes instead — a commit string is arbitrary by nature
 *  and it has no standing to refuse one.) */
export function modulePreloadLinks(hrefs: readonly string[]): string {
  return hrefs
    .map((href) => {
      if (!/^\/[\w./-]+$/.test(href))
        throw new Error(
          `modulePreloadLinks: refusing to write ${JSON.stringify(href)} into an href attribute — a preload URL must be a plain /path`,
        );
      return `<link rel="modulepreload" href="${href}">`;
    })
    .join("");
}

/**
 * The chunks the entry statically imports, transitively, in the order the walk
 * discovers them (the entry's own imports first, then theirs) — the entry
 * itself excluded, since the shell already names it.
 *
 * Deterministic by construction: it is a breadth-first walk of an ordered
 * graph, so the same build emits the same list, and a rebuild of unchanged
 * sources emits a byte-identical shell.
 *
 * Files are compared and returned by BASENAME — the flat hashed-asset dir is
 * how every other name in this build is handled (`produced`, `jsHref`), and it
 * is what a `/assets/<file>` href is built from. A static import that is not an
 * output of this build (an external URL) is not a chunk and is not preloaded,
 * and neither is one that is not a JS module (`PRELOADABLE`).
 */
export function staticImportChunks(
  graph: ChunkGraph,
  entryFile: string,
): readonly string[] {
  const edges = new Map<string, readonly ChunkImport[]>();
  for (const [output, { imports }] of Object.entries(graph.outputs)) {
    edges.set(basename(output), imports);
  }
  if (!edges.has(entryFile))
    throw new Error(
      `staticImportChunks: the build metafile has no output ${entryFile} — the entry's chunk graph cannot be read`,
    );

  // Breadth-first over the outputs. `queue` holds NAMES — the same currency as
  // `seen` — and is appended to while it is iterated; `seen` is seeded with the
  // entry, so a cycle (or a diamond) terminates and each chunk is named exactly
  // once. Nothing is queued that is not a known output, so the lookup cannot
  // miss.
  const seen = new Set([entryFile]);
  const queue = [entryFile];
  const preload: string[] = [];
  for (const file of queue) {
    for (const edge of edges.get(file)!) {
      if (edge.kind !== STATIC_IMPORT) continue;
      const imported = basename(edge.path);
      if (seen.has(imported) || !edges.has(imported)) continue;
      seen.add(imported);
      // The file-kind gate skips the TAG, never the graph: a non-JS output that
      // ever had static edges of its own still gets walked through.
      if (PRELOADABLE.test(imported)) preload.push(imported);
      queue.push(imported);
    }
  }
  return preload;
}

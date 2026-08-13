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

/** The file part of a metafile name (`./main-abc.js` → `main-abc.js`) — the flat
 *  hashed dir is how every other name in this build is handled.
 *
 *  Hand-rolled rather than `basename` from `node:path`, and that is the point:
 *  `./index` re-exports through `./shellHead`, which imports this module, so a
 *  `node:*` edge here would sit in the import graph of a module the BROWSER
 *  reaches (`./lifecycle` → `./index`). Metafile names are always `/`-joined,
 *  which is the whole of what `basename` would add. */
const fileName = (path: string): string =>
  path.slice(path.lastIndexOf("/") + 1);

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
 *  different questions and both have to be asked.
 *
 *  Measured, not assumed: a real `bun 1.3.13` build of an entry containing
 *  `import "./app.css"` plus a static and a dynamic chunk records the stylesheet
 *  on the JS output as `"cssBundle": "./main-g7y8rkax.css"` and does NOT list it
 *  in that output's `imports`, so today this cannot happen. It is checked, and
 *  checked LOUDLY, because of what it would mean if it ever did: a bundler that
 *  emitted a stylesheet as a static import has put a file in the hashed dir that
 *  this builder rewrites no placeholder for, so the shell would name it nowhere
 *  and the app would ship unstyled. Preloading it as a module (fetched with a
 *  module `Accept`, refused on MIME, warned about) would be the small half of
 *  that; skipping it quietly would hide the large half. */
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
 * Files are compared and returned by FILE NAME — the flat hashed-asset dir is
 * how every other name in this build is handled (`produced`, `jsHref`), and it
 * is what a `/assets/<file>` href is built from. A static import that is not an
 * output of this build (an external URL) is not a chunk and is not preloaded;
 * one that IS an output but is not a JS module is refused outright
 * (`PRELOADABLE` says why).
 */
export function staticImportChunks(
  graph: ChunkGraph,
  entryFile: string,
): readonly string[] {
  const edges = new Map<string, readonly ChunkImport[]>();
  for (const [output, { imports }] of Object.entries(graph.outputs)) {
    edges.set(fileName(output), imports);
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
      const imported = fileName(edge.path);
      if (seen.has(imported) || !edges.has(imported)) continue;
      if (!PRELOADABLE.test(imported))
        throw new Error(
          `staticImportChunks: ${file} statically imports ${imported}, which is not a JS module — the shell can neither preload it nor name it, so this build would ship it unreferenced`,
        );
      seen.add(imported);
      preload.push(imported);
      queue.push(imported);
    }
  }
  return preload;
}

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
 * output of this build (an external URL) is not a chunk and is not preloaded.
 */
export function staticImportChunks(
  graph: ChunkGraph,
  entryFile: string,
): readonly string[] {
  const edges = new Map<string, readonly ChunkImport[]>();
  for (const [output, { imports }] of Object.entries(graph.outputs)) {
    edges.set(basename(output), imports);
  }
  const entryEdges = edges.get(entryFile);
  if (entryEdges === undefined)
    throw new Error(
      `staticImportChunks: the build metafile has no output ${entryFile} — the entry's chunk graph cannot be read`,
    );

  // Breadth-first over the outputs: `queue` holds the edge lists still to walk
  // and is appended to while it is iterated. `seen` is seeded with the entry, so
  // a cycle (or a diamond) terminates and each chunk is preloaded exactly once.
  const seen = new Set([entryFile]);
  const queue: (readonly ChunkImport[])[] = [entryEdges];
  const preload: string[] = [];
  for (const outgoing of queue) {
    for (const edge of outgoing) {
      if (edge.kind !== STATIC_IMPORT) continue;
      const imported = basename(edge.path);
      const next = edges.get(imported);
      if (next === undefined || seen.has(imported)) continue;
      seen.add(imported);
      preload.push(imported);
      queue.push(next);
    }
  }
  return preload;
}

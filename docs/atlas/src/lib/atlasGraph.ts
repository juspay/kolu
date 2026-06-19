import type { CollectionEntry } from "astro:content";
import { resolveParents, titleCmp, toRef } from "./indexTree";
import type { NoteRef } from "./indexTree";

// A note→note edge is authored two ways, both already part of the Atlas: a
// same-directory `<slug>.html` link in a note's prose, and a `parents`
// frontmatter entry. The prose link is written both `./slug.html` and bare
// `slug.html` across the corpus — both render as a working sibling link in the
// flat `dist/`, so the leading `./` is optional. We match the *markdown link*
// form, and only after stripping code, so a path written as documentation — a
// fenced example, or an inline `./slug.html` (this very mechanism is described
// that way in meta.mdx) — never registers as a real edge or trips the gate.
const NOTE_LINK = /\]\((?:\.\/)?([a-z0-9-]+)\.html(?:#[a-z0-9-]+)?\)/g;

function stripCode(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // fenced blocks
    .replace(/`[^`]*`/g, " "); // inline spans
}

export interface AtlasGraph {
  /** note id → the notes that reference it, title-sorted. The inbound half of
   *  the link graph the index never surfaced. */
  backlinks: Map<string, NoteRef[]>;
}

/** Invert the note-to-note link graph: for each note, the set of notes that link
 *  to it — via a same-directory `slug.html` prose link (with or without `./`) or
 *  a `parents` edge. Reuses the edges the Atlas already has rather than a
 *  hand-maintained `backlinks:` field.
 *
 *  Fail-fast: a prose link to a `slug.html` that names no note is a build
 *  error — a dead internal link must surface here, not 404 silently in the
 *  committed dist. `index.html` is the generated index, not a note, so it's
 *  exempt. (A dangling `parents` stays lenient, as the index intends: an unknown
 *  parent just drops to a root — membership is never blocked by a typo.) */
export function buildAtlasGraph(notes: CollectionEntry<"atlas">[]): AtlasGraph {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const inbound = new Map<string, Set<string>>();
  const link = (target: string, source: string) => {
    if (target === source) return;
    let sources = inbound.get(target);
    if (!sources) {
      sources = new Set();
      inbound.set(target, sources);
    }
    sources.add(source);
  };

  for (const n of notes) {
    for (const m of stripCode(n.body ?? "").matchAll(NOTE_LINK)) {
      const target = m[1];
      if (target === "index") continue;
      if (!byId.has(target)) {
        throw new Error(
          `Atlas dead link: ${n.id}.mdx links to ${target}.html, but no ` +
            `note has that slug. Fix the link or rename the target.`,
        );
      }
      link(target, n.id);
    }
    for (const pid of resolveParents(byId, n)) link(pid, n.id);
  }

  const byTitle = (a: NoteRef, b: NoteRef) => titleCmp(a.title, b.title);
  const backlinks = new Map<string, NoteRef[]>();
  for (const [target, sources] of inbound) {
    backlinks.set(
      target,
      [...sources].map((id) => toRef(byId, id)).sort(byTitle),
    );
  }
  return { backlinks };
}

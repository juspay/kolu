/** Obsidian-style `[[wikilink]]` resolution — the *meaning* half of the wikilink
 *  feature whose *syntax* half (the `markedWikilink` parse extension) lives in
 *  ./render. Both belong to `@kolu/solid-markdown` because a wikilink is a
 *  Markdown construct: the resolution rules here (`.md` implied, alias/heading
 *  stripping, ambiguity-surfacing) are defined by the wikilink grammar and
 *  co-evolve with the parser — nothing outside a Markdown document ever resolves
 *  one.
 *
 *  Deliberately node-pure and DOM-free (no solid-js / DOMPurify / marked edge),
 *  so it unit-tests in plain Node and the render path never depends on it — it's
 *  a standalone host-called export, exactly like ./url-policy's `safeHref`. The
 *  host hands it the repo file list; this module owns only the matching rules.
 *
 *  Distinct from `@kolu/solid-browser`'s `resolveLinkHref` (directory-relative
 *  `[](…)` path math, a *browsing* concern): that resolves against the source
 *  doc's own directory with no file list; this searches the whole vault by
 *  basename. Two different concepts that merely share the word "link" — so they
 *  live in two packages, by feature, not bundled by topic. */

/** Outcome of resolving a `[[wikilink]]` target against the repo's file list.
 *  Unlike a terminal `path:N` click — which collapses an ambiguous basename to
 *  null because the click can't ask the user which file it meant — a wikilink
 *  surfaces every candidate so the host can let the user disambiguate. */
export type WikilinkResolution =
  | { kind: "unique"; path: string }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: string[] };

/** Resolve an Obsidian-style wikilink target — `Note`, `Note#Heading`, or
 *  `folder/Note` — to repo path(s), pathless and vault-wide.
 *
 *  - A trailing `#heading` is dropped: the file opens; scrolling to the heading
 *    inside it is out of scope (mirrors the relative-link fragment behaviour).
 *  - Only the `.md` extension is implied, Obsidian-style: an extension-less
 *    `[[Note]]` matches a file named exactly `Note` **or** `Note.md` — nothing
 *    else. `[[lua-filters]]` resolves to `lua-filters.md`, NOT a same-stemmed
 *    `lua-filters.feature` / `.ts` (matching those would make near every wikilink
 *    spuriously ambiguous). A target with an explicit extension (`[[logo.png]]`)
 *    matches that exact basename.
 *  - A bare `[[Note]]` matches by basename anywhere in the repo; a qualified
 *    `[[docs/Note]]` additionally requires the parent directory to match, so it
 *    won't open a same-named file in another directory.
 *  - Matching is NFC-normalized (a git/macOS NFD path still matches an NFC
 *    target), and the returned path is the verbatim repo entry (git's bytes). */
export function resolveWikilink(args: {
  target: string;
  repoPaths: readonly string[];
}): WikilinkResolution {
  const target = args.target.split("#", 1)[0]?.trim() ?? "";
  if (target === "") return { kind: "none" };
  const segs = target.split("/").filter(Boolean);
  const leaf = (segs[segs.length - 1] ?? "").normalize("NFC");
  // An extension-less target accepts exactly `leaf` or `leaf.md` (the `.md`
  // implied form); an explicit extension is matched verbatim. Comparing whole
  // basenames — never a stem match — is what keeps `[[lua-filters]]` from
  // also matching `lua-filters.feature`.
  const wanted = hasExtension(leaf) ? [leaf] : [leaf, `${leaf}.md`];
  const byBasename = args.repoPaths.filter((p) =>
    wanted.includes(basename(p).normalize("NFC")),
  );
  // Qualified target (`docs/Note`): keep only files whose parent directory ends
  // with the leading segments, so a same-basename file elsewhere is excluded.
  // (`prefix` is "" for a bare target — unused, since the narrowing is skipped.)
  const prefix = segs.slice(0, -1).join("/").normalize("NFC");
  const cands =
    segs.length > 1
      ? byBasename.filter((p) => {
          const dir = parentDir(p).normalize("NFC");
          return dir === prefix || dir.endsWith(`/${prefix}`);
        })
      : byBasename;
  const unique = [...new Set(cands)].sort();
  const [first] = unique;
  if (first === undefined) return { kind: "none" };
  if (unique.length === 1) return { kind: "unique", path: first };
  return { kind: "ambiguous", candidates: unique };
}

/** Basename of a repo path (`docs/a.md` → `a.md`, `README.md` → `README.md`). */
function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

/** Parent directory of a repo path (`docs/a/x.md` → `docs/a`, `x.md` → ``). */
function parentDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/** True when `name` carries an extension — a dot that's neither leading (a
 *  dotfile like `.gitignore`) nor trailing (`Note.`). */
function hasExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1;
}

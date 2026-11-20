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
  const wanted = hasExtension(leaf) ? [leaf] : [leaf, `${leaf}.md`];
  const byBasename = args.repoPaths.filter((p) =>
    wanted.includes(basename(p).normalize("NFC")),
  );
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

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function parentDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function hasExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1;
}

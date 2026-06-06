/** GitHub-style relative-ref resolution — pure, framework-free, host-agnostic.
 *
 *  Resolves a **relative ref** inside rendered prose (a Markdown `[doc](../x.md)`
 *  or `![](logo.png)`) against the source document's own directory, the way
 *  GitHub does. It knows nothing about git, repos, or kolu — a "document path"
 *  is whatever opaque string the host resolves content from. */

// `hasOwnScheme` lives in the zero-dep `@kolu/url-shape` leaf, so this resolver
// stays node-pure — no edge into `@kolu/solid-markdown` (solid-js + DOMPurify).
import { hasOwnScheme } from "@kolu/url-shape";

/** Resolve a repo-relative ref (image `src` or link `href`) to a document path,
 *  applying GitHub's rules: a relative ref resolves against the source
 *  document's own directory, a root-absolute `/x` from the root. Returns null
 *  for a ref that carries its own origin/scheme (absolute URL, `data:`,
 *  protocol-relative `//host`, in-page `#anchor`) or one that escapes the root. */
export function resolveRelativePath(
  fromPath: string,
  ref: string,
): string | null {
  const trimmed = ref.trim();
  // A ref that carries its own origin/scheme is not a document path — bail.
  // The shape test is shared with the markdown href policy (`safeHref`) so
  // "has its own origin" lives in one place.
  if (trimmed === "" || hasOwnScheme(trimmed)) return null;

  // Root-absolute "/x" resolves from the root; everything else from the source
  // document's own directory.
  const baseDir = trimmed.startsWith("/") ? "" : posixDir(fromPath);
  return normalizeRepoPath(baseDir, trimmed.replace(/^\/+/, ""));
}

/** Resolve a link `href` to a document path. Strips a trailing
 *  `#fragment`/`?query` first — a link to `doc.md#section` opens `doc.md`;
 *  scrolling to the heading inside it is the host's concern, not this resolver's.
 *  Returns null for an external/own-scheme href or a path that escapes the root. */
export function resolveLinkHref(fromPath: string, href: string): string | null {
  const path = href.trim().replace(/[?#].*$/, "");
  return resolveRelativePath(fromPath, path);
}

/** Directory portion of a path (`"docs/a.md"` → `"docs"`, `"README.md"` → `""`). */
function posixDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/** Basename portion of a path (`"docs/a.md"` → `"a.md"`, `"README.md"` → `"README.md"`). */
function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

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
  const matchesLeaf = (path: string): boolean =>
    wanted.includes(basename(path).normalize("NFC"));
  let cands = args.repoPaths.filter(matchesLeaf);
  // Qualified target (`docs/Note`): narrow to files whose parent directory ends
  // with the leading segments, so a same-basename file elsewhere is excluded.
  if (segs.length > 1) {
    const prefix = segs.slice(0, -1).join("/").normalize("NFC");
    cands = cands.filter((p) => {
      const dir = posixDir(p).normalize("NFC");
      return dir === prefix || dir.endsWith(`/${prefix}`);
    });
  }
  const unique = [...new Set(cands)].sort();
  const [first] = unique;
  if (first === undefined) return { kind: "none" };
  if (unique.length === 1) return { kind: "unique", path: first };
  return { kind: "ambiguous", candidates: unique };
}

/** True when `name` carries an extension — a dot that's neither leading (a
 *  dotfile like `.gitignore`) nor trailing (`Note.`). */
function hasExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1;
}

/** Join `baseDir` + `relPath`, decode each rel segment's URL escapes to its
 *  on-disk name, and collapse `.` / `..`. Returns null when the result escapes
 *  the root (a leading `..`), is empty, or a segment decodes to something that
 *  smuggles a separator/traversal past the split (`%2f`, `%2e%2e`, a malformed
 *  escape).
 *
 *  The decode matters because a host that re-encodes per segment (kolu's
 *  `buildTerminalFileUrl`) would otherwise double-encode an author's
 *  `my%20images/logo.png` to `my%2520images` and 404. `baseDir` comes from the
 *  source document's own (trusted, not URL-encoded) path, so only the rel
 *  segments are decoded. */
function normalizeRepoPath(baseDir: string, relPath: string): string | null {
  const out: string[] = [];
  // Base segments are trusted path parts — pushed verbatim (no decode).
  for (const seg of baseDir ? baseDir.split("/") : []) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null; // escapes the root
      out.pop();
    } else {
      out.push(seg);
    }
  }
  for (const raw of relPath.split("/")) {
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null; // malformed percent-escape
    }
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null; // escapes the root
      out.pop();
      continue;
    }
    // A decoded `/` or `\` would smuggle a path boundary the split couldn't
    // see (`%2f`, `%5c`); reject it so the encoded form can't traverse.
    if (seg.includes("/") || seg.includes("\\")) return null;
    out.push(seg);
  }
  return out.length ? out.join("/") : null;
}

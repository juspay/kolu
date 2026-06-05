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

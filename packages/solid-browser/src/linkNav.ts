/** Navigation math for a content browser — pure, framework-free, host-agnostic.
 *
 *  Two kinds of link a browser must follow:
 *   - a **relative ref** inside rendered prose (a Markdown `[doc](../x.md)` or
 *     `![](logo.png)`) → resolve against the source document, GitHub-style;
 *   - a **preview pathname** reported by a sandboxed iframe after an in-frame
 *     `<a>` click → invert the host's preview-URL encoding back to a path.
 *
 *  Neither knows about git, repos, or kolu — the host's URL codec is injected,
 *  and a "document path" is whatever opaque string the host resolves content
 *  from. */

// `/url-policy` is the DOM-free subpath — importing the package root would drag
// in the `<Markdown>` component (and `solid-js/web`); this stays node-pure.
import { hasOwnScheme } from "@kolu/solid-markdown/url-policy";

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

/** The host's preview-URL codec — how it encodes a document path into the path
 *  segment of a sandboxed-preview URL, and back. Injected because the encoding
 *  is the host's contract (kolu's lives in `kolu-common/preview`), not this
 *  package's. `encode`/`decode` must round-trip. */
export type PreviewPathCodec = {
  encode: (path: string) => string;
  decode: (encoded: string) => string;
};

/** Map a sandboxed preview's reported `location.pathname` back to the document
 *  path it shows. The preview is served at `<prefix>/<encode(path)>?v=…`; after
 *  an in-frame link click the frame reports its own `location.pathname` (the
 *  opaque-origin sandbox blocks the parent from reading it directly).
 *
 *  The prefix isn't known here — it's derived from the file currently shown:
 *  `currentUrl` ends with `encode(currentPath)`, and everything before that is
 *  the shared prefix. Using the same injected codec for both directions means
 *  the inversion can't drift from the encoding — no second source of truth.
 *
 *  Returns null when the frame navigated outside the preview route (an external
 *  link, or a prefix mismatch) — the caller leaves selection untouched. */
export function pathFromPreviewPathname(
  reportedPathname: string,
  currentUrl: string,
  currentPath: string,
  codec: PreviewPathCodec,
): string | null {
  const currentPathname = currentUrl.split("?")[0] ?? currentUrl;
  const encodedCurrent = codec.encode(currentPath);
  if (!currentPathname.endsWith(encodedCurrent)) return null;
  const prefix = currentPathname.slice(
    0,
    currentPathname.length - encodedCurrent.length,
  );
  if (!reportedPathname.startsWith(prefix)) return null;
  const encodedNext = reportedPathname.slice(prefix.length);
  if (encodedNext === "") return null;
  try {
    return codec.decode(encodedNext);
  } catch {
    // A malformed percent-sequence can only arrive if the previewed page
    // crafted a bogus pathname — treat it as "no navigation".
    return null;
  }
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

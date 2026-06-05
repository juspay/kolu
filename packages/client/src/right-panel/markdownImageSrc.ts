/** Resolve repo-relative Markdown refs the way GitHub does — against the
 *  *previewed markdown file's directory* (`docs/readme.md` + `logo.png` →
 *  `docs/logo.png`, `../assets/x.png` → `assets/x.png`), with a root-absolute
 *  `/img/x.png` resolved from the repo root. Anything that isn't a repo-relative
 *  path — an absolute URL, `data:`, protocol-relative `//host`, or an in-page
 *  `#anchor` — and any path that escapes the repo root (`../../etc`) is rejected.
 *
 *  Two consumers share that one rule (`resolveMarkdownRelativePath`):
 *   - `resolveMarkdownImageSrc` → a per-terminal file-route URL the browser can
 *     fetch, so a README's `![](docs/logo.png)` renders instead of chipping;
 *   - `resolveMarkdownLinkPath` → a repo-relative path the Code-tab front door
 *     opens, so a `[doc](docs/guide.md)` link opens the file in the Code tab
 *     instead of navigating the app origin in a new tab (#1161). */

// Import from the DOM-free `/url-policy` subpath, not the package root — the
// root pulls in the `<Markdown>` component (and `solid-js/web`), which this
// node-testable helper must not depend on.
import { hasOwnScheme } from "@kolu/solid-markdown/url-policy";
import { buildTerminalFileUrl } from "kolu-common/preview";

/** Resolve a repo-relative Markdown ref (image `src` or link `href`) to a
 *  repo-relative path, applying GitHub's rules: a relative ref resolves against
 *  the previewed file's own directory, a root-absolute `/x` from the repo root.
 *  Returns null for a ref that carries its own origin/scheme (absolute URL,
 *  `data:`, protocol-relative `//host`, in-page `#anchor`) or one that escapes
 *  the repo root — the single place those rules live, shared by the image and
 *  link resolvers below. */
export function resolveMarkdownRelativePath(
  markdownFilePath: string,
  ref: string,
): string | null {
  const trimmed = ref.trim();
  // A ref that carries its own origin/scheme is not a repo path — bail. The
  // shape test is shared with the href policy (`safeHref`) so "has its own
  // origin" lives in one place.
  if (trimmed === "" || hasOwnScheme(trimmed)) return null;

  // Root-absolute "/x" resolves from the repo root; everything else from the
  // markdown file's own directory.
  const baseDir = trimmed.startsWith("/") ? "" : posixDir(markdownFilePath);
  return normalizeRepoPath(baseDir, trimmed.replace(/^\/+/, ""));
}

export function resolveMarkdownImageSrc(
  terminalId: string,
  markdownFilePath: string,
  src: string,
): string | undefined {
  const repoRel = resolveMarkdownRelativePath(markdownFilePath, src);
  if (repoRel === null) return undefined;
  return buildTerminalFileUrl(terminalId, repoRel);
}

/** Resolve a repo-relative Markdown *link* `href` to a repo-relative path the
 *  Code-tab front door can open. Strips a trailing `#fragment`/`?query` first —
 *  a link to `doc.md#section` opens `doc.md`; scrolling to the heading inside it
 *  is out of scope (#1161). Returns null for an external/own-scheme href or a
 *  path that escapes the repo root, in which case the click is a no-op. */
export function resolveMarkdownLinkPath(
  markdownFilePath: string,
  href: string,
): string | null {
  const path = href.trim().replace(/[?#].*$/, "");
  return resolveMarkdownRelativePath(markdownFilePath, path);
}

/** Directory portion of a repo-relative path (`"docs/a.md"` → `"docs"`,
 *  `"README.md"` → `""`). */
function posixDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/** Join `baseDir` + `relPath`, decode each rel segment's URL escapes to its
 *  on-disk name, and collapse `.` / `..`. Returns null when the result escapes
 *  the repo root (a leading `..`), is empty, or a segment decodes to something
 *  that smuggles a separator/traversal past the split (`%2f`, `%2e%2e`, a
 *  malformed escape).
 *
 *  The decode matters because `buildTerminalFileUrl` re-encodes per segment: an
 *  author who wrote `my%20images/logo.png` to name a `my images` directory
 *  would otherwise be double-encoded to `my%2520images` and 404. `baseDir`
 *  comes from the previewed file's own (trusted, not URL-encoded) path, so only
 *  the rel segments are decoded. */
function normalizeRepoPath(baseDir: string, relPath: string): string | null {
  const out: string[] = [];
  // Base segments are trusted file-path parts — pushed verbatim (no decode).
  for (const seg of baseDir ? baseDir.split("/") : []) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null; // escapes the repo root
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
      if (out.length === 0) return null; // escapes the repo root
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

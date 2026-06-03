/** Resolve a repo-relative Markdown image `src` to a per-terminal file-route
 *  URL the browser can actually fetch, so a README's `![](docs/logo.png)` (or
 *  inline `<img src="docs/logo.png">`) renders the real image instead of
 *  degrading to a fallback chip.
 *
 *  Relative srcs resolve against the *previewed markdown file's directory*, the
 *  way GitHub renders them — `docs/readme.md` + `logo.png` → `docs/logo.png`,
 *  `../assets/x.png` → `assets/x.png`. A root-absolute `/img/x.png` resolves
 *  from the repo root. Anything that isn't a repo-relative path — an absolute
 *  URL, `data:`, protocol-relative `//host`, or an in-page `#anchor` — returns
 *  undefined so the renderer keeps (http/data) or chips it. A path that escapes
 *  the repo root (`../../etc`) also returns undefined; the route would 403 it. */

// Import from the DOM-free `/url-policy` subpath, not the package root — the
// root pulls in the `<Markdown>` component (and `solid-js/web`), which this
// node-testable helper must not depend on.
import { hasOwnScheme } from "@kolu/solid-markdown/url-policy";
import { buildTerminalFileUrl } from "kolu-common/preview";

export function resolveMarkdownImageSrc(
  terminalId: string,
  markdownFilePath: string,
  src: string,
): string | undefined {
  const trimmed = src.trim();
  // A src that carries its own origin/scheme (absolute URL, `data:`,
  // protocol-relative `//host`, or an in-page `#anchor`) is not a repo path —
  // bail and let the renderer keep/chip it. The shape test is shared with the
  // href policy (`safeHref`) so "has its own origin" lives in one place.
  if (trimmed === "" || hasOwnScheme(trimmed)) return undefined;

  // Root-absolute "/x" resolves from the repo root; everything else from the
  // markdown file's own directory.
  const baseDir = trimmed.startsWith("/") ? "" : posixDir(markdownFilePath);
  const repoRel = normalizeRepoPath(baseDir, trimmed.replace(/^\/+/, ""));
  if (repoRel === null) return undefined;
  return buildTerminalFileUrl(terminalId, repoRel);
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

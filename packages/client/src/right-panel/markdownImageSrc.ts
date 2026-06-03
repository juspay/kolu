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

import { hasOwnScheme } from "@kolu/solid-markdown";
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

/** Join `baseDir` + `relPath` and collapse `.` / `..`. Returns null when the
 *  result escapes the repo root (a leading `..`) or is empty. */
function normalizeRepoPath(baseDir: string, relPath: string): string | null {
  const segments = (baseDir ? `${baseDir}/${relPath}` : relPath).split("/");
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null; // escapes the repo root
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.length ? out.join("/") : null;
}

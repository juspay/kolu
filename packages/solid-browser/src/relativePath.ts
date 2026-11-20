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
  if (trimmed === "" || hasOwnScheme(trimmed)) return null;

  const baseDir = trimmed.startsWith("/") ? "" : posixDir(fromPath);
  let pathStart = 0;
  while (trimmed[pathStart] === "/") pathStart++;
  return normalizeRepoPath(baseDir, trimmed.slice(pathStart));
}

/** Resolve a link `href` to a document path. Strips a trailing
 *  `#fragment`/`?query` first — a link to `doc.md#section` opens `doc.md`;
 *  scrolling to the heading inside it is the host's concern, not this resolver's.
 *  Returns null for an external/own-scheme href or a path that escapes the root. */
export function resolveLinkHref(fromPath: string, href: string): string | null {
  const trimmed = href.trim();
  const fragmentStart = trimmed.indexOf("#");
  const queryStart = trimmed.indexOf("?");
  const suffixStart =
    fragmentStart < 0
      ? queryStart
      : queryStart < 0
        ? fragmentStart
        : Math.min(fragmentStart, queryStart);
  const path = suffixStart < 0 ? trimmed : trimmed.slice(0, suffixStart);
  return resolveRelativePath(fromPath, path);
}

function posixDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function normalizeRepoPath(baseDir: string, relPath: string): string | null {
  const out: string[] = [];
  for (const seg of baseDir ? baseDir.split("/") : []) {
    if (!applySegment(out, seg)) return null;
  }
  for (const raw of relPath.split("/")) {
    const seg = decodeRelSegment(raw);
    if (seg === null || !applySegment(out, seg)) return null;
  }
  return out.length ? out.join("/") : null;
}

function decodeRelSegment(raw: string): string | null {
  let seg: string;
  try {
    seg = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return seg.includes("/") || seg.includes("\\") ? null : seg;
}

function applySegment(out: string[], seg: string): boolean {
  if (seg === "" || seg === ".") return true;
  if (seg !== "..") {
    out.push(seg);
    return true;
  }
  if (out.length === 0) return false;
  out.pop();
  return true;
}

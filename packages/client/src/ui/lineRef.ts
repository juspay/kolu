/** Format a `path:line` (single line) or `path:start-end` (range) reference
 *  the way most editors and code tools accept (VS Code, Vim's `:e file:N`,
 *  GitHub URL fragments, Linear-style snippets). */
export type LineRef = {
  path: string;
  start: number;
  end: number;
};

export type LineRefMatch = LineRef & {
  text: string;
  startIndex: number;
  endIndex: number;
};

export type LineRefPathResolutionInput = {
  rawPath: string;
  repoRoot: string;
  cwd: string | undefined;
  repoPaths: readonly string[];
};

const LINE_REF_RE =
  /((?:~\/|\.\.?\/|\/)?[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*):([1-9]\d*)(?:-([1-9]\d*))?/g;

const PATH_CHAR_RE = /[A-Za-z0-9._@+/-]/;

export function formatLineRef(
  path: string,
  start: number,
  end: number,
): string {
  return start === end ? `${path}:${start}` : `${path}:${start}-${end}`;
}

export function parseLineRef(text: string): LineRef | null {
  const matches = findLineRefs(text.trim());
  if (matches.length !== 1) return null;
  const match = matches[0];
  if (!match) return null;
  return match.text === text.trim()
    ? { path: match.path, start: match.start, end: match.end }
    : null;
}

export function findLineRefs(text: string): LineRefMatch[] {
  const refs: LineRefMatch[] = [];
  for (const match of text.matchAll(LINE_REF_RE)) {
    const rawPath = match[1];
    const rawStart = match[2];
    const rawEnd = match[3];
    const startIndex = match.index;
    if (
      rawPath === undefined ||
      rawStart === undefined ||
      startIndex === undefined
    ) {
      continue;
    }
    if (!looksLikeFilePath(rawPath)) continue;
    if (!hasReferenceBoundary(text, startIndex)) continue;
    const start = Number(rawStart);
    const end = rawEnd === undefined ? start : Number(rawEnd);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue;
    if (end < start) continue;
    const refText = match[0];
    refs.push({
      path: rawPath,
      start,
      end,
      text: refText,
      startIndex,
      endIndex: startIndex + refText.length,
    });
  }
  return refs;
}

export function resolveLineRefPath({
  rawPath,
  repoRoot,
  cwd,
  repoPaths,
}: LineRefPathResolutionInput): string | null {
  const repoPathSet = new Set(repoPaths);
  const candidates = candidateRepoPaths(rawPath, repoRoot, cwd);
  for (const candidate of candidates) {
    if (repoPathSet.has(candidate)) return candidate;
  }
  return null;
}

function looksLikeFilePath(path: string): boolean {
  if (path.startsWith("//")) return false;
  return (
    path.includes("/") ||
    path.includes(".") ||
    path.startsWith("~/") ||
    path.startsWith("./") ||
    path.startsWith("../")
  );
}

function hasReferenceBoundary(text: string, startIndex: number): boolean {
  const prev = startIndex > 0 ? text[startIndex - 1] : undefined;
  if (prev && PATH_CHAR_RE.test(prev)) return false;
  return text.slice(Math.max(0, startIndex - 3), startIndex) !== "://";
}

function candidateRepoPaths(
  rawPath: string,
  repoRoot: string,
  cwd: string | undefined,
): string[] {
  const candidates: string[] = [];
  const add = (path: string | null) => {
    if (path !== null && !candidates.includes(path)) candidates.push(path);
  };

  if (isAbsolutePath(rawPath)) {
    add(repoRelativeFromAbsolute(rawPath, repoRoot));
    return candidates;
  }

  const cwdRel = cwd ? repoRelativeFromAbsolute(cwd, repoRoot) : null;
  if (cwdRel !== null) add(normalizeRelativePath(joinPath(cwdRel, rawPath)));
  add(normalizeRelativePath(rawPath));
  return candidates;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/");
}

function repoRelativeFromAbsolute(
  absolutePath: string,
  repoRoot: string,
): string | null {
  const root = normalizeAbsolutePath(repoRoot);
  const absolute = normalizeAbsolutePath(absolutePath);
  if (absolute === root) return "";
  if (!absolute.startsWith(`${root}/`)) return null;
  return normalizeRelativePath(absolute.slice(root.length + 1));
}

function normalizeAbsolutePath(path: string): string {
  const normalized = `/${path.split("/").filter(Boolean).join("/")}`;
  return normalized.length > 1 && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

function normalizeRelativePath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function joinPath(base: string, path: string): string {
  return base ? `${base}/${path}` : path;
}

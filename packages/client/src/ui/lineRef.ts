/** Source references in `path:line[-end]` shape — parsing, formatting,
 *  and resolution against a worktree's file list. Terminal output, log
 *  excerpts, and editor messages all share this shape; this module is
 *  the single place that knows how to read and resolve it. */

/** Parsed line reference with an inclusive 1-based range. */
export interface LineRef {
  path: string;
  startLine: number;
  endLine: number;
}

/** Parsed match including source positions — what an xterm link
 *  provider needs to build an `ILink.range`. */
export interface LineRefMatch extends LineRef {
  /** Substring of the source that matched (e.g. `"packages/foo.ts:42"`). */
  text: string;
  /** Inclusive start index in the source string. */
  index: number;
}

/** Render a 1-based line range as `start` (single line) or `start-end`
 *  (range). Shared by every prefix style — `path:N`, `LN`, `#LN`. */
export function formatRange(start: number, end: number): string {
  return start === end ? `${start}` : `${start}-${end}`;
}

/** Format a `path:line` (single line) or `path:start-end` (range)
 *  reference the way most editors and code tools accept (VS Code,
 *  Vim's `:e file:N`, GitHub URL fragments, Linear-style snippets). */
export function formatLineRef(
  path: string,
  start: number,
  end: number,
): string {
  return `${path}:${formatRange(start, end)}`;
}

// Path char class: word + `.`, `+`, `@`, `-`. `~` is deliberately
// excluded — home-relative refs can't be resolved against the
// terminal's worktree without a resolver contract this module
// doesn't own.
const PATH_CHARS = "[\\w.+@-]";
const LINE_REF_RE = new RegExp(
  // Two path shapes:
  //   1. slash-containing: optional `./`, `../`, or `/` prefix, then
  //      one or more `segment/` followed by a final segment;
  //   2. bare filename with a letter-led extension (`Type.hs`,
  //      `package.json`) — letter-led extension rejects IPv4-style
  //      `192.168.1.1:8080` and version strings like `1.2.3:5`.
  `((?:\\.\\.?\\/|\\/)?(?:${PATH_CHARS}+\\/)+${PATH_CHARS}+|${PATH_CHARS}+\\.[A-Za-z]\\w*)` +
    // Line + optional `:col` (consumed but ignored) or `-end`.
    `:(\\d+)(?::\\d+|-(\\d+))?`,
  "g",
);

/** Find every `path:line[-end]` reference in `text`. URL embeds
 *  (`://...`) and mid-token matches (immediately preceded by another
 *  path char) are rejected. */
export function parseLineRefs(text: string): LineRefMatch[] {
  const out: LineRefMatch[] = [];
  LINE_REF_RE.lastIndex = 0;
  let m = LINE_REF_RE.exec(text);
  while (m !== null) {
    const path = m[1];
    const start = Number(m[2]);
    const end = m[3] !== undefined ? Number(m[3]) : start;
    const ok =
      path !== undefined &&
      start >= 1 &&
      end >= start &&
      hasRefBoundary(text, m.index);
    if (ok && path !== undefined) {
      out.push({
        path,
        startLine: start,
        endLine: end,
        text: m[0],
        index: m.index,
      });
    }
    m = LINE_REF_RE.exec(text);
  }
  return out;
}

const PATH_CHAR_TEST = /[\w.+@~/-]/;

/** Reject matches embedded in URLs (`://path:N`) and matches that
 *  fuse into a preceding token (`foopath/bar.ts:1` starting at
 *  `path/`). Both produce technically-valid regex matches but they
 *  almost never represent a clickable reference the user typed. */
function hasRefBoundary(text: string, index: number): boolean {
  if (index >= 3 && text.slice(index - 3, index) === "://") return false;
  if (index > 0) {
    const prev = text[index - 1];
    if (prev !== undefined && PATH_CHAR_TEST.test(prev)) return false;
  }
  return true;
}

/** Resolve a terminal-supplied path to a repo-relative path that
 *  exists in `repoPaths`. Returns null when no candidate matches —
 *  the click should surface a toast rather than open a blank file.
 *
 *  - `rawPath`: as it appeared in the terminal (absolute or relative).
 *  - `repoRoot`: the terminal's git worktree root.
 *  - `cwd`: terminal cwd at click time — drives the "user typed
 *    `bar.ts:42` while standing in a subdirectory" case. Undefined
 *    falls back to repo-relative interpretation only.
 *  - `repoPaths`: live `fsListAll` paths — repo-relative, no leading
 *    `/`. The resolver only returns a path that's actually in this
 *    set. */
export function resolveLineRefPath(args: {
  rawPath: string;
  repoRoot: string;
  cwd: string | undefined;
  repoPaths: readonly string[];
}): string | null {
  const set = new Set(args.repoPaths);
  for (const candidate of candidates(args)) {
    if (set.has(candidate)) return candidate;
  }
  return null;
}

function* candidates(args: {
  rawPath: string;
  repoRoot: string;
  cwd: string | undefined;
}): Generator<string> {
  const { rawPath, repoRoot, cwd } = args;
  if (rawPath.startsWith("/")) {
    // Absolute path — must live under repoRoot.
    const rel = stripRepoPrefix(rawPath, repoRoot);
    if (rel !== null) yield rel;
    return;
  }
  // Cwd-relative — user typed `bar.ts:42` while standing in a
  // subdirectory of the repo. Compose cwd-rel + rawPath and try first.
  const cwdRel = cwd ? stripRepoPrefix(cwd, repoRoot) : null;
  if (cwdRel !== null && cwdRel !== "") {
    const joined = normalize(`${cwdRel}/${rawPath}`);
    if (joined !== null) yield joined;
  }
  // Fall back to repo-relative interpretation.
  const direct = normalize(rawPath);
  if (direct !== null) yield direct;
}

function stripRepoPrefix(abs: string, repoRoot: string): string | null {
  const a = normalizeAbsolute(abs);
  const root = normalizeAbsolute(repoRoot);
  if (a === root) return "";
  if (!a.startsWith(`${root}/`)) return null;
  return normalize(a.slice(root.length + 1));
}

function normalizeAbsolute(path: string): string {
  const joined = `/${path.split("/").filter(Boolean).join("/")}`;
  return joined.length > 1 && joined.endsWith("/")
    ? joined.slice(0, -1)
    : joined;
}

/** Collapse `.` / `..` segments. Returns null when the path escapes
 *  the implicit root (more `..` than parents). */
function normalize(path: string): string | null {
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

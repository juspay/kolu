/** Source references in `path:line[-end]` shape — parsing, formatting, and
 *  resolution against a worktree's file list. */

import { ancestorDirectoryPaths } from "@kolu/solid-pierre/paths";

/** Parsed line reference with an inclusive 1-based range. `startLine` and
 *  `endLine` are null when the source had no `:N` suffix. */
export interface LineRef {
  path: string;
  startLine: number | null;
  endLine: number | null;
}

/** Parsed match including source positions — what an xterm link provider
 *  needs to build an `ILink.range`. */
export interface LineRefMatch extends LineRef {
  /** Substring of the source that matched (e.g. `"packages/foo.ts:42"`). */
  text: string;
  /** Inclusive start index in the source string. */
  index: number;
}

/** Format a `path`, `path:line`, or `path:start-end` reference. When `start`
 *  is null the bare path is returned. */
export function formatLineRef(
  path: string,
  start: number | null,
  end: number | null,
): string {
  if (start === null) return path;
  return start === end ? `${path}:${start}` : `${path}:${start}-${end}`;
}

const UNICODE_PATH_CHARS = "[\\p{L}\\p{M}\\p{N}_.+@-]";
const SLASH_PATH = `(?:\\.\\.?\\/|\\/)?(?:${UNICODE_PATH_CHARS}+\\/)+${UNICODE_PATH_CHARS}*`;
const DOTTED_FILENAME = `${UNICODE_PATH_CHARS}+\\.\\p{L}[\\p{L}\\p{M}\\p{N}_]*`;
const LINE_SUFFIX = "(?::(\\d+)(?::\\d+|-(\\d+))?)?";
const NO_TRAILING_DOT = "(?<!\\.)";
const LINE_REF_RE = new RegExp(
  `(${SLASH_PATH}|${DOTTED_FILENAME})${LINE_SUFFIX}${NO_TRAILING_DOT}`,
  "gu",
);

/** Find every `path[:line[-end]]` reference in `text`. URL embeds (`://...`)
 *  and mid-token matches are rejected. */
export function parseLineRefs(text: string): LineRefMatch[] {
  const out: LineRefMatch[] = [];
  LINE_REF_RE.lastIndex = 0;
  let m = LINE_REF_RE.exec(text);
  while (m !== null) {
    const path = m[1];
    const hasLine = m[2] !== undefined;
    const start = hasLine ? Number(m[2]) : null;
    const end = m[3] !== undefined ? Number(m[3]) : start;
    const lineOk =
      !hasLine ||
      (start !== null && start >= 1 && end !== null && end >= start);
    const ok = path !== undefined && lineOk && hasRefBoundary(text, m.index);
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

const PATH_CHAR_TEST = /[\p{L}\p{M}\p{N}_.+@~/-]/u;

/** Reject matches embedded in URLs (`://path:N`) and matches that fuse into a
 *  preceding token (`foopath/bar.ts:1` starting at `path/`). */
function hasRefBoundary(text: string, index: number): boolean {
  if (index >= 3 && text.slice(index - 3, index) === "://") return false;
  if (index > 0) {
    const prev = text[index - 1];
    if (prev !== undefined && PATH_CHAR_TEST.test(prev)) return false;
  }
  return true;
}

/** A terminal path-ref resolved against the worktree. `path` is the verbatim
 *  repo entry — a file path for `file`, a trailing-slash folder key for
 *  `directory`. */
export type ResolvedRef =
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string };

/** Resolve a terminal-supplied path to a repo file or directory, or null when
 *  nothing matches.
 *
 *  - `rawPath`: as it appeared in the terminal (absolute or relative).
 *  - `repoRoot`: the terminal's git worktree root.
 *  - `cwd`: terminal cwd at click time; undefined falls back to
 *    repo-relative interpretation only.
 *  - `repoPaths`: live `fsListAll` paths — repo-relative files only;
 *    directories are derived from the path prefixes.
 *  - `allowBasenameFallback`: default true; false gates step 3 only.
 *  - `hasLine`: the ref carried a `:N` suffix, so a directory match fails
 *    closed instead of revealing the folder or reaching step 3.
 *
 *  Precedence: exact file, then exact directory, then a unique-basename file.
 *  All comparison is under NFC; the returned value is the verbatim
 *  `repoPaths` entry, and NFC collisions resolve to null. */
export function resolveRef(args: {
  rawPath: string;
  repoRoot: string;
  cwd: string | undefined;
  repoPaths: readonly string[];
  allowBasenameFallback?: boolean;
  hasLine?: boolean;
}): ResolvedRef | null {
  const { byNorm, byBasename, byDir } = buildNormalizedIndex(args.repoPaths);
  for (const candidate of candidates(args)) {
    const hit = byNorm.get(candidate.normalize("NFC"));
    if (hit !== undefined && hit !== AMBIGUOUS)
      return { kind: "file", path: hit };
  }
  for (const candidate of candidates(args)) {
    if (candidate === "") continue;
    const hit = byDir.get(`${candidate}/`.normalize("NFC"));
    if (hit !== undefined && hit !== AMBIGUOUS) {
      return args.hasLine ? null : { kind: "directory", path: hit };
    }
  }
  if (args.allowBasenameFallback === false) return null;
  const hit = resolveByBasename(args.rawPath, byBasename);
  return hit === null ? null : { kind: "file", path: hit };
}

/** Sentinel marking an NFC key that maps to two or more distinct repo paths
 *  — treated as unresolvable rather than guessing. */
const AMBIGUOUS = Symbol("ambiguous");

/** All three indexes are built in one pass so each repo path is NFC-normalized
 *  once: `byNorm` keys the full file path, `byBasename` the basename, `byDir`
 *  each trailing-slash directory key the files imply. */
function buildNormalizedIndex(repoPaths: readonly string[]): {
  byNorm: Map<string, string | typeof AMBIGUOUS>;
  byBasename: Map<string, string | typeof AMBIGUOUS>;
  byDir: Map<string, string | typeof AMBIGUOUS>;
} {
  const byNorm = new Map<string, string | typeof AMBIGUOUS>();
  const byBasename = new Map<string, string | typeof AMBIGUOUS>();
  const byDir = new Map<string, string | typeof AMBIGUOUS>();
  const add = (
    index: Map<string, string | typeof AMBIGUOUS>,
    key: string,
    p: string,
  ) => {
    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, p);
    } else if (existing !== p) {
      index.set(key, AMBIGUOUS);
    }
  };
  for (const p of repoPaths) {
    add(byNorm, p.normalize("NFC"), p);
    add(byBasename, basename(p).normalize("NFC"), p);
    for (const dir of ancestorDirectoryPaths(p))
      add(byDir, dir.normalize("NFC"), dir);
  }
  return { byNorm, byBasename, byDir };
}

function resolveByBasename(
  rawPath: string,
  byBasename: Map<string, string | typeof AMBIGUOUS>,
): string | null {
  const target = basename(rawPath).normalize("NFC");
  if (target === "") return null;
  const hit = byBasename.get(target);
  return hit === undefined || hit === AMBIGUOUS ? null : hit;
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

function* candidates(args: {
  rawPath: string;
  repoRoot: string;
  cwd: string | undefined;
}): Generator<string> {
  const { rawPath, repoRoot, cwd } = args;
  if (rawPath.startsWith("/")) {
    const rel = stripRepoPrefix(rawPath, repoRoot);
    if (rel !== null) yield rel;
    return;
  }
  const cwdRel = cwd ? stripRepoPrefix(cwd, repoRoot) : null;
  if (cwdRel !== null && cwdRel !== "") {
    const joined = normalize(`${cwdRel}/${rawPath}`);
    if (joined !== null) yield joined;
  }
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

/** Collapse `.` / `..` segments. Null when the path escapes the implicit root. */
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

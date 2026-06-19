/** Source references in `path:line[-end]` shape — parsing, formatting,
 *  and resolution against a worktree's file list. Terminal output, log
 *  excerpts, and editor messages all share this shape; this module is
 *  the single place that knows how to read and resolve it. */

import { ancestorDirectoryPaths } from "@kolu/solid-pierre";

/** Parsed line reference with an inclusive 1-based range. `startLine`
 *  and `endLine` are null when the source had no `:N` suffix — `path`
 *  alone is enough to navigate, and the consumer should open the file
 *  without selecting any line. */
export interface LineRef {
  path: string;
  startLine: number | null;
  endLine: number | null;
}

/** Parsed match including source positions — what an xterm link
 *  provider needs to build an `ILink.range`. */
export interface LineRefMatch extends LineRef {
  /** Substring of the source that matched (e.g. `"packages/foo.ts:42"`). */
  text: string;
  /** Inclusive start index in the source string. */
  index: number;
}

/** Format a `path`, `path:line`, or `path:start-end` reference the way
 *  most editors and code tools accept (VS Code, Vim's `:e file:N`,
 *  GitHub URL fragments, Linear-style snippets). When `start` is null
 *  the bare path is returned. */
export function formatLineRef(
  path: string,
  start: number | null,
  end: number | null,
): string {
  if (start === null) return path;
  return start === end ? `${path}:${start}` : `${path}:${start}-${end}`;
}

// Path char class: unicode letters/marks/digits + `_`, `.`, `+`, `@`, `-`.
// `\p{L}`/`\p{N}` (paired with the `u` flag on the regexes below) keep
// accented, CJK, and other non-ASCII names like `Amélie.md` in one piece;
// a bare `\w` is ASCII-only, so it would split the ref at the first
// non-ASCII byte and linkify `Am` and `lie.md` as two stubs. `\p{M}`
// (combining marks) is load-bearing for *decomposed* (NFD) names: a
// git/macOS path can arrive as `Ame` + U+0301 (combining acute) + `lie.md`,
// and without `\p{M}` the class would stop at the bare combining mark and
// split the ref exactly like the original ASCII bug. `~` is deliberately
// excluded — home-relative refs can't be resolved against the terminal's
// worktree without a resolver contract this module doesn't own.
const PATH_CHARS = "[\\p{L}\\p{M}\\p{N}_.+@-]";
const LINE_REF_RE = new RegExp(
  // Two path shapes:
  //   1. slash-containing: optional `./`, `../`, or `/` prefix, then one
  //      or more `segment/` followed by an *optional* final segment. The
  //      final segment is `*` (not `+`) so a trailing-slash folder ref
  //      keeps its slash in the match: `packages/client/` links the whole
  //      token, not just `packages/client`, and a single-segment folder
  //      `src/` (the `(?:seg/)+` matched once, final segment empty) links
  //      too — matching the docs/tip examples and `ls -F` directory
  //      output. The `(?:seg/)+` still requires at least one real
  //      `segment/`, so a bare `/` can never match on its own.
  //   2. bare filename with a letter-led extension (`Type.hs`,
  //      `package.json`) — letter-led extension rejects IPv4-style
  //      `192.168.1.1:8080` and version strings like `1.2.3:5`. The
  //      lead is `\p{L}` (any unicode letter) so a unicode extension
  //      still counts while a leading digit is still rejected.
  // Both branches require either a `/` or a `.ext`, which keeps plain
  // words (`react`, `init`) from getting linkified when the `:N`
  // suffix is absent.
  `((?:\\.\\.?\\/|\\/)?(?:${PATH_CHARS}+\\/)+${PATH_CHARS}*|${PATH_CHARS}+\\.\\p{L}[\\p{L}\\p{M}\\p{N}_]*)` +
    // Optional `:line[:col|-end]`. When absent the bare path links to
    // the file with no line selected.
    `(?::(\\d+)(?::\\d+|-(\\d+))?)?` +
    // The reference must not END in a literal `.`. `.` is a path char
    // (extensions, dotfiles), so a greedy slash-path used to swallow the
    // sentence period in prose like `…a single docs/plans/electricity.html.`
    // and the link resolved to a nonexistent `…html.`. Only the dot is
    // excluded from the tail — `+`/`@`/`-` are kept so `foo.c++` and
    // `bin/g++` still link in full. A `:line` suffix ends in a digit, so
    // this only ever trims a bare path's trailing dot.
    `(?<!\\.)`,
  // `u` makes `\p{L}`/`\p{N}` valid and matching code-point-aware.
  "gu",
);

/** Find every `path[:line[-end]]` reference in `text`. URL embeds
 *  (`://...`) and mid-token matches (immediately preceded by another
 *  path char) are rejected. */
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

/** A terminal path-ref resolved against the worktree: either a concrete
 *  `file` (open it) or a `directory` (reveal it in the tree). `path` is the
 *  verbatim repo entry — a file path for `file`; a trailing-slash folder key
 *  (`packages/client/`, the form Pierre uses for directory rows) for
 *  `directory`. */
export type ResolvedRef =
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string };

/** Resolve a terminal-supplied path to a repo file or directory. Returns null
 *  when nothing matches — the click should surface a toast rather than open a
 *  blank file.
 *
 *  - `rawPath`: as it appeared in the terminal (absolute or relative).
 *  - `repoRoot`: the terminal's git worktree root.
 *  - `cwd`: terminal cwd at click time — drives the "user typed
 *    `bar.ts:42` while standing in a subdirectory" case. Undefined
 *    falls back to repo-relative interpretation only.
 *  - `repoPaths`: live `fsListAll` paths — repo-relative, no leading
 *    `/`. Lists files only; directories are derived from the path prefixes.
 *    The resolver only returns a path backed by this set.
 *
 *  Precedence, so a more certain match always wins:
 *    1. an exact path that names a **file** — unambiguous, take it;
 *    2. an exact path that names a **directory** — a slash path like
 *       `src/core` reveals that folder *before* the fuzzy basename guess, so a
 *       real directory is never shadowed by a same-named file elsewhere.
 *       When `hasLine` is set the directory is still *detected* but not
 *       revealed: a `:N` suffix only makes sense for a file, so `app/core:12`
 *       fails closed to the not-found toast instead of revealing `app/core/`
 *       and dropping the line — and, crucially, instead of falling through to
 *       the basename fallback and opening an unrelated same-basename file;
 *    3. a unique-**basename** file fallback — compiler output often prints just
 *       `Foo.hs:42` without the `src/lib/` prefix (#898). Fires only when the
 *       basename is unique; ambiguous matches stay null since opening the wrong
 *       file is worse than the toast.
 *
 *  All comparison is under NFC so a terminal ref and a repo path that differ
 *  only in unicode normalization still resolve: a git/macOS path can be NFD
 *  (`Ame` + combining acute) while the terminal text is NFC (`Amélie`), and an
 *  exact `Set.has` would miss every accented name. The index keys are
 *  normalized but the *value* is the verbatim `repoPaths` entry — that's what
 *  navigation must open (git addresses files by their actual bytes, not the
 *  NFC form). Distinct repo entries that collide under NFC are dropped to
 *  AMBIGUOUS so they resolve to null rather than the wrong target.
 *
 *  - `allowBasenameFallback`: default true (terminal output, where the
 *    fuzzy basename match is the whole point of #898). Pass false for
 *    callers whose path is already exact and unambiguous — a Markdown
 *    relative link (#1161) carries GitHub-style exact semantics:
 *    `[guide](docs/guide.md)` must open exactly `docs/guide.md` or
 *    fail, never silently open a same-basename `src/guide.md`. Only step 3
 *    is gated; the exact file and directory steps always apply.
 *
 *  - `hasLine`: the ref carried a `:N` line suffix. A line number only makes
 *    sense for a file, so a folder can never satisfy a line-bearing ref. When
 *    set, step (2) still *detects* a directory match but fails closed (returns
 *    null) instead of revealing it or letting the basename fallback fire — a
 *    path that already names a real directory must not fuzzy-open some other
 *    file. Defaults to false (a bare path may be a folder). */
export function resolveRef(args: {
  rawPath: string;
  repoRoot: string;
  cwd: string | undefined;
  repoPaths: readonly string[];
  allowBasenameFallback?: boolean;
  hasLine?: boolean;
}): ResolvedRef | null {
  const { byNorm, byBasename, byDir } = buildNormalizedIndex(args.repoPaths);
  // 1. Exact file.
  for (const candidate of candidates(args)) {
    const hit = byNorm.get(candidate.normalize("NFC"));
    if (hit !== undefined && hit !== AMBIGUOUS)
      return { kind: "file", path: hit };
  }
  // 2. Exact directory — checked before the basename fallback so `src/core`
  //    reveals the folder rather than guessing at a stray `core` file. An empty
  //    candidate (the repo root itself) names no folder row, so skip it.
  //    A line-bearing ref (`app/core:12`) means a *file*, so we don't reveal the
  //    folder — but we still detect the directory match and fail closed (return
  //    null) rather than fall through to the basename fallback, which would
  //    wrongly open an unrelated same-basename file (`lib/core`) for a path the
  //    user already pointed at a real directory.
  for (const candidate of candidates(args)) {
    if (candidate === "") continue;
    const hit = byDir.get(`${candidate}/`.normalize("NFC"));
    if (hit !== undefined && hit !== AMBIGUOUS) {
      return args.hasLine ? null : { kind: "directory", path: hit };
    }
  }
  // 3. Unique-basename file fallback.
  if (args.allowBasenameFallback === false) return null;
  const hit = resolveByBasename(args.rawPath, byBasename);
  return hit === null ? null : { kind: "file", path: hit };
}

/** Sentinel marking an NFC key that maps to two or more distinct repo paths
 *  — treated as unresolvable rather than guessing. */
const AMBIGUOUS = Symbol("ambiguous");

/** All three indexes are built in one pass so the NFC normalization of each
 *  repo path (full path, basename, and every ancestor directory key) happens
 *  exactly once. `byNorm` keys the full file path, `byBasename` the basename,
 *  and `byDir` each trailing-slash directory key the files imply; each drops
 *  NFC collisions to AMBIGUOUS and keeps the verbatim entry as the value. A
 *  directory key repeats across every file it contains, but that repeat carries
 *  the identical verbatim value, so it never trips the collision check — only a
 *  genuinely distinct NFD/NFC encoding of the same folder does. */
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

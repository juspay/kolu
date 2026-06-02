/**
 * Secure path helpers for operations that receive file paths from
 * untrusted sources. A child path arriving over RPC is untrusted —
 * a crafted `../../etc/passwd` would escape the repo root unless
 * we normalize and reject it up front.
 */

import { realpath } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { err, type GitResult, ok } from "./errors.ts";

/**
 * Normalize a caller-supplied `child` path against a trusted `root` and
 * reject anything that escapes. Returns both an absolute path (for
 * `fs.readFile`) and a normalized relative path (canonical form for
 * every downstream subprocess / tool call — so no code path is reading
 * the raw untrusted string).
 *
 * Uses the `path.relative` idiom (`..` prefix => outside) rather than a
 * `startsWith(rootAbs + path.sep)` prefix check; same guarantee, no
 * trailing-slash gotcha, and we get `rel` out of the computation for
 * free.
 *
 * This is a *lexical* guard only — it operates on the path string and does
 * not touch the filesystem, so it does NOT resolve symlinks. A repo-local
 * `leak -> /etc/passwd` passes this check (the string still lives under the
 * root) yet a later `fs.readFile` follows the link out of the repo. For any
 * operation that reads, stats, or diffs an *existing* file, use
 * `resolveExistingUnder` (lexical + symlink-resolving). Keep `resolveUnder`
 * for paths that may not exist yet, or where only lexical canonicalization
 * is needed (e.g. deriving a `rel` pathspec for a subprocess).
 */
export function resolveUnder(
  root: string,
  child: string,
  log?: Logger,
): GitResult<{ abs: string; rel: string }> {
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, child);
  const rel = path.relative(rootAbs, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    log?.error({ root, child }, "safe-path: child escapes root");
    return err({ code: "PATH_ESCAPES_ROOT", root, child });
  }
  return ok({ abs, rel });
}

/**
 * Filesystem-authority guard: assert that an already-lexically-validated
 * absolute path stays under `root` *after symlinks are resolved on both
 * sides*. This is the half `resolveUnder` can't do — it follows symlinks via
 * `fs.realpath`, so a repo-local `leak -> /etc/passwd` is rejected instead of
 * read. We `realpath` the root too, because the root itself may be reached
 * through a symlink (macOS `/tmp -> /private/tmp`, a symlinked checkout); only
 * a real-to-real comparison is sound.
 *
 * `abs` must be absolute and should already have passed `resolveUnder`.
 *
 * On any `realpath` failure (target missing, `EACCES`, symlink loop) this
 * resolves `ok`: there is no resolvable on-disk file to leak, and the
 * caller's own fs op will reproduce the same errno — so a missing file stays
 * a 404/`ENOENT` rather than being masked as a path escape.
 */
export async function assertRealpathUnder(
  root: string,
  abs: string,
  log?: Logger,
): Promise<GitResult<void>> {
  let realRoot: string;
  let realAbs: string;
  try {
    [realRoot, realAbs] = await Promise.all([realpath(root), realpath(abs)]);
  } catch {
    // realpath failed (ENOENT / EACCES / ELOOP): there is no resolvable
    // on-disk file to leak, and the caller's own read/stat faces the
    // identical kernel checks, so it reproduces the same errno. Fail open
    // rather than mask a 404/permission error as a path escape (see JSDoc).
    return ok(undefined);
  }
  const rel = path.relative(realRoot, realAbs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    log?.error({ root, abs }, "safe-path: real path escapes root (symlink)");
    return err({ code: "PATH_ESCAPES_ROOT", root, child: abs });
  }
  return ok(undefined);
}

/**
 * `resolveUnder` + `assertRealpathUnder` in one call — the guard to use
 * whenever a caller-supplied `child` path is about to read, stat, or diff an
 * *existing* file. Lexical normalization first (rejects `../../` traversal and
 * yields the canonical `rel`), then the symlink-resolving authority check.
 * Returns the same `{ abs, rel }` as `resolveUnder` so call sites swap one for
 * the other with only an added `await`.
 */
export async function resolveExistingUnder(
  root: string,
  child: string,
  log?: Logger,
): Promise<GitResult<{ abs: string; rel: string }>> {
  const lexical = resolveUnder(root, child, log);
  if (!lexical.ok) return lexical;
  const guard = await assertRealpathUnder(root, lexical.value.abs, log);
  if (!guard.ok) return guard;
  return lexical;
}

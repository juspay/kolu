import { realpath } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { err, type GitResult, ok } from "./errors.ts";

/**
 * Normalize a caller-supplied `child` path against a trusted `root` and reject
 * anything that escapes. Returns both an absolute path and a normalized
 * relative path.
 *
 * A *lexical* guard only: it does NOT resolve symlinks, so a repo-local
 * `leak -> /etc/passwd` passes. Use `resolveExistingUnder` for any operation
 * that reads, stats, or diffs an existing file.
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
 * absolute path stays under `root` after symlinks are resolved on BOTH sides
 * (the root itself may be reached through a symlink, e.g. macOS
 * `/tmp -> /private/tmp`).
 *
 * On any `realpath` failure (target missing, `EACCES`, symlink loop) this
 * resolves `ok`: there is no resolvable on-disk file to leak, and the caller's
 * own fs op reproduces the same errno.
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
 * *existing* file.
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

/**
 * Secure path helpers for RPC handlers that receive file paths from the
 * client. A child path arriving over RPC is untrusted — a crafted
 * `../../etc/passwd` would be read by `fs.readFile` or handed to
 * subprocess invocations unless we normalize and reject it up front.
 */

import path from "node:path";
import { log } from "./log.ts";

/**
 * Normalize a caller-supplied `child` path against a trusted `root` and
 * reject anything that escapes. Returns both an absolute path (for
 * `fs.readFile`) and a normalized relative path (canonical form for
 * every downstream subprocess / tool call — so no code path is reading
 * the raw untrusted string).
 *
 * Uses the `path.relative` idiom (`..` prefix ⇒ outside) rather than a
 * `startsWith(rootAbs + path.sep)` prefix check; same guarantee, no
 * trailing-slash gotcha, and we get `rel` out of the computation for
 * free.
 */
export function resolveUnder(
  root: string,
  child: string,
): { abs: string; rel: string } {
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, child);
  const rel = path.relative(rootAbs, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    log.error({ root, child }, "safe-path: child escapes root");
    throw new Error(`path escapes root: ${child}`);
  }
  return { abs, rel };
}

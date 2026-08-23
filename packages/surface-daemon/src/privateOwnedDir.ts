/**
 * Is `dir` a private, owner-only directory the current user owns?
 *
 * The security boundary for every unix-socket / pid-gate / daemon-home path
 * under this package: a STABLE shared path (`/tmp/<app>-$UID`) on a multi-user
 * host is one any local user can pre-create, and `mkdirSync` does NOT repair
 * an existing dir's owner/mode. So after creating it we VERIFY: current-uid
 * owned and no group/other access bit.
 *
 * `lstatSync` (NOT `statSync`) so a SYMLINK is judged as itself and rejected,
 * never followed. Returns true on platforms without uid semantics (Windows:
 * `process.getuid` is undefined) — the ACL model there is out of scope.
 *
 * Shared by `acquirePidGate` and `daemonHome` so the predicate cannot drift
 * inside this package. Exported so kaval discovery reuses the same body (no
 * parallel kaval copy). `@kolu/surface/unix-socket` now exports the transport
 * layer's original (a failed `lstat` throws; this copy treats that as refuse)
 * for out-of-tree consumers that must judge a directory they did not create.
 */

import { lstatSync } from "node:fs";

export function isPrivateOwnedDir(dir: string): boolean {
  const getuid = process.getuid?.bind(process);
  if (getuid === undefined) return true;
  try {
    const st = lstatSync(dir);
    return st.isDirectory() && st.uid === getuid() && (st.mode & 0o077) === 0;
  } catch {
    // Couldn't stat at all — treat as not-private (refuse) rather than assume safe.
    return false;
  }
}

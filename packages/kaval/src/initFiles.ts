/**
 * Materialising the client-supplied wrapper rcfiles on the host's disk.
 *
 * The pty-host owns the disk the shells run on (possibly a remote machine the
 * client can't reach), so the *host* writes the `initFiles` the client plans —
 * never the client. The host treats each file's content as an opaque blob: it
 * is the client's shell arcana (`kolu-pty`'s replay + OSC hooks), and the host
 * neither reads nor interprets it. The only policy the host enforces is
 * containment — a file name must resolve *under* `rcDir`; one that escapes it
 * (via `..` or an absolute path) is rejected rather than written.
 */

import { mkdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import type { PtyHostInitFile } from "./ptyHostSurface.ts";

/** Resolve `name` under `rcDir`, rejecting any name that escapes it. */
function resolveWithin(rcDir: string, name: string): string {
  const abs = resolve(rcDir, name);
  const rel = relative(rcDir, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`initFile name escapes rcDir: ${JSON.stringify(name)}`);
  }
  return abs;
}

/** Write each init file under `rcDir`, creating parent dirs as needed, and
 *  return the absolute paths written (for {@link removeInitFiles} on dispose).
 *  Throws — before writing anything — if any name escapes `rcDir`. If a write
 *  fails partway, the files already written are removed before rethrowing, so a
 *  failed materialisation never leaves stragglers under `rcDir`.
 *
 *  A name already on disk is a STALE file, and is replaced. These names carry
 *  the terminal id (`bashrc-<id>`, `zdotdir-<id>/.zshrc`), the daemon removes
 *  them when the PTY ends, and it refuses to spawn an id it already holds live
 *  (`ptyHost.ts`'s `entries.has(id)`) — so a file that is still here when a
 *  spawn asks for its name belongs to a PTY that died with a daemon that never
 *  got to clean up (a SIGKILL, an OOM, a crashed redeploy), and `rcDir` is this
 *  daemon's own 0700 runtime home. Refusing used to look safe because a restore
 *  invented a new id and so never met the leftover; now that a terminal keeps
 *  its id across a recycle (padi's `restoreSpawn`), refusing would make one
 *  unclean daemon death permanently un-restorable — the shell would fail to
 *  spawn with `EEXIST` for as long as the runtime dir survives. */
export function writeInitFiles(
  rcDir: string,
  // `readonly`, because that is what an Effect-Schema-decoded `Schema.Array`
  // hands the spawn handler — and this function only reads it.
  files: readonly PtyHostInitFile[],
): string[] {
  // Resolve every name up front so a containment violation aborts the spawn
  // before any file is written (no partial materialisation).
  const planned = files.map((f) => ({
    path: resolveWithin(rcDir, f.name),
    content: f.content,
  }));
  const written: string[] = [];
  try {
    for (const { path, content } of planned) {
      mkdirSync(dirname(path), { recursive: true });
      // Drop any leftover FIRST, so the create below is still exclusive: `wx`
      // on a fresh name keeps the atomic owner-only create (and still refuses a
      // concurrent spawn racing the same name), while the unlink is what makes
      // a dead daemon's residue not outlive it. Unlinking also sheds a symlink
      // rather than following it, which is the property `wx` was here to hold.
      rmSync(path, { force: true });
      writeFileSync(path, content, { flag: "wx", mode: 0o600 });
      written.push(path);
    }
  } catch (err) {
    // A mid-stream write failure (e.g. ENOSPC, EACCES) must not leak the files
    // that already landed — roll back what we wrote, then rethrow.
    removeInitFiles(rcDir, written);
    throw err;
  }
  return written;
}

/** Remove the files {@link writeInitFiles} wrote, then prune the now-empty
 *  parent directories it may have created, up to (but never including) `rcDir`.
 *  Best-effort: a non-empty or already-gone directory ends the prune. */
export function removeInitFiles(rcDir: string, written: string[]): void {
  for (const path of written) {
    rmSync(path, { force: true });
    let dir = dirname(path);
    while (dir !== rcDir && dir.startsWith(rcDir + sep)) {
      try {
        rmdirSync(dir);
      } catch {
        break; // non-empty (a sibling PTY's files) or already removed
      }
      dir = dirname(dir);
    }
  }
}

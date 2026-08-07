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
 *  failed materialisation never leaves stragglers under `rcDir`. */
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
      // These files can contain shell setup and environment values. Create them
      // atomically and owner-only; an existing path is a collision, not a file
      // we are allowed to replace.
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

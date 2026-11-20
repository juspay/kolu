import { mkdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import type { PtyHostInitFile } from "./ptyHostSurface.ts";

function resolveWithin(rcDir: string, name: string): string {
  const abs = resolve(rcDir, name);
  const rel = relative(rcDir, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`initFile name escapes rcDir: ${JSON.stringify(name)}`);
  }
  return abs;
}

function replaceOwnedFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  writeFileSync(path, content, { flag: "wx", mode: 0o600 });
}

/** Write each init file under `rcDir`, creating parent dirs as needed, and
 *  return the absolute paths written (for {@link removeInitFiles} on dispose).
 *  Throws — before writing anything — if any name escapes `rcDir`. If a write
 *  fails partway, the files already written are removed before rethrowing, so a
 *  failed materialisation never leaves stragglers under `rcDir`.
 *
 *  A name already on disk is a STALE file, and is replaced. */
export function writeInitFiles(
  rcDir: string,
  files: readonly PtyHostInitFile[],
): string[] {
  const planned = files.map((f) => ({
    path: resolveWithin(rcDir, f.name),
    content: f.content,
  }));
  const written: string[] = [];
  try {
    for (const { path, content } of planned) {
      replaceOwnedFile(path, content);
      written.push(path);
    }
  } catch (err) {
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
        break;
      }
      dir = dirname(dir);
    }
  }
}

/** Open-file NAMES of a live process — what each of its descriptors points at.
 *
 *  Domain-agnostic: nothing here knows why a caller wants them, only that the
 *  kernel publishes them for a live pid on some platforms. An agent that keeps
 *  its live conversation's lock file open (Antigravity CLI holds
 *  `presence/<id>.lock` for exactly as long as it has that conversation) is
 *  named by these, so the read lives beside `readProcessSnapshot`, which
 *  already owns reading a live process.
 *
 *  NAMES only: each descriptor's link target, never the file's contents. A
 *  socket or pipe answers its kernel label (`socket:[…]`, `pipe:[…]`); the
 *  caller keeps the paths it recognises.
 *
 *  Linux reads `/proc/<pid>/fd`. Every other platform answers `null` —
 *  UNKNOWN, never an empty list: a process with no open files and a platform
 *  that cannot say are different facts, and a caller that read `[]` as "holds
 *  nothing" would release what the process still holds. A failed read (an
 *  exited process, a hidden `/proc`) is `null` for the same reason. */

import fs from "node:fs";
import type { Logger } from "@kolu/log";

/** The link target of every descriptor the process holds, or `null` when they
 *  cannot be read. A descriptor closed between the listing and its readlink is
 *  skipped — it is no longer open. */
export function readOpenFileNames(
  pid: number,
  log?: Logger,
): readonly string[] | null {
  if (process.platform !== "linux") return null;
  const dir = `/proc/${pid}/fd`;
  let fds: string[];
  try {
    fds = fs.readdirSync(dir);
  } catch (err) {
    log?.debug({ err, pid }, "open files unavailable");
    return null;
  }
  const names: string[] = [];
  for (const fd of fds) {
    try {
      names.push(fs.readlinkSync(`${dir}/${fd}`));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      log?.debug({ err, pid, fd }, "open file unreadable");
      return null;
    }
  }
  return names;
}

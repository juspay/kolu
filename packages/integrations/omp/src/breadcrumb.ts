/** The terminal breadcrumb — omp's own anchor from a tty to its live session,
 *  and therefore kolu's.
 *
 *  `<agent dir>/terminal-sessions/<tty id>` (omp's STATE category) is written
 *  synchronously by omp's `SessionManager` whenever a session is created or
 *  switched, BEFORE the session file necessarily exists. Its content is two or
 *  three lines:
 *
 *      /home/u/code/proj                        ← the cwd at write time
 *      /home/u/.omp/agent/sessions/…-/<ts>_<uuid>.jsonl
 *      fresh                                    ← only for a lazy session whose
 *                                                 JSONL is not on disk yet
 *
 *  It is **never deleted** when omp exits (it exists so `omp -c` can find that
 *  terminal's last session), so kolu treats it as evidence only while the
 *  foreground process is `omp` — and, mirroring omp's own reader, only when its
 *  target is live: omp honours a crumb whose session file exists, or one marked
 *  `fresh`, and ignores a crumb pointing at a deleted session (its `--continue`
 *  would too). A crumb omp itself would refuse is not omp's session.
 *
 *  `tty id` is omp's `getTerminalId()`: the stdin tty path with `/dev/`
 *  stripped and `/` → `-` (`/dev/pts/3` → `pts-3`, `/dev/ttys003` → `ttys003`).
 *  omp prefers that path whenever stdin IS a tty — the case kolu's PTYs always
 *  present — and falls back to terminal-emulator env vars (`zellij-…`,
 *  `tmux-…`, `kitty-…`) only for a non-tty stdin, where there is no PTY to
 *  anchor on and kolu derives no id either. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";

/** `<timestamp>_<uuid>.jsonl`. omp forked pi's session-file naming, so the
 *  shape (and this regex) is pi's; the formats are forks and may drift, so it
 *  is copied rather than shared across agent packages (the dependency fence
 *  forbids `kolu-omp` → `kolu-pi`). The timestamp is the creation instant,
 *  rendered with `-` for `:` and `.`. The id is a UUID today; kept unpinned in
 *  shape (any non-empty token) so an upstream id-format change degrades to a
 *  different id, not a lost session — the shell-splice gate
 *  (`ompVocab.resume.idPattern`) refuses a shape it can't splice. */
const SESSION_FILE_RE = /^(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d+Z)_(.+)\.jsonl$/i;

export interface OmpSession {
  /** Session UUID from the transcript filename. */
  id: string;
  /** Absolute path to the session's JSONL transcript — the resume ref omp
   *  accepts verbatim (`omp --resume <path>`) and the file kolu folds. */
  transcriptPath: string;
  /** Epoch-ms the session file was created, from its filename timestamp. Null
   *  when the name carried no parseable timestamp. */
  startedAt: number | null;
}

/** Parse a session filename into its timestamp (epoch-ms) and session id, or
 *  null when the name doesn't carry both. Exported for tests. */
export function parseSessionFileName(
  name: string,
): { id: string; startedAt: number } | null {
  const m = SESSION_FILE_RE.exec(name);
  if (!m?.[1] || !m[2]) return null;
  // The filename timestamp is ISO with the `:`/`.` delimiters rendered as `-`
  // for filesystem safety — restore them by pattern, not by blind replacement
  // (a blind replace would also hit the date's dashes).
  const ms = Date.parse(
    m[1].replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, "T$1:$2:$3.$4Z"),
  );
  return Number.isFinite(ms) ? { id: m[2], startedAt: ms } : null;
}

/** The tty id omp derives for a process, or null when it cannot be read.
 *
 *  Linux reads the stdin symlink (`/proc/<pid>/fd/0`); Darwin asks `ps -o
 *  tty=`. Both mirror omp's `getTtyPath()` + `getTerminalId()`: a path that is
 *  not under `/dev/` (a pipe, a socket), a `??` (no controlling terminal), or
 *  any read failure yields null — and the caller then resolves NO session
 *  rather than a guessed one, which is the honest answer for an id kolu cannot
 *  reproduce. */
export function ttyIdForPid(pid: number, log?: Logger): string | null {
  try {
    if (process.platform === "linux") {
      const link = fs.readlinkSync(`/proc/${pid}/fd/0`);
      if (!link.startsWith("/dev/")) return null;
      return link.slice("/dev/".length).replace(/\//g, "-");
    }
    if (process.platform === "darwin") {
      const out = execFileSync("ps", ["-o", "tty=", "-p", String(pid)], {
        encoding: "utf8",
      }).trim();
      if (out.length === 0 || out === "??" || out.startsWith("-")) return null;
      return out.replace(/^\/dev\//, "").replace(/\//g, "-");
    }
    return null;
  } catch (err) {
    log?.debug({ err, pid }, "omp: tty id unavailable");
    return null;
  }
}

/** Three-valued, because the caller acts on the difference: a crumb that
 *  names no session RELEASES a terminal's binding, while one kolu could not
 *  turn into a session must leave the published state alone. */
export type BreadcrumbRead =
  | { kind: "found"; session: OmpSession }
  | { kind: "absent" }
  | { kind: "unusable" };

/** Read a terminal breadcrumb into the session it names.
 *
 *  `absent` covers both "omp has never run on this tty" (no file) and "omp's
 *  crumb points at a session whose file is gone and which is not marked
 *  `fresh`" — the two cases where omp itself has no session for the terminal.
 *  Everything else that yields no session (a read failure, a crumb whose
 *  target cannot be parsed into an id) is `unusable`: a fault, logged, never
 *  silently read as "no session". */
export function readBreadcrumb(file: string, log?: Logger): BreadcrumbRead {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "absent" };
    }
    log?.error({ err, file }, "omp: breadcrumb unreadable");
    return { kind: "unusable" };
  }
  // omp reads its own crumb with `content.trim().split("\n")` and requires two
  // lines — mirrored here so both sides agree on what a crumb says.
  const lines = raw.trim().split("\n");
  const target = lines[1];
  if (target === undefined || target.length === 0) {
    log?.error({ file }, "omp: breadcrumb has no session path");
    return { kind: "unusable" };
  }
  let exists: boolean;
  try {
    exists = fs.statSync(target, { throwIfNoEntry: false })?.isFile() === true;
  } catch (err) {
    log?.error({ err, file, target }, "omp: breadcrumb target unreadable");
    return { kind: "unusable" };
  }
  // omp's own honour rule (`readTerminalBreadcrumbEntry`): a materialized
  // target resumes; a missing one only when this crumb is a never-written lazy
  // session boundary.
  if (!exists && lines[2] !== "fresh") return { kind: "absent" };
  const parsed = parseSessionFileName(path.basename(target));
  if (!parsed) {
    log?.error({ file, target }, "omp: breadcrumb session path unparseable");
    return { kind: "unusable" };
  }
  return {
    kind: "found",
    session: {
      id: parsed.id,
      transcriptPath: target,
      startedAt: parsed.startedAt,
    },
  };
}

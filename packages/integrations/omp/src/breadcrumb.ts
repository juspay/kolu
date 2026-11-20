import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { meterSyncChild, stampedCache } from "kolu-io";
import type { Logger } from "kolu-shared";

const SESSION_FILE_RE = /^(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d+Z)_(.+)\.jsonl$/;

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
  const ms = Date.parse(
    m[1].replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, "T$1:$2:$3.$4Z"),
  );
  return Number.isFinite(ms) ? { id: m[2], startedAt: ms } : null;
}

function renderTtyId(raw: string): string {
  return raw.replace(/^\/dev\//, "").replace(/\//g, "-");
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
      return renderTtyId(link);
    }
    if (process.platform === "darwin") {
      const argv = ["ps", "-o", "tty=", "-p", String(pid)];
      const out = meterSyncChild(argv, () =>
        execFileSync("ps", argv.slice(1), { encoding: "utf8" }),
      ).trim();
      if (out.length === 0 || out === "??" || out.startsWith("-")) return null;
      return renderTtyId(out);
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

interface NamedCrumb {
  target: string;
  fresh: boolean;
  session: OmpSession | null;
}

type CrumbBytes =
  | ({ kind: "named" } & NamedCrumb)
  | { kind: "absent" }
  | { kind: "unusable" };

const CRUMB_CACHE_MAX = 512;

const crumbs = stampedCache<CrumbBytes>(CRUMB_CACHE_MAX);

/** omp honours a crumb whose session file exists, or one marked `fresh`, and
 *  ignores every other — so a crumb it would ignore is `absent` whatever its
 *  own name parsed into. */
function crumbVerdict(
  crumb: NamedCrumb,
  targetLive: boolean,
  file: string,
  log?: Logger,
): BreadcrumbRead {
  if (!targetLive) return { kind: "absent" };
  if (crumb.session === null) {
    log?.error(
      { file, target: crumb.target },
      "omp: breadcrumb session path unparseable",
    );
    return { kind: "unusable" };
  }
  return { kind: "found", session: crumb.session };
}

/** Read a terminal breadcrumb into the session it names.
 *
 *  `absent` covers both "omp has never run on this tty" (no file) and "omp's
 *  crumb points at a session whose file is gone and which is not marked
 *  `fresh`" — the two cases where omp itself has no session for the terminal.
 *  Everything else that yields no session (a read failure, a crumb whose
 *  target cannot be parsed into an id) is `unusable`: a fault, logged, never
 *  silently read as "no session".
 *
 *  The TRANSCRIPT's existence is stat'd on EVERY call, never cached: it is a
 *  fact about a different file, and a crumb whose target was deleted must stop
 *  reading as `found` even though the crumb itself never moved. Only the crumb
 *  parse rides the stamp. */
export function readBreadcrumb(file: string, log?: Logger): BreadcrumbRead {
  const content = crumbs.read(file, (stat) =>
    readCrumbContent(file, stat, log),
  );
  if (content.kind !== "named") return { kind: content.kind };
  let targetLive: boolean;
  try {
    targetLive =
      fs.statSync(content.target, { throwIfNoEntry: false })?.isFile() ===
        true || content.fresh;
  } catch (err) {
    log?.error(
      { err, file, target: content.target },
      "omp: breadcrumb target unreadable",
    );
    return { kind: "unusable" };
  }
  return crumbVerdict(content, targetLive, file, log);
}

function readCrumbContent(
  file: string,
  stat: fs.Stats | undefined,
  log?: Logger,
): CrumbBytes {
  if (stat === undefined) return { kind: "absent" };
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
  const lines = raw.trim().split("\n");
  const target = lines[1];
  if (target === undefined || target.length === 0) {
    log?.error({ file }, "omp: breadcrumb has no session path");
    return { kind: "unusable" };
  }
  const parsed = parseSessionFileName(path.basename(target));
  return {
    kind: "named",
    target,
    fresh: lines[2] === "fresh",
    session:
      parsed === null
        ? null
        : {
            id: parsed.id,
            transcriptPath: target,
            startedAt: parsed.startedAt,
          },
  };
}

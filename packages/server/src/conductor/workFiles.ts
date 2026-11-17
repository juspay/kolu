/**
 * THE FILES A PIECE OF WORK LEAVES BEHIND — `kolu-conductor`'s {@link WorkFiles}
 * port, implemented over the fleet's padi clients.
 *
 * A waterfall writes its plan, its notes and its review into `.waterfall/` in
 * the worktree it works in. kolu records each one appearing as an event, and
 * when the work ENDS it copies them here, under the state root, so they outlive
 * the worktree a merge deletes. The record is the conductor's
 * (`kolu-conductor` decides WHEN to list and what to keep); this module is the
 * I/O half, which is the part that needs the host map, a padi client per host
 * and a disk to write on.
 *
 * ## Two reads, both the fleet's existing ones
 *
 * LISTING is `kolu-common/workFiles`' walk — every file under `.waterfall/`,
 * at any depth, up to its entry limit — over `fs.listDirectory`, the same
 * one-level read the Code tab's file tree expands a folder with. The browser
 * lists a live work's files with the same walk over its own procedures, so
 * the card, the timeline and what is kept read one list. An absent
 * `.waterfall/` is an EMPTY list (the walk's rule, on padi's `FileGone`);
 * every other failure rejects with a sentence, because "the machine did not
 * answer" must never render as "the work produced nothing".
 *
 * KEEPING is the iframe preview's remote byte read — `preview.read` driven in
 * bounded ranges by `assembleRemotePreview` (`iframePreviewRoute.ts`), the one
 * remote-safe file read this server has. Reusing it is the brief's "no new
 * transport": a remote host's bytes come back through the daemon that already
 * serves them, with an O(chunk) heap on both hops, and the local host rides the
 * same path rather than a second, local-only one — one code path, one set of
 * guards, no "which arm am I on" question at the call site.
 *
 * ## Where the bytes land, the budget, and the containment guard
 *
 * `<stateRoot>/works/<work>/<path>`, owner-only, and NOTHING may land outside
 * that directory. A keep copies at most `WORK_FILES_KEPT_BYTES`, counted as
 * the bytes arrive: a file that would go past it is deleted rather than left
 * half-written, named as left out, and the copy goes on — a smaller file
 * after it can still fit. The paths come from a remote host's listing, so
 * they are UNTRUSTED input to this process's disk: both the work id and each
 * path are resolved and checked against the work's own directory before
 * anything is written. `sweep` deletes every directory under `works/` that no
 * stored work names — run after the 20-work cap drops one and after a backup
 * restore replaces the set wholesale, which is the only reason kolu is
 * allowed to delete them.
 */

import type { Dirent } from "node:fs";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { Effect, Result } from "effect";
import { encodePreviewPath } from "kolu-common/preview";
import { listWorkFiles, WORK_FILES_KEPT_BYTES } from "kolu-common/workFiles";
import type { WorkFiles } from "kolu-conductor";
import type { FleetHosts } from "kolu-mcp";
import { compareWaterfallPaths, type KeptFile, WATERFALL_DIR } from "kolu-work";
import type { Logger } from "pino";
import {
  assembleRemotePreview,
  REMOTE_PREVIEW_CHUNK_BYTES,
  remotePreviewReader,
} from "../iframePreviewRoute.ts";

/** A file that would take a keep past its budget — thrown by the counting
 *  stream, caught by the copy, never seen by a caller. */
class OverBudget extends Error {}

/** `<stateRoot>/works/<dir>`, with the name checked for containment — the ONE
 *  place a work's directory name becomes a directory on this machine's disk.
 *
 *  THE NAME, NEVER THE WORK ID: a work id is `branch:<host>/<repo>/<branch>`
 *  and carries separators, so what every caller passes is `workDirOf(id)`
 *  (`kolu-conductor`'s hash, beside the port this implements) — the writer,
 *  the sweep (which reads these names back off the directory) and the route
 *  that serves them all spell the layout that one way.
 *
 *  The guard is about what COULD arrive rather than what does: the callers
 *  write, DELETE and SERVE under what this returns, and `workFilesRoute.ts`
 *  reaches it from a URL.
 *
 *  Throws rather than answering null: every caller has already decided it is
 *  acting on this work, and there is no sensible directory to fall back to. */
export function workFilesDir(stateRoot: string, dir: string): string {
  const root = join(stateRoot, "works");
  const full = resolve(root, dir);
  if (full !== join(root, dir) || !full.startsWith(root + sep)) {
    throw new Error(
      `kolu-server: ${JSON.stringify(dir)} is not a directory name this server can keep a work's files under — it escapes ${root}`,
    );
  }
  return full;
}

/** Where ONE kept file goes, with the same containment check against the
 *  work's own directory — the paths are a remote host's listing, and a listing
 *  is not an authority over this machine's disk. */
function keptPath(dir: string, path: string): string {
  const abs = resolve(dir, path);
  if (!abs.startsWith(dir + sep)) {
    throw new Error(
      `kolu-server: refusing to keep ${JSON.stringify(path)} — it escapes ${dir}`,
    );
  }
  return abs;
}

export function workFilesOverHosts(deps: {
  /** The fleet, for the client behind a host key — the SAME map the watch
   *  reads, so a work's files are read over the link its terminals are read
   *  over. */
  readonly hosts: Pick<FleetHosts, "padi" | "display" | "state">;
  /** `<KOLU_STATE_DIR>` — `works/` is its corner for this. */
  readonly stateRoot: string;
  readonly log: Logger;
}): WorkFiles {
  const { hosts, stateRoot, log } = deps;

  /** That host's client, or a refusal naming the host and what it is doing.
   *  Disconnected is not "no files": the conversation records a keep that
   *  could not happen (`keepFailed`), and this sentence is what it records. */
  const clientOf = (host: string) => {
    const padi = hosts.padi(host);
    if (padi === null) {
      throw new Error(
        `${hosts.display(host)} is ${hosts.state(host)}, not connected — kolu cannot read the work's files until it reaches that host again`,
      );
    }
    return padi;
  };

  return {
    list: async ({ host, worktree }) => {
      const padi = clientOf(host);
      const listed = await Effect.runPromise(
        Effect.result(
          listWorkFiles((dirPath) =>
            padi.surface.fs.listDirectory({ repoPath: worktree, dirPath }),
          ),
        ),
      );
      if (Result.isFailure(listed))
        throw new Error(
          `kolu could not list ${WATERFALL_DIR} in ${worktree} on ${hosts.display(host)}: ${String(listed.failure)}`,
        );
      return listed.success;
    },

    keep: async ({ host, worktree, work, paths }) => {
      const padi = clientOf(host);
      const dir = workFilesDir(stateRoot, work);
      let budget = WORK_FILES_KEPT_BYTES;
      const tooBig: string[] = [];

      for (const path of paths) {
        const dest = keptPath(dir, path);
        const served = await Effect.runPromise(
          assembleRemotePreview(
            remotePreviewReader(
              (input) => padi.surface.preview.read(input),
              worktree,
              // serve-dir decodes the tail it is handed exactly once, so the
              // path crosses as kolu's own preview encoding — a file with a
              // space or a `#` in its name reads back as itself.
              encodePreviewPath(path),
            ),
            undefined,
            undefined,
            REMOTE_PREVIEW_CHUNK_BYTES,
          ),
        );
        if (served.status === 404) {
          // Listed a moment ago, gone now — an agent cleaning up, a worktree
          // removed between the end of the work and this copy. Not a failure
          // of the keep: the other files still land, and a file that is not
          // there is not kept.
          log.debug(
            { work, path },
            "kolu-server: a work's file went away before it could be kept",
          );
          continue;
        }
        if (served.status !== 200 || typeof served.body === "string") {
          throw new Error(
            `kolu could not read ${path} in ${worktree} on ${hosts.display(host)} (${served.status}${typeof served.body === "string" ? `: ${served.body}` : ""})`,
          );
        }
        await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
        // Streamed into the file rather than buffered: the body is already a
        // bounded-chunk stream, and a kept file is whatever the agent wrote.
        // COUNTED as it goes: the first byte past what is left of the budget
        // stops the copy (and, through the pipeline, the reads behind it).
        //
        // The cast is the two `ReadableStream` TYPES node ships — the global
        // (lib.dom) one serve-dir's `ServeResult` is written against, and
        // `node:stream/web`'s, which `Readable.fromWeb` takes. One runtime
        // object, two structurally-near declarations; nothing is being
        // asserted about the value.
        let wrote = 0;
        try {
          await pipeline(
            Readable.fromWeb(served.body as unknown as WebReadableStream),
            new Transform({
              transform(chunk: Buffer, _encoding, next) {
                wrote += chunk.byteLength;
                if (wrote > budget) next(new OverBudget());
                else next(null, chunk);
              },
            }),
            createWriteStream(dest, { mode: 0o600 }),
          );
        } catch (err) {
          // Never left half-written, whatever stopped it.
          await rm(dest, { force: true });
          if (!(err instanceof OverBudget)) throw err;
          tooBig.push(path);
          continue;
        }
        budget -= wrote;
      }
      // WHAT THE DIRECTORY HOLDS, not what this call copied. A work that
      // ended, was reopened and ended again keeps what its earlier ending
      // left here (the sweep spares every stored work's directory, Open or
      // Ended), so the list a card shows is the directory itself — read back
      // after the copy, which is the only reading that cannot disagree with
      // the disk. Nothing there at all — nothing was ever kept for this work
      // and nothing landed now — is an empty list, not a failure.
      let present: Dirent[];
      try {
        present = await readdir(dir, { withFileTypes: true, recursive: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT")
          return { kept: [], tooBig };
        throw err;
      }
      const kept: KeptFile[] = [];
      for (const entry of present) {
        if (!entry.isFile()) continue;
        const at = join(entry.parentPath, entry.name);
        kept.push({ path: relative(dir, at), bytes: (await stat(at)).size });
      }
      return {
        kept: kept.sort((a, b) => compareWaterfallPaths(a.path, b.path)),
        tooBig,
      };
    },

    sweep: async (keep) => {
      // ONE RULE, run after any cap and after a restore: a kept-files
      // directory no stored work names is nobody's, so it goes. EVERY stored
      // work names one, Open or Ended: a work that ended, kept its files and
      // was reopened still owns what it left here, and deleting it the moment
      // the card said "in progress" would lose a merged branch's plan. Stating
      // it as "delete what is not named" rather than "delete this id" is what
      // makes a RESTORE safe — the snapshot's works are a different set, not a
      // difference anyone computed — and it is also the only reason kolu is
      // allowed to delete these files at all.
      const wanted = new Set(keep);
      const root = join(stateRoot, "works");
      let present: Dirent[];
      try {
        present = await readdir(root, { withFileTypes: true });
      } catch (err) {
        // Nothing has ever been kept on this machine — the ordinary state of a
        // fresh install, and nothing to sweep.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      for (const entry of present) {
        if (!entry.isDirectory() || wanted.has(entry.name)) continue;
        log.debug(
          { work: entry.name },
          "kolu-server: forgetting the kept files of a work nothing stores",
        );
        await rm(workFilesDir(stateRoot, entry.name), {
          recursive: true,
          force: true,
        });
      }
    },
  };
}

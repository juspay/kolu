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
 * LISTING is `fs.listDirectory` — one level, no recursion, the same read the
 * Code tab's file tree expands a folder with. An absent `.waterfall/` is an
 * EMPTY list, not a failure: a work that never wrote one is ordinary, and
 * padi answers that case with its own `FileGone`. Every other failure rejects
 * with a sentence, because "the machine did not answer" must never render as
 * "the work produced nothing".
 *
 * KEEPING is the iframe preview's remote byte read — `preview.read` driven in
 * bounded ranges by `assembleRemotePreview` (`iframePreviewRoute.ts`), the one
 * remote-safe file read this server has. Reusing it is the brief's "no new
 * transport": a remote host's bytes come back through the daemon that already
 * serves them, with an O(chunk) heap on both hops, and the local host rides the
 * same path rather than a second, local-only one — one code path, one set of
 * guards, no "which arm am I on" question at the call site.
 *
 * ## Where the bytes land, and the containment guard
 *
 * `<stateRoot>/works/<work>/<path>`, owner-only, and NOTHING may land outside
 * that directory. The paths come from a remote host's listing, so they are
 * UNTRUSTED input to this process's disk: both the work id and each path are
 * resolved and checked against the work's own directory before anything is
 * written. `forget` deletes that directory — the 20-work cap dropping a work
 * takes its kept files with it, which is the only reason kolu is allowed to
 * delete them.
 */

import { FileGone } from "@kolu/padi-client/surface";
import { Effect, Result } from "effect";
import type { WorkFiles } from "kolu-conductor";
import { encodePreviewPath } from "kolu-common/preview";
import type { FleetHosts } from "kolu-mcp";
import type { KeptFile } from "kolu-work";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Logger } from "pino";
import {
  REMOTE_PREVIEW_CHUNK_BYTES,
  assembleRemotePreview,
  remotePreviewReader,
} from "../iframePreviewRoute.ts";

/** The directory a waterfall writes into, relative to the worktree. The one
 *  place this server spells it; the event detail and the kept path keep the
 *  prefix, so a card's "Files" list reads the way the agent wrote it. */
const WATERFALL_DIR = ".waterfall";

/** `<stateRoot>/works/<work>`, with the work id checked for containment — the
 *  ONE place that turns a work id into a directory on this machine's disk.
 *
 *  A work id is minted by kolu, so this guard is about what COULD arrive, not
 *  what does: an id carrying a separator or a `..` would address a directory
 *  outside the works corner, and the callers write, DELETE and SERVE under
 *  what it returns (`workFilesRoute.ts` is the serving one — a work id off a
 *  URL is the untrusted case this exists for).
 *
 *  Throws rather than answering null: every caller has already decided it is
 *  acting on this work, and there is no sensible directory to fall back to. */
export function workFilesDir(stateRoot: string, work: string): string {
  const root = join(stateRoot, "works");
  const dir = resolve(root, work);
  if (dir !== join(root, work) || !dir.startsWith(root + sep)) {
    throw new Error(
      `kolu-server: ${JSON.stringify(work)} is not a work id this server can keep files for — it escapes ${root}`,
    );
  }
  return dir;
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
          padi.surface.fs.listDirectory({
            repoPath: worktree,
            dirPath: WATERFALL_DIR,
          }),
        ),
      );
      if (Result.isFailure(listed)) {
        // The directory is not there — a work that has written no plan yet,
        // or one whose worktree has been removed. padi's own tag for it, so
        // this is a reading rather than an errno sniff.
        if (listed.failure instanceof FileGone) return [];
        throw new Error(
          `kolu could not list ${WATERFALL_DIR} in ${worktree} on ${hosts.display(host)}: ${String(listed.failure)}`,
        );
      }
      // One level, files only: `listDirectory` marks a directory with a
      // trailing slash, and a waterfall's output is files in one folder. No
      // recursion — a nested directory in there is somebody else's build
      // output, not a document the work produced.
      return listed.success.paths.filter((path) => !path.endsWith("/"));
    },

    keep: async ({ host, worktree, work, paths }) => {
      const padi = clientOf(host);
      const dir = workFilesDir(stateRoot, work);
      const kept: KeptFile[] = [];
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
        //
        // The cast is the two `ReadableStream` TYPES node ships — the global
        // (lib.dom) one serve-dir's `ServeResult` is written against, and
        // `node:stream/web`'s, which `Readable.fromWeb` takes. One runtime
        // object, two structurally-near declarations; nothing is being
        // asserted about the value.
        await writeFile(
          dest,
          Readable.fromWeb(served.body as unknown as WebReadableStream),
          { mode: 0o600 },
        );
        kept.push({ path, bytes: (await stat(dest)).size });
      }
      return kept;
    },

    forget: async (work) => {
      await rm(workFilesDir(stateRoot, work), { recursive: true, force: true });
    },
  };
}

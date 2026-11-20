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

class OverBudget extends Error {}

const webStreamOf = (body: ReadableStream): WebReadableStream =>
  body as unknown as WebReadableStream;

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

function keptPath(dir: string, path: string): string {
  const abs = resolve(dir, path);
  if (!abs.startsWith(dir + sep)) {
    throw new Error(
      `kolu-server: refusing to keep ${JSON.stringify(path)} — it escapes ${dir}`,
    );
  }
  return abs;
}

async function keptIn(dir: string): Promise<ReadonlyArray<KeptFile>> {
  let present: Dirent[];
  try {
    present = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const kept: KeptFile[] = [];
  for (const entry of present) {
    if (!entry.isFile()) continue;
    const at = join(entry.parentPath, entry.name);
    kept.push({ path: relative(dir, at), bytes: (await stat(at)).size });
  }
  return kept.sort((a, b) => compareWaterfallPaths(a.path, b.path));
}

export function workFilesOverHosts(deps: {
  readonly hosts: Pick<FleetHosts, "padi" | "display" | "state">;
  readonly stateRoot: string;
  readonly log: Logger;
}): WorkFiles {
  const { hosts, stateRoot, log } = deps;

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
      const before = new Map(
        (await keptIn(dir)).map((one) => [one.path, one.bytes] as const),
      );
      let budget =
        WORK_FILES_KEPT_BYTES -
        [...before.values()].reduce((sum, bytes) => sum + bytes, 0);
      const tooBig: string[] = [];

      for (const path of [...paths].sort(compareWaterfallPaths)) {
        const dest = keptPath(dir, path);
        const served = await Effect.runPromise(
          assembleRemotePreview(
            remotePreviewReader(
              (input) => padi.surface.preview.read(input),
              worktree,
              encodePreviewPath(path),
            ),
            undefined,
            undefined,
            REMOTE_PREVIEW_CHUNK_BYTES,
          ),
        );
        if (served.status === 404) {
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
        const older = before.get(path) ?? 0;
        let wrote = 0;
        try {
          await pipeline(
            Readable.fromWeb(webStreamOf(served.body)),
            new Transform({
              transform(chunk: Buffer, _encoding, next) {
                wrote += chunk.byteLength;
                if (wrote > budget + older) next(new OverBudget());
                else next(null, chunk);
              },
            }),
            createWriteStream(dest, { mode: 0o600 }),
          );
        } catch (err) {
          await rm(dest, { force: true });
          if (!(err instanceof OverBudget)) throw err;
          tooBig.push(path);
          budget += older;
          continue;
        }
        budget += older - wrote;
      }
      return { kept: await keptIn(dir), tooBig };
    },

    sweep: async (keep) => {
      const wanted = new Set(keep);
      const root = join(stateRoot, "works");
      let present: Dirent[];
      try {
        present = await readdir(root, { withFileTypes: true });
      } catch (err) {
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

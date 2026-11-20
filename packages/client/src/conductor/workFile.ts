import type { FileWithSource, FileWithUrl } from "@kolu/solid-fileview";
import { Effect, Option } from "effect";
import { decodeHostKey } from "kolu-common/hostKey";
import {
  buildTerminalFileUrl,
  encodePreviewPath,
  isBinaryPreviewable,
} from "kolu-common/preview";
import type { TerminalId } from "kolu-common/surface";
import { listWorkFiles } from "kolu-common/workFiles";
import { keptOf, waterfallFileName, type Work, type WorkId } from "kolu-work";
import { type Accessor, createMemo, createResource } from "solid-js";
import { fleetTerminalStanding } from "../palette/fleetTerminals";
import { runActionPromise } from "../runAction";
import { padiMap } from "../wire";
import { splitMemberRef } from "./memberRef";
import type { WorkMemberRow } from "./workReadings";

/** WHERE a work's files are read from while it is in progress: the member
 *  terminal whose worktree holds them. `repoPath` is that worktree's root as
 *  the member's own git reading gives it. */
export interface WorkPlace {
  readonly host: string;
  readonly terminalId: TerminalId;
  readonly repoPath: string;
}

/** ONE ROW of a work's file list: the path as the record holds it, and — for
 *  a file kolu kept — how many bytes it kept. */
export interface WorkFileRow {
  readonly path: string;
  readonly bytes: Option.Option<number>;
}

/** A WORK'S FILES, as one list: every row, and whether the listing stopped at
 *  its limit with more left (`kolu-common/workFiles`). */
export interface WorkFilesRead {
  readonly rows: ReadonlyArray<WorkFileRow>;
  readonly more: boolean;
}

export interface WorkFileSource {
  /** The terminal the bytes (and the comments on them) belong to, and `null`
   *  is the whole of "these are the files kolu kept". */
  readonly at: { host: string; terminalId: TerminalId } | null;
  readonly list: () => Promise<WorkFilesRead>;
  readonly read: (path: string) => Promise<FileWithSource | FileWithUrl>;
}

export const workFileName = waterfallFileName;

function workPlaceOf(members: ReadonlyArray<WorkMemberRow>): WorkPlace | null {
  for (const { terminal } of members) {
    const split = splitMemberRef(terminal);
    if (split === null) continue;
    const standing = fleetTerminalStanding(split.host, split.id);
    if (standing.kind !== "here") continue;
    const git = standing.meta.git;
    if (git.kind !== "repo") continue;
    return {
      host: split.host,
      terminalId: split.id,
      repoPath: git.info.repoRoot,
    };
  }
  return null;
}

/** Where kolu serves the files it kept when a work ended. The shape is the
 *  route kolu-server registers; the path is encoded per segment, exactly as
 *  the per-terminal file route encodes its own. */
export function workFileUrl(work: WorkId, path: string): string {
  return `/api/works/${encodeURIComponent(work)}/files/${encodePreviewPath(path)}`;
}

/** THE SOURCE FOR ONE WORK, chosen once: the live worktree while a member
 *  reports one, kolu's kept copy otherwise. */
export function workFileSource(
  id: WorkId,
  work: Work,
  members: ReadonlyArray<WorkMemberRow>,
): WorkFileSource {
  const place = workPlaceOf(members);
  if (place === null) {
    const rows = Option.match(keptOf(work), {
      onNone: (): ReadonlyArray<WorkFileRow> => [],
      onSome: (kept) =>
        kept.map((one) => ({
          path: one.path,
          bytes: Option.some(one.bytes),
        })),
    });
    return {
      at: null,
      list: () => Promise.resolve({ rows, more: false }),
      read: (path) => readKeptFile(id, path),
    };
  }
  return {
    at: { host: place.host, terminalId: place.terminalId },
    list: () => listLiveFiles(place),
    read: (path) => readWorkFile(place, path),
  };
}

export function createWorkFiles(source: Accessor<WorkFileSource | null>): {
  readonly rows: Accessor<ReadonlyArray<WorkFileRow>>;
  readonly more: Accessor<boolean>;
  readonly error: Accessor<Error | undefined>;
  readonly pending: Accessor<boolean>;
} {
  const [listed] = createResource(source, (one) => one.list());
  const ok = () => (listed.error === undefined ? listed() : undefined);
  return {
    rows: createMemo(() => ok()?.rows ?? []),
    more: () => ok()?.more ?? false,
    error: () => listed.error as Error | undefined,
    pending: () => listed.loading,
  };
}

function listLiveFiles(place: WorkPlace): Promise<WorkFilesRead> {
  const fs = padiMap.entry(decodeHostKey(place.host)).procedures.fs;
  return runActionPromise(
    listWorkFiles((dirPath) =>
      fs.listDirectory({ repoPath: place.repoPath, dirPath }),
    ).pipe(
      Effect.map(({ paths, more }) => ({
        rows: paths.map((path) => ({ path, bytes: Option.none() })),
        more,
      })),
    ),
  );
}

function readWorkFile(
  place: WorkPlace,
  path: string,
): Promise<FileWithSource | FileWithUrl> {
  const rpc = padiMap.entry(decodeHostKey(place.host)).procedures.fs;
  if (isBinaryPreviewable(path))
    return runActionPromise(
      rpc.filePreviewTag({ repoPath: place.repoPath, filePath: path }).pipe(
        Effect.map(
          (tag): FileWithUrl => ({
            path,
            url: `${buildTerminalFileUrl(place.host, place.terminalId, path)}?v=${tag}`,
          }),
        ),
      ),
    );
  return runActionPromise(
    rpc.readFile({ repoPath: place.repoPath, filePath: path }).pipe(
      Effect.map(
        ({ content, truncated }): FileWithSource => ({
          path,
          source: { content, truncated },
        }),
      ),
    ),
  );
}

async function readKeptFile(
  work: WorkId,
  path: string,
): Promise<FileWithSource | FileWithUrl> {
  const url = workFileUrl(work, path);
  if (isBinaryPreviewable(path)) return { path, url };
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${response.status} reading the kept ${path}`);
  return { path, source: { content: await response.text(), truncated: false } };
}

/** A WORK'S FILES — where they are read from, what they are called, and the
 *  bytes behind the one that is open.
 *
 *  TWO PLACES, one shape. While a work is in flight its files are in a
 *  member's worktree on that member's host, read through the same padi
 *  procedures the Code tab reads a repo with. When it has ended, kolu has
 *  copied them into its own state directory and serves them over
 *  `/api/works/<work>/files/<path>` — the worktree may be gone by then, and a
 *  plan nobody can open is a plan nobody kept.
 *
 *  WHICH OF THE TWO IS CHOSEN ONCE, HERE. The card's list, the reader's tabs,
 *  the reader's document and its comments used to branch on `place === null`
 *  at five sites, with the list derivation written out twice; now
 *  {@link workFileSource} picks the strategy and every face holds the source
 *  and asks it — the same ignorance `BrowseFileDispatcher` already has about
 *  which transport handed it a file.
 *
 *  Both transports answer `@kolu/solid-fileview`'s two shapes, so the ONE
 *  viewer draws either without knowing which it got. */

import { formatBytes } from "@kolu/byte-units";
import type { FileWithSource, FileWithUrl } from "@kolu/solid-fileview";
import { Effect } from "effect";
import { decodeHostKey } from "kolu-common/hostKey";
import {
  buildTerminalFileUrl,
  encodePreviewPath,
  isBinaryPreviewable,
} from "kolu-common/preview";
import type { TerminalId } from "kolu-common/surface";
import {
  keptOf,
  WATERFALL_DIR,
  waterfallFileName,
  type Work,
  type WorkId,
} from "kolu-work";
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

/** ONE ROW of a work's file list: the path as the record holds it, and
 *  whatever is worth saying beside it (a kept file's size). */
export interface WorkFileRow {
  readonly path: string;
  readonly note: string;
}

/** WHERE A WORK'S FILES COME FROM — the live worktree, or kolu's own copy.
 *
 *  `at` is the terminal the bytes (and the comments on them) belong to, and
 *  `null` is the whole of "these are the files kolu kept": a kept file has no
 *  tree to anchor a comment to, and every face reads that one flag rather
 *  than re-deciding what a `null` place means. */
export interface WorkFileSource {
  readonly at: { host: string; terminalId: TerminalId } | null;
  readonly list: () => Promise<ReadonlyArray<WorkFileRow>>;
  readonly read: (path: string) => Promise<FileWithSource | FileWithUrl>;
}

/** The file's own name, as every face of a work says it: the directory a
 *  waterfall writes into is where kolu looks, not a thing a person reads. */
export const workFileName = waterfallFileName;

/** The directory as padi's `listDirectory` takes it — the one spelling lives
 *  in `kolu-work`; what this adds is the trailing slash a path grammar wants
 *  and a directory argument does not. */
const WATERFALL_PATH = WATERFALL_DIR.replace(/\/+$/, "");

/** WHERE A WORK'S LIVE FILES ARE — the first member whose own git reading
 *  names a worktree, in the order a waterfall runs its members.
 *
 *  A work that has ENDED has no members at all, so this answers `null` for
 *  one by construction, and the kept copy is what every face then reads. */
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
    const kept = keptOf(work);
    return {
      at: null,
      list: () =>
        Promise.resolve(
          kept.map((one) => ({
            path: one.path,
            note: formatBytes(one.bytes),
          })),
        ),
      read: (path) => readKeptFile(id, path),
    };
  }
  return {
    at: { host: place.host, terminalId: place.terminalId },
    list: () => listWorkFiles(place),
    read: (path) => readWorkFile(place, path),
  };
}

/** THE WORK'S FILES AS ROWS, for a face that draws them — one derivation,
 *  used by the card's list and by the reader's tabs.
 *
 *  A failed read is read as the EMPTY list, never by touching the resource's
 *  value: a Solid resource RE-THROWS its failure at whoever reads it, and
 *  both faces read this inside their render — so a worktree kolu could not
 *  list used to take the whole page down ("kolu broke") instead of the one
 *  line the section already has for saying so. */
export function createWorkFiles(source: Accessor<WorkFileSource | null>): {
  readonly rows: Accessor<ReadonlyArray<WorkFileRow>>;
  readonly error: Accessor<Error | undefined>;
  readonly pending: Accessor<boolean>;
} {
  const [listed] = createResource(source, (one) => one.list());
  return {
    rows: createMemo(() =>
      listed.error === undefined ? (listed() ?? []) : [],
    ),
    error: () => listed.error as Error | undefined,
    pending: () => listed.loading,
  };
}

/** The files directly in a member's `.waterfall/`, worktree-relative. One
 *  level, no recursion, directories dropped — the same reading kolu's own
 *  watch takes when it records a `file` event.
 *
 *  A worktree with NO `.waterfall/` is the ordinary state of a piece of work
 *  nobody has written a plan in yet, and padi answers that with its declared
 *  `FileGone`. It is not a failure to report: it reads as the empty list, the
 *  same answer kolu's own watch gives for an absent directory. Anything else
 *  (a host that went away mid-read) stays a failure, which the card says in a
 *  line. */
function listWorkFiles(place: WorkPlace): Promise<ReadonlyArray<WorkFileRow>> {
  return runActionPromise(
    padiMap
      .entry(decodeHostKey(place.host))
      .procedures.fs.listDirectory({
        repoPath: place.repoPath,
        dirPath: WATERFALL_PATH,
      })
      .pipe(
        Effect.map(({ paths }) =>
          paths
            .filter((path) => !path.endsWith("/"))
            .map((path) => ({ path, note: "" })),
        ),
        Effect.catchTag(
          "FileGone",
          (): Effect.Effect<ReadonlyArray<WorkFileRow>> => Effect.succeed([]),
        ),
      ),
  );
}

/** The bytes of one file in a member's worktree, as the viewer takes them.
 *  A previewable binary never travels the wire: it is a URL the browser loads
 *  through the host's own file route, with the content hash as its cache key
 *  so an identical rewrite does not reload the image. */
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

/** The bytes of a file kolu kept — fetched from its own route, same origin.
 *  A binary is handed over as the URL itself; text is read so the markdown
 *  renderer has something to render. */
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

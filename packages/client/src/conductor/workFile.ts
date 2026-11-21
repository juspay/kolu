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

/** WHERE a work's files are read from while it is in progress: the worktree
 *  the work itself keeps (`Work.worktree`), on its host — and the member
 *  terminal on that host whose address a picture is fetched from and whose
 *  comments a file carries, or `null` while none is here. */
export interface WorkPlace {
  readonly host: string;
  readonly repoPath: string;
  readonly terminalId: TerminalId | null;
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

/** WHERE A WORK'S FILES COME FROM — the live worktree, or kolu's own copy.
 *
 *  `at` is the terminal the bytes (and the comments on them) belong to, and
 *  `null` is the whole of "these are the files kolu kept": a kept file has no
 *  tree to anchor a comment to, and every face reads that one flag rather
 *  than re-deciding what a `null` place means. */
export interface WorkFileSource {
  readonly at: { host: string; terminalId: TerminalId } | null;
  readonly list: () => Promise<WorkFilesRead>;
  readonly read: (path: string) => Promise<FileWithSource | FileWithUrl>;
}

/** The file's own name, as every face of a work says it: the directory a
 *  waterfall writes into is where kolu looks, not a thing a person reads. */
export const workFileName = waterfallFileName;

/** WHERE A WORK'S LIVE FILES ARE — the ONE reading of a work's worktree in
 *  the browser: the worktree the work keeps on its own record, which
 *  outlives its terminals, and none for a work kolu has not read one for yet.
 *  The files, the Worktree part and the Code view all read this.
 *
 *  A work that has ENDED reads the copies kolu kept instead, so this answers
 *  `null` for one. */
export function workPlaceOf(
  work: Work,
  members: ReadonlyArray<WorkMemberRow>,
): WorkPlace | null {
  if (work.state.kind !== "open" || work.worktree.kind !== "read") return null;
  const { host, path } = work.worktree;
  // A member on the worktree's host that is here: the terminal a picture's
  // address and a comment hang on.
  const terminal = members
    .map(({ terminal }) => splitMemberRef(terminal))
    .find(
      (one) =>
        one !== null &&
        one.host === host &&
        fleetTerminalStanding(one.host, one.id).kind === "here",
    );
  return { host, repoPath: path, terminalId: terminal?.id ?? null };
}

/** Where kolu serves the files it kept when a work ended. The shape is the
 *  route kolu-server registers; the path is encoded per segment, exactly as
 *  the per-terminal file route encodes its own. */
export function workFileUrl(work: WorkId, path: string): string {
  return `/api/works/${encodeURIComponent(work)}/files/${encodePreviewPath(path)}`;
}

/** THE SOURCE FOR ONE WORK, chosen once: the worktree it keeps while it is
 *  in progress, kolu's kept copy once it has ended. */
export function workFileSource(
  id: WorkId,
  work: Work,
  members: ReadonlyArray<WorkMemberRow>,
): WorkFileSource {
  const place = workPlaceOf(work, members);
  if (place === null) {
    // THE KEPT COPY, which only a work that has ENDED has. A work still in
    // progress whose worktree kolu has not read yet has nowhere to read from
    // at all — that is the `none` arm, not an empty kept copy. Read HERE,
    // while the caller's memo is tracking, not inside `list`: the work is a
    // live record that is updated in place, so the copy landing a moment
    // after the work ended must re-choose the source, or the card says
    // "Nothing was written" over files kolu has just kept.
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
    at:
      place.terminalId === null
        ? null
        : { host: place.host, terminalId: place.terminalId },
    list: () => listLiveFiles(place),
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

/** Every file under a member's `.waterfall/`, worktree-relative, at any
 *  depth — `kolu-common`'s one walk over this host's `fs.listDirectory`, the
 *  same walk kolu's own watch takes when it records a `file` event. A
 *  worktree with no `.waterfall/` is the empty list (the walk's rule);
 *  anything else (a host that went away mid-read) stays a failure, which the
 *  card says in a line. */
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

/** The bytes of one file in the work's worktree, as the viewer takes them.
 *  A previewable binary never travels the wire: it is a URL the browser loads
 *  through the host's own file route, with the content hash as its cache key
 *  so an identical rewrite does not reload the image. That route is a
 *  terminal's, so a picture can be shown only while a member terminal on the
 *  worktree's host is here — and says so, rather than drawing nothing. */
function readWorkFile(
  place: WorkPlace,
  path: string,
): Promise<FileWithSource | FileWithUrl> {
  const rpc = padiMap.entry(decodeHostKey(place.host)).procedures.fs;
  if (isBinaryPreviewable(path)) {
    const terminalId = place.terminalId;
    if (terminalId === null)
      return Promise.reject(
        new Error(
          `${path} is a picture, and no terminal of this work is up on its host to show it through`,
        ),
      );
    return runActionPromise(
      rpc.filePreviewTag({ repoPath: place.repoPath, filePath: path }).pipe(
        Effect.map(
          (tag): FileWithUrl => ({
            path,
            url: `${buildTerminalFileUrl(place.host, terminalId, path)}?v=${tag}`,
          }),
        ),
      ),
    );
  }
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

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

import { activeArm } from "@kolu/padi-client/surface";
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
import {
  hostOf,
  keptOf,
  waterfallFileName,
  type Work,
  type WorkId,
} from "kolu-work";
import { type Accessor, createMemo, createResource } from "solid-js";
import { type CodeLister, repoLister } from "../code-view/codeLister";
import { noTerminalToFetch } from "../code-view/codeSubject";
import { runActionPromise } from "../runAction";
import { padiMap } from "../wire";
import type { MemberLine } from "./workFacts";

/** WHERE a work's files are read from while it is in progress: the folder git
 *  last named for the work's own key (`Work.worktree`), on the key's host —
 *  and a terminal serving that folder ({@link terminalServing}), whose address
 *  a picture is fetched from, or `null` while none is. */
export interface WorkPlace {
  readonly host: string;
  readonly repoPath: string;
  readonly terminalId: TerminalId | null;
  /** Who lists the folder's root — a serving terminal's own git reading says
   *  whether it is a folder git cannot list; with none, git, which says so
   *  loudly in the tree's banner if it cannot. */
  readonly lister: CodeLister;
}

/** The one line for an open work whose folder git has not been asked about
 *  yet — what the Worktree part and the Code view both say. */
export const WORKTREE_UNREAD =
  "kolu has not read where this work is working yet.";

/** ... and the one line for a work whose branch git says is checked out
 *  nowhere on its host. */
export const WORKTREE_ABSENT =
  "This work's branch is not checked out anywhere on its host.";

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

/** A TERMINAL SERVING A FOLDER: its id, the address a picture in the folder is
 *  fetched through, and who lists the folder's root. */
export interface ServingTerminal {
  readonly terminalId: TerminalId;
  readonly lister: CodeLister;
}

/** A TERMINAL THROUGH WHICH A FOLDER'S BYTES CAN BE FETCHED — the file route's
 *  own precondition, and nothing about the work. A terminal's file route
 *  serves a path under that terminal's CURRENT repo root, so the terminal
 *  must be here, on the folder's host, with its own git reading naming the
 *  same top folder. Which work it is in, and what it carries, is not asked. */
export function terminalServing(
  host: string,
  path: string,
  members: ReadonlyArray<MemberLine>,
): ServingTerminal | null {
  for (const one of members) {
    if (one.split?.host !== host) continue;
    const standing = one.standing;
    if (standing?.kind !== "here") continue;
    const arm = activeArm(standing.meta);
    if (arm?.git.kind === "repo" && arm.git.info.repoRoot === path)
      return { terminalId: one.split.id, lister: repoLister(arm.git.info) };
  }
  return null;
}

/** WHERE A WORK'S LIVE FILES ARE — the ONE reading of a work's folder in the
 *  browser: the folder git last named for the work's own key, on the key's
 *  host, kept on the work's own record so it outlives its terminals; none
 *  for a work whose folder git has not named. The files, the Worktree part
 *  and the Code view all read this.
 *
 *  A work that has ENDED reads the copies kolu kept instead, so this answers
 *  `null` for one. */
export function workPlaceOf(
  work: Work,
  members: ReadonlyArray<MemberLine>,
): WorkPlace | null {
  if (work.state.kind !== "open" || work.worktree.kind !== "at") return null;
  const host = hostOf(work);
  const path = work.worktree.path;
  // The terminal a picture's address hangs on: one serving the folder.
  const serving = terminalServing(host, path, members);
  return {
    host,
    repoPath: path,
    terminalId: serving?.terminalId ?? null,
    lister: serving?.lister ?? "git",
  };
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
  members: ReadonlyArray<MemberLine>,
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
 *  terminal's, so a picture can be shown only while a member terminal stands
 *  in the worktree — and says so, rather than drawing nothing. */
function readWorkFile(
  place: WorkPlace,
  path: string,
): Promise<FileWithSource | FileWithUrl> {
  const rpc = padiMap.entry(decodeHostKey(place.host)).procedures.fs;
  if (isBinaryPreviewable(path)) {
    const terminalId = place.terminalId;
    if (terminalId === null)
      return Promise.reject(new Error(noTerminalToFetch(path)));
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

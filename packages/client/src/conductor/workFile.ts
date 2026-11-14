/** READING A WORK'S FILE — the `.waterfall/` list beside a work in progress,
 *  and the bytes behind whichever one is open.
 *
 *  TWO PLACES, one shape. While a work is in flight its files are in a
 *  member's worktree on that member's host, read through the same padi
 *  procedures the Code tab reads a repo with. When it ends, kolu has copied
 *  them into its own state directory and serves them over
 *  `/api/works/<work>/files/<path>` — the worktree may be gone by then, and a
 *  plan nobody can open is a plan nobody kept.
 *
 *  Both answer `@kolu/solid-fileview`'s two shapes, so the ONE viewer
 *  (`BrowseFileDispatcher`) draws either without knowing which it got. */

import type { FileWithSource, FileWithUrl } from "@kolu/solid-fileview";
import { Effect } from "effect";
import { decodeHostKey } from "kolu-common/hostKey";
import {
  buildTerminalFileUrl,
  encodePreviewPath,
  isBinaryPreviewable,
} from "kolu-common/preview";
import type { TerminalId } from "kolu-common/surface";
import type { Work, WorkRole } from "kolu-work";
import { fleetTerminalStanding } from "../palette/fleetTerminals";
import { runActionPromise } from "../runAction";
import { padiMap } from "../wire";
import { splitMemberRef } from "./memberRef";

/** WHERE a work's files are read from while it is in progress: the member
 *  terminal whose worktree holds them. `repoPath` is that worktree's root as
 *  the member's own git reading gives it. */
export interface WorkPlace {
  readonly host: string;
  readonly terminalId: TerminalId;
  readonly repoPath: string;
}

/** THE ORDER A WATERFALL RUNS ITS MEMBERS IN — the same order the card lists
 *  them, so "the first member with a worktree" means the same thing on both
 *  faces. */
const ROLE_ORDER: Record<WorkRole, number> = {
  planner: 0,
  implementor: 1,
  other: 2,
};

/** WHERE A WORK'S LIVE FILES ARE — the first member whose own git reading
 *  names a worktree, or `null` once the work has ended (and before any member
 *  has reported one), when the files are the ones kolu kept.
 *
 *  ONE derivation, read by both faces of a file: the card's list and the
 *  reader that opens one of its rows. A second spelling of "which worktree is
 *  this work's" is how a card and a reader come to disagree about which copy
 *  of a plan they are showing. */
export function workPlaceOf(work: Work): WorkPlace | null {
  if (work.endedAt !== null) return null;
  const members = [...work.members].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role],
  );
  for (const member of members) {
    const split = splitMemberRef(member.terminal);
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

/** The directory every waterfall writes its plan and its notes into — the one
 *  place kolu looks, stated once here and in `kolu-conductor`'s observation of
 *  the same directory. */
export const WATERFALL_DIR = ".waterfall";

/** Where kolu serves the files it kept when a work ended. The shape is the
 *  route kolu-server registers; the path is encoded per segment, exactly as
 *  the per-terminal file route encodes its own. */
export function workFileUrl(work: string, path: string): string {
  return `/api/works/${encodeURIComponent(work)}/files/${encodePreviewPath(path)}`;
}

/** The files directly in a member's `.waterfall/`, worktree-relative. One
 *  level, no recursion, directories dropped — the same reading kolu's own
 *  watch takes when it records a `file` event.
 *
 *  A worktree with NO `.waterfall/` is the ordinary state of a piece of work
 *  nobody has written a plan in yet, and padi answers that with its declared
 *  `FileGone`. It is not a failure to report: it reads as the empty list, the
 *  same answer `WorkFiles.list` gives kolu's own watch for an absent
 *  directory. Anything else (a host that went away mid-read) stays a failure,
 *  which the card says in a line. */
export function listWorkFiles(
  place: WorkPlace,
): Promise<ReadonlyArray<string>> {
  return runActionPromise(
    padiMap
      .entry(decodeHostKey(place.host))
      .procedures.fs.listDirectory({
        repoPath: place.repoPath,
        dirPath: WATERFALL_DIR,
      })
      .pipe(
        Effect.map(({ paths }) => paths.filter((path) => !path.endsWith("/"))),
        Effect.catchTag(
          "FileGone",
          (): Effect.Effect<ReadonlyArray<string>> => Effect.succeed([]),
        ),
      ),
  );
}

/** The bytes of one file in a member's worktree, as the viewer takes them.
 *  A previewable binary never travels the wire: it is a URL the browser loads
 *  through the host's own file route, with the content hash as its cache key
 *  so an identical rewrite does not reload the image. */
export function readWorkFile(
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
export async function readKeptFile(
  work: string,
  path: string,
): Promise<FileWithSource | FileWithUrl> {
  const url = workFileUrl(work, path);
  if (isBinaryPreviewable(path)) return { path, url };
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${response.status} reading the kept ${path}`);
  return { path, source: { content: await response.text(), truncated: false } };
}

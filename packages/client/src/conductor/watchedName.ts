/** WHAT A WATCHED TERMINAL IS CALLED — one ladder, for the rows and for the
 *  heading above them.
 *
 *  A raw uuid is not a name. The panel used to draw one whenever the `@`
 *  menu's index had nothing for a terminal, and that index holds TILES only
 *  (`isTileTerminal`): a SPLIT — the implementor inside a waterfall's planner,
 *  the exact terminal a person most needs to recognise — fell through to its
 *  bare id every time. So the fleet's name is the FIRST rung here rather than
 *  the only one, and the rungs under it are what a person can actually
 *  recognise, in the order a person would recognise them:
 *
 *  1. THE `@` MENU'S NAME, unchanged: the name they would type into the
 *     composer to mean this terminal. A tile has one, and nothing below may
 *     overrule it, or the panel and the composer would part company.
 *  2. ITS INTENT, line 1 — the words a person wrote on this terminal
 *     themselves. The dock's annotation slot takes exactly this (never the
 *     intent AND the directory stacked), and the rule is `firstIntentLine`'s,
 *     not a second reading of `meta.intent`.
 *  3. THE AGENT'S OWN TITLE — `agent.summary`, which is the one title an
 *     agent publishes about itself: Codex sends its thread's title, Claude
 *     Code the last summary of what it is doing. It is the same string the
 *     status line under the row says it is `doing`, and that repetition is
 *     deliberate rather than overlooked: a row headed "writing the plan" is a
 *     row a person can find again, and a row headed `fcb131f3` is not.
 *  4. ITS AGENT AND WHO IT IS A SPLIT OF — `Claude Code · split of
 *     paths-kept-by`, which is precisely what the human reads a fresh
 *     implementor as. The parent's name comes from THIS function, so a
 *     renamed parent renames the split; the phrase itself never nests (the
 *     parent is named by the rungs that are not this one), so the ladder is
 *     depth-guarded by construction and a parent/child cycle in the records
 *     cannot spin it.
 *  5. WHERE IT IS — the branch inside a repo, else the directory's basename,
 *     which is the DOCK's own rule for a sub-terminal with no display identity
 *     (`dockRowLabel` with no display row). Not a new spelling of it.
 *  6. THE SHORT ID, first 8 characters, and only here: a last resort is a
 *     thing a person can still read out loud, which a 36-character uuid is
 *     not.
 *
 *  A GROUP HEADING climbs the same ladder, with one rung inserted before the
 *  last: the name kolu-server last read for that piece of work. The heading is
 *  drawn for a root this browser may not be able to see at all (a host that is
 *  away keeps its grouping, not its records), and the server's reading is a
 *  better answer there than eight characters of hex — while for a root this
 *  browser CAN see, the live rungs above still win, so the heading and the row
 *  under it say the same words and the group-of-one rule keeps working.
 *
 *  PURE, over two lookups the panel supplies from one pass over the fleet. */

import { activeArm, type TerminalMetadata } from "@kolu/padi-client/surface";
import { dockRowLabel } from "../canvas/dock/dockRowData";
import { firstIntentLine } from "../intent/text";
import { agentName } from "../ui/agentDisplay";
import { splitWatchedRef } from "./watchedRef";
import { watchedParentRef } from "./watchedTree";

/** The two readings the ladder climbs, as the panel hands them over: the `@`
 *  menu's names and the live records, both already indexed by ref so naming a
 *  row — or its parent — is a lookup rather than a scan. */
export interface WatchedNaming {
  /** The name the `@` menu would offer, for a terminal it offers (a tile). */
  readonly fleetName: (ref: string) => string | undefined;
  /** The terminal's live record, for one this browser can see right now. */
  readonly metaOf: (ref: string) => TerminalMetadata | undefined;
}

/** How much of a terminal id a person is asked to read when nothing else
 *  names it. Eight hex characters is what git taught everyone to compare at a
 *  glance, and it is what the Conductor's own tool cards print. */
const SHORT_ID = 8;

/** The last resort, for a row and for a heading: the short id, or the raw
 *  string for a ref this browser cannot even parse (the panel draws that one
 *  too, saying so on its second line). */
export function shortWatchedRef(ref: string): string {
  const split = splitWatchedRef(ref);
  return split === null ? ref : split.id.slice(0, SHORT_ID);
}

/** The ladder's recognisable rungs — `null` when none of them answers, which
 *  is the point where a row takes the short id and a heading takes the
 *  server's last reading first. */
export function recognisableWatchedName(
  ref: string,
  naming: WatchedNaming,
): string | null {
  return climb(ref, naming, false);
}

/** What a ROW is called: the whole ladder, short id at the bottom. */
export function watchedName(ref: string, naming: WatchedNaming): string {
  return recognisableWatchedName(ref, naming) ?? shortWatchedRef(ref);
}

/** What a GROUP is headed by: the same ladder, with the name kolu-server last
 *  read for the piece of work ahead of the short id. */
export function watchedGroupName(
  piece: { readonly root: string; readonly name: string },
  naming: WatchedNaming,
): string {
  const live = recognisableWatchedName(piece.root, naming);
  if (live !== null) return live;
  return piece.name === "" ? shortWatchedRef(piece.root) : piece.name;
}

/** `asParent` is the depth guard: a parent is named by every rung EXCEPT the
 *  split-of phrase, so `A · split of B · split of C` cannot be built and a
 *  cycle in the `parentId` edges cannot recurse. */
function climb(
  ref: string,
  naming: WatchedNaming,
  asParent: boolean,
): string | null {
  const fleet = naming.fleetName(ref);
  if (fleet !== undefined) return fleet;
  const meta = naming.metaOf(ref);
  // No record — a host that is away, a terminal that is gone. The server's
  // grouping outlives the record; a name read off it would not.
  if (meta === undefined) return null;

  const intent =
    meta.intent === undefined ? "" : firstIntentLine(meta.intent).trim();
  if (intent !== "") return intent;

  const agent = activeArm(meta)?.agent ?? null;
  const title = agent?.summary?.trim() ?? "";
  if (title !== "") return title;

  if (agent !== null && !asParent) {
    const above = watchedParentRef(ref, meta);
    const parent = above === null ? null : climb(above, naming, true);
    if (parent !== null) return `${agentName(agent.kind)} · split of ${parent}`;
  }

  // The dock's words for a terminal with no display identity of its own: the
  // branch where there is a repo (what the dock's TILE rows carry), else
  // `dockRowLabel`'s own fallback, the working directory's basename. Its
  // intent half is already spent two rungs above, and it stays the call rather
  // than a copy of the call so a change to the dock's rule arrives here.
  const place =
    meta.git.kind === "repo"
      ? meta.git.info.branch.trim()
      : dockRowLabel(meta, undefined).trim();
  return place === "" ? null : place;
}

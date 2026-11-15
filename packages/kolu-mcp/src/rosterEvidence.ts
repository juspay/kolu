/**
 * DOES THIS HOST HOLD THAT TERMINAL? — the one gate every "that terminal is not
 * there" on this face goes through.
 *
 * padi serves a surface from the moment it starts, BEFORE it has adopted the
 * terminals it supervises (a redeploy, a kaval recycle). An id missing while
 * that is true is not an absence: it is "no answer yet". Concluding otherwise
 * is the defect this round removes — a freshly started padi made kolu say two
 * live terminals were gone (juspay/kolu#2376).
 *
 * THE CENSUS AND THE STANDING ARE ONE FRAME (`padiSurface`'s `roster` member,
 * 7.4), and this face reads membership off it rather than off the `terminals`
 * collection beside it. The second half of that same incident is why: this
 * face can be served by kolu-server's per-host MIRROR of a padi, which marks
 * its session connected on its first folded CELL frame — so a reader that took
 * the standing from the cell and the list from the collection could be told
 * `established` by one and an empty list by the other, and call a live
 * terminal gone. One member cannot be delivered apart from itself.
 *
 * The fact rides the wire as data, so the browser, kolu-server's watcher and
 * this face cannot answer it differently.
 */

import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { type PadiRoster, rosterHolds } from "@kolu/padi-client/surface";
import { Effect } from "effect";

/** The sentence a caller is given instead of an absence, when the host has not
 *  finished adopting: it says what is true and what to do. */
export const stillSettling = (what: string): string =>
  `the host behind ${what} has not finished adopting its terminals, so its list cannot say whether that terminal exists — ask again in a moment.`;

/** What a host says about one of its terminals: it HOLDS it, it does not, or
 *  it has not finished adopting and so has no census to answer from. Three
 *  answers, because "absent" and "no answer yet" are different facts and
 *  collapsing them is the whole of #2376. */
export type RosterStanding = "held" | "absent" | "settling";

/** Whether this host holds that terminal. One frame off the roster cell — the
 *  standing and the census together; a host that cannot answer at all fails
 *  loudly rather than being read as settled. */
export const rosterStandingOf = (
  padi: PadiSurfaceClient,
  id: string,
  what: string,
): Effect.Effect<RosterStanding, unknown> =>
  Effect.map(
    firstFrameOrThrow(
      padi.surface.roster.get(undefined),
      `the host behind ${what} answered no roster standing — link or protocol failure.`,
    ),
    (standing) => {
      const held = rosterHolds(standing as PadiRoster, id);
      return held === null ? "settling" : held ? "held" : "absent";
    },
  );

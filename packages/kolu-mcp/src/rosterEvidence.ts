/**
 * IS THIS HOST'S ROSTER EVIDENCE? — the one gate every "that terminal is not
 * there" on this face goes through.
 *
 * padi serves a roster from the moment it starts, BEFORE it has adopted the
 * terminals it supervises (a redeploy, a kaval recycle). An id missing from
 * such a list is not an absence: it is "no answer yet". Concluding otherwise
 * is the defect this round removes — a freshly started padi made kolu say two
 * live terminals were gone (juspay/kolu#2376).
 *
 * The fact rides the wire as data (`padiSurface`'s `roster` member, folded by
 * `rosterIsEstablished`), so the browser, kolu-server's watcher and this face
 * cannot answer it differently.
 */

import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import {
  type PadiRoster,
  rosterIsEstablished,
} from "@kolu/padi-client/surface";
import { Effect } from "effect";

/** The sentence a caller is given instead of an absence, when the host has not
 *  finished adopting: it says what is true and what to do. */
export const stillSettling = (what: string): string =>
  `the host behind ${what} has not finished adopting its terminals, so its list cannot say whether that terminal exists — ask again in a moment.`;

/** Whether this host's roster may be read as a census. One frame; a host that
 *  cannot answer at all fails loudly rather than being read as settled. */
export const rosterIsEvidence = (
  padi: PadiSurfaceClient,
  what: string,
): Effect.Effect<boolean, unknown> =>
  Effect.map(
    firstFrameOrThrow(
      padi.surface.roster.get(undefined),
      `the host behind ${what} answered no roster standing — link or protocol failure.`,
    ),
    (standing) => rosterIsEstablished(standing as PadiRoster),
  );

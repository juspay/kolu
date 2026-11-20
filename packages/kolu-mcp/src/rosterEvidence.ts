import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { rosterHolds } from "@kolu/padi-client/surface";
import { Effect } from "effect";

export const stillSettling = (what: string): string =>
  `the host behind ${what} has not finished adopting its terminals, so its list cannot say whether that terminal exists — ask again in a moment.`;

export type RosterStanding = "held" | "absent" | "settling";

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
      const held = rosterHolds(standing, id);
      return held === null ? "settling" : held ? "held" : "absent";
    },
  );

/**
 * WHAT THE FLEET FACE SERVES, as addresses — resolved from the same spec and
 * the same expose map `./serve.ts` serves, through `@kolu/surface-mcp`'s own
 * composition and reader, so "which addresses are there" is answered once and
 * cannot drift from what the face registers.
 *
 * Published because the Conductor's teaching script
 * (`packages/conductor/src/teaching.md`) states these addresses in its own
 * words, and kolu-server's `teaching.test.ts` pins the script against these
 * values: a renamed resource turns that test red instead of teaching a dead
 * address.
 */

import { resolveBundle, servesAddress } from "@kolu/surface-mcp";
import { KOLU_FLEET_EXPOSE } from "../expose.ts";
import { fleetSurface } from "./fleetSurface.ts";

/** The fleet face's composition: one core and no siblings, exactly as
 *  `./serve.ts` serves it. Resolved once, at load — the spec and the map are
 *  constants. */
const FLEET = resolveBundle({
  core: { surface: fleetSurface, expose: KOLU_FLEET_EXPOSE },
});

const terminals = FLEET.resources.find(
  (entry) => entry.kind === "collection" && entry.key === "terminals",
);
if (terminals === undefined) {
  throw new Error(
    "kolu-mcp fleet: the face exposes no `terminals` collection, so there is no address a terminal's record is read at.",
  );
}

/** THE ADDRESS SHAPE a terminal's record is read at: the `terminals`
 *  collection's address, then the reference exactly as the face hands it out. */
export const KOLU_FLEET_RECORD_ADDRESS = `${terminals.uri}/<host>/<id>`;

/** EVERY STATIC RESOURCE THIS FACE SERVES, by address — the cells and the
 *  terminal collection's key set. */
export const KOLU_FLEET_RESOURCES: ReadonlyArray<string> = FLEET.resources
  .map((entry) => entry.uri)
  .sort();

/** Whether the fleet face serves this address — a static resource or one
 *  terminal's record — by the reader a read and a subscription go through. */
export const isKoluFleetAddress = (uri: string): boolean =>
  servesAddress(uri, FLEET);

import { resolveBundle, servesAddress } from "@kolu/surface-mcp";
import { KOLU_FLEET_EXPOSE } from "../expose.ts";
import { fleetSurface } from "./fleetSurface.ts";

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

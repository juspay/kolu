/**
 * The branded per-host key — the padi host a browser tab can select in the keyed map.
 *
 * Lives in its OWN padi-LESS module (not `surfacesWithPadi.ts`, which imports
 * `@kolu/padi`) so the padi-less `contract.ts` — which needs the key to type the
 * `hosts.add`/`hosts.remove` root RPCs the client's selector strip calls — can import it
 * WITHOUT pulling `@kolu/padi` into the client's contract (the package-boundary seal).
 * `surfacesWithPadi.ts` re-exports it and builds `padiHostMap` from it.
 */

import { COLLECTION_RESERVED_CHANNEL_SUFFIXES } from "@kolu/surface/channel-names";
import { z } from "zod";

/** The branded per-host key. zod's `.brand()` is the SOLE producer (a raw string is a
 *  type error where a `HostKey` is expected, P4 at the typed API); the wire handler
 *  re-validates via the same schema (P5).
 *
 *  It also REJECTS a key equal to a reserved collection channel suffix
 *  (`COLLECTION_RESERVED_CHANNEL_SUFFIXES` — the SAME literals `@kolu/surface`'s
 *  collection server mints its channels from). The map's `entries` membership
 *  collection is keyed by host, so a key of e.g. `"keys"` would make its per-key
 *  channel `entries:keys` ALIAS the collection's reserved keyset channel and
 *  cross-wire the membership + status streams. Refusing it at the sole producer
 *  seals every path (env seed, `hosts.add`, a persisted active key) by construction. */
export const HostKeySchema = z
  .string()
  .refine((v) => !COLLECTION_RESERVED_CHANNEL_SUFFIXES.includes(v), {
    message: `a host key may not be a reserved collection channel name (${COLLECTION_RESERVED_CHANNEL_SUFFIXES.join(", ")}) — it would alias the map's membership channel and cross-wire the status stream`,
  })
  .brand("HostKey");
export type HostKey = z.infer<typeof HostKeySchema>;

/** The canonical local-host key — the pool's implicit, UNREMOVABLE default member.
 *  Value `"local"`. Branded, so it is a valid `HostKey` everywhere the map is keyed.
 *  A DISTINCT concept from padi's daemon-collection key `LOCAL_HOST_ID`
 *  (@kolu/padi/surface): this is the map key a browser tab selects; that is the key
 *  padi reports daemon status under. They share the literal but own different axes. */
export const LOCAL_HOST: HostKey = HostKeySchema.parse("local");

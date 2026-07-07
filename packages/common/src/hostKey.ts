/**
 * The branded per-host key — the padi host a browser tab can select in the keyed map.
 *
 * Lives in its OWN padi-LESS module (not `surfacesWithPadi.ts`, which imports
 * `@kolu/padi`) so the padi-less `contract.ts` — which needs the key to type the
 * `hosts.add`/`hosts.remove` root RPCs the client's selector strip calls — can import it
 * WITHOUT pulling `@kolu/padi` into the client's contract (the package-boundary seal).
 * `surfacesWithPadi.ts` re-exports it and builds `padiHostMap` from it.
 */

import { z } from "zod";

/** The branded per-host key. zod's `.brand()` is the SOLE producer (a raw string is a
 *  type error where a `HostKey` is expected, P4 at the typed API); the wire handler
 *  re-validates via the same schema (P5). */
export const HostKeySchema = z.string().brand("HostKey");
export type HostKey = z.infer<typeof HostKeySchema>;

/** The canonical local-host key — the pool's implicit, UNREMOVABLE default member.
 *  Value `"local"` (matching the client daemon-status `LOCAL_HOST` and padi's
 *  `LOCAL_HOST_ID`). Branded, so it is a valid `HostKey` everywhere the map is keyed. */
export const LOCAL_HOST: HostKey = HostKeySchema.parse("local");

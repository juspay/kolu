/**
 * The padi surface is a keyed `SurfaceMap` since W4 ("the switch"), so a RAW HTTP call to any
 * padi entry-member procedure must fold its input into the map's `{ mapKey, input }` envelope —
 * `@kolu/surface-map`'s own `fold()` (the ONE encoder; see `src/envelope.ts`). The e2e harness
 * bypasses the typed client — which folds automatically — for its resets, so it calls `fold()`
 * by hand rather than re-spelling the envelope's field literals. The wire route is UNCHANGED
 * (`/rpc/surface/padi/<member>/<verb>`, no double prefix); only the body gains `mapKey`, which
 * is why an un-folded body now 400s.
 */

import { fold } from "@kolu/surface-map";
import { encodeHostKey, LOCAL_HOST, parseHostInput } from "kolu-common/hostKey";

/** The wire `mapKey` — the CANONICAL encoded form (`encodeHostKey`) — the e2e drives its padi
 *  resets against: the local default's `"local"` (the single-host CI e2e — `parseKoluPadiHostSeed`
 *  seeds `[LOCAL_HOST]`), or the remote seeded via `KOLU_E2E_PADI_HOST` (the ssh-leg e2e — the
 *  same host `waitForPadiLive` polls). `KOLU_E2E_PADI_HOST` carries the same RAW ssh-target
 *  tokens `KOLU_PADI_HOST` does (order-preserved after the local default in
 *  `parseKoluPadiHostSeed`), so each is parsed the same HUMAN-input way (`parseHostInput`) before
 *  being encoded onto the wire. */
const LOCAL_WIRE_KEY = encodeHostKey(LOCAL_HOST);
export const PADI_HOST_KEY: string =
  process.env.KOLU_E2E_PADI_HOST?.split(",")
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .map((h) => encodeHostKey(parseHostInput(h)))
    .find((enc) => enc !== LOCAL_WIRE_KEY) ?? LOCAL_WIRE_KEY;

/** Fold a padi entry-member input into the map's `{ mapKey, input }` wire envelope via the
 *  envelope's own `fold()` encoder. A VOID-input procedure (e.g. `lifecycle/killAll`) passes
 *  no argument — `fold(mapKey, undefined)` carries an `input: undefined` field, which
 *  `JSON.stringify` (every `padiFold` call site serializes the body) drops entirely, so the
 *  wire body is byte-identical to an explicitly omitted field; the fold's `z.void()` schema
 *  accepts the resulting absent key either way. Pass the RPC body as `{ json: padiFold(x) }`. */
export function padiFold(input?: unknown): Record<string, unknown> {
  return fold(PADI_HOST_KEY, input) as Record<string, unknown>;
}

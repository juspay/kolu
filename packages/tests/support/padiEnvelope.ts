/**
 * The padi surface is a keyed `SurfaceMap` since W4 ("the switch"), so a RAW HTTP call to any
 * padi entry-member procedure must fold its input into the map's `{ mapKey, input }` envelope
 * (`@kolu/surface-map`'s `MAP_KEY_FIELD` / `INPUT_FIELD`). The e2e harness bypasses the typed
 * client — which folds automatically — for its resets, so it folds here by hand. The wire route
 * is UNCHANGED (`/rpc/surface/padi/<member>/<verb>`, no double prefix); only the body gains
 * `mapKey`, which is why an un-folded body now 400s.
 */

import { LOCAL_HOST } from "kolu-common/hostKey";

/** The pool host key the e2e drives its padi resets against: `LOCAL_HOST` by default (the
 *  single-host CI e2e — `parseKoluPadiHostSeed` seeds `[LOCAL_HOST]`), or the remote seeded via
 *  `KOLU_E2E_PADI_HOST` (the ssh-leg e2e — the same host `waitForRemotePadiLive` polls). A
 *  remote's key IS the raw `KOLU_PADI_HOST` entry (order-preserved after the local default in
 *  `parseKoluPadiHostSeed`), so we reuse the first non-local entry verbatim. */
export const PADI_HOST_KEY: string =
  process.env.KOLU_E2E_PADI_HOST?.split(",")
    .map((h) => h.trim())
    .find((h) => h.length > 0 && h !== LOCAL_HOST) ?? LOCAL_HOST;

/** Fold a padi entry-member input into the map's `{ mapKey, input }` wire envelope. A
 *  VOID-input procedure (e.g. `lifecycle/killAll`) passes no argument and omits `input` — the
 *  fold's `z.void()` accepts an absent field. Pass the RPC body as `{ json: padiFold(x) }`. */
export function padiFold(input?: unknown): Record<string, unknown> {
  return input === undefined
    ? { mapKey: PADI_HOST_KEY }
    : { mapKey: PADI_HOST_KEY, input };
}

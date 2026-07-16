/**
 * `padiMemoryReadable` — the memory-rail liveness POLICY (LIVE-FIX).
 *
 * A side-effect-free leaf (the niche the retired `pollCadence.ts` held) so the gate is
 * PINNABLE apart from `index.ts`'s boot-only `readPadiMemoryOnce` closure.
 *
 * APP POLICY, named as such: the padi `{ padi, kaval }` memory rail holds a LIVE reading
 * only while the bound padi is `connected`. `readPadiMemoryOnce` gates its deferred mirror
 * read on this, reading the session's HONEST `SessionState` frame via
 * `padiSession.currentState()` — NEVER `currentClient()`. `currentClient() !== null` means
 * "dialing-or-connected": it is non-null while merely `connecting` AND (because
 * `scheduleReconnect` retains the rejected dial) through entire reconnect backoff windows,
 * so the retired gate republished the mirror's held stale reading the whole time. Reading
 * the phase folds every up-but-not-connected phase (`connecting`, and a remote arm's
 * `probing`/`copying`/`building`) and every down phase (`disconnected`/`failed`) to the
 * honest `absent` — the gate, not the held store, deciding down-ness. Naming it keeps the
 * tightening a stated app decision, not a pointer standing in for liveness.
 */

import type { SessionState } from "@kolu/surface-remote";

/** True only while the bound padi is `connected` — see the module doc. Accepts any
 *  session-state phase family (`SessionState<string>`) so it reads a local
 *  (`SessionState<never>`) or a provisioning ssh (`SessionState<SshProv>`) frame alike. */
export const padiMemoryReadable = (state: SessionState<string>): boolean =>
  state.phase === "connected";

/**
 * `padiMemoryReadable` — the memory-rail liveness POLICY (LIVE-FIX).
 *
 * A side-effect-free leaf (the niche the retired `pollCadence.ts` held) so the gate is
 * PINNABLE apart from `index.ts`'s boot-only `readPadiMemoryOnce` closure.
 *
 * APP POLICY, named as such: the padi `{ padi, kaval }` memory rail holds a LIVE reading
 * only while the bound padi is BOTH not-destroyed AND `connected`. `readPadiMemoryOnce`
 * gates its deferred mirror read on this, reading the session directly — its `isDestroyed()`
 * flag and its HONEST `SessionState` frame via `currentState()` — NEVER `currentClient()`.
 * `currentClient() !== null` means "dialing-or-connected": it is non-null while merely
 * `connecting` AND (because `scheduleReconnect` retains the rejected dial) through entire
 * reconnect backoff windows, so the retired gate republished the mirror's held stale reading
 * the whole time. Reading the phase folds every up-but-not-connected phase (`connecting`,
 * and a remote arm's `probing`/`copying`/`building`) and every down phase
 * (`disconnected`/`failed`) to the honest `absent` — the gate, not the held store, deciding
 * down-ness.
 *
 * The DESTROYED half is the other fact `currentState()` alone cannot carry: `currentState()`
 * is the honest published FRAME and there is no "destroyed" phase — a torn-down session's
 * last frame may still read `connected`. The retired `currentClient()` gate folded torn-down
 * to `absent` (via `destroyed ? null`); this leaf preserves that fold as the FIRST conjunct
 * so a destroyed session with a stale `connected` frame reads NOT readable, and the mirror
 * read at the call site can never run against a destroyed re-serve. Naming BOTH halves keeps
 * the whole gate a stated app decision, not a pointer standing in for liveness — and a
 * caller can no longer forget to AND in `!isDestroyed()`.
 */

import type { SessionState } from "@kolu/surface-remote";

/** True only while the bound padi is not-destroyed AND `connected` — see the module doc.
 *  Accepts the session structurally (`isDestroyed()` + `currentState()`) so the WHOLE
 *  policy — both halves — is the named leaf, and reads a local (`SessionState<never>`) or a
 *  provisioning ssh (`SessionState<SshProv>`) frame alike (the `SessionState<string>` phase
 *  top is assignable by `Prov`-covariance). */
export const padiMemoryReadable = (session: {
  isDestroyed(): boolean;
  currentState(): SessionState<string>;
}): boolean =>
  !session.isDestroyed() && session.currentState().phase === "connected";

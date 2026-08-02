/**
 * The one structured signal that a peer we CAN speak to does not serve the
 * frozen control fragment.
 *
 * Under oRPC this was a `NOT_FOUND` / 404 / `defined: false` triple — the shape
 * a router returned for a route it had never registered. Effect RPC has no
 * status codes; an unimplemented tag is refused by the SERVER before any handler
 * runs, and it arrives at the caller as a DEFECT whose value is the string
 * `"Unknown request tag: <tag>"`. That is what this predicate matches — measured
 * against effect@4.0.0-beta.102 over a real unix socket, not recalled.
 *
 * A defect carrying a bare string, matched by prefix, is a coarse signal. It is
 * the RIGHT coarseness for the question, though: "does this peer serve that
 * route at all?" is a property of the ROUTE SET, and the route set is exactly
 * what the server answers with. Every other failure — a handler that threw, a
 * transport that died, a frame that would not decode — reaches the caller as
 * something else and is deliberately NOT swallowed here.
 *
 * ── What PLAN D6 does to this module ─────────────────────────────────────────
 * Its original caller was tolerance for a live PRE-UW5 kaval, which predates the
 * frozen fragment. Such a peer is now CROSS-EPOCH: its framing is the retired
 * oRPC peer protocol, so a dial never reaches route resolution at all and this
 * predicate can never fire for it. The tolerance branches in `./connect.ts` and
 * `../hostInventory.ts` are therefore dead from this epoch forward and should be
 * deleted with the rest of their pre-fragment path (see the W3 padi-A report's
 * hand-off list). What survives is this predicate's IN-EPOCH meaning: a peer
 * that serves a member set narrower than ours, which is a real and
 * distinguishable condition (kaval's `contractSkew.test.ts` names it as the
 * fourth skew case).
 */

/** The exact prefix Effect RPC's server answers an unimplemented tag with. */
const UNKNOWN_TAG_PREFIX = "Unknown request tag:";

/** True for the "this peer does not serve that route" refusal, and nothing else. */
export function isMissingFrozenFragment(err: unknown): boolean {
  if (typeof err === "string") return err.startsWith(UNKNOWN_TAG_PREFIX);
  // A defect is squashed to an `Error` at the Promise edge, so the string
  // arrives as the message.
  return err instanceof Error && err.message.startsWith(UNKNOWN_TAG_PREFIX);
}

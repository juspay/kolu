/**
 * `koluSurface`'s CONDUCTOR error vocabulary — the two failures a caller can
 * branch on when it talks to the one conversation.
 *
 * Every failure a caller can act on is a `Schema.TaggedError` carried by the
 * `conductor` procedures that raise it, so the discriminant is a `_tag`
 * rather than a code string compared by hand, and the payload rides as typed
 * DATA rather than prose a reader has to re-parse. The rule that decides
 * membership is the one `@kolu/padi-client`'s own error module states: declare
 * what a caller can ACT on, and leave everything else — a wedged endpoint, a
 * state-root nobody can read — to the fail-fast defect channel, where it
 * crosses the wire opaquely and crashes loudly.
 *
 * THEY LIVE HERE RATHER THAN IN `@kolu/padi-client` because kolu-server hosts
 * the conversation: the hosting moved off padi, and an error class left behind
 * would make padi's published contract carry a failure padi can no longer
 * raise. Their own module beside the vocabulary, not folded into `surface.ts`,
 * for the reason padi's errors module gives: `surface.ts` DECLARES them on the
 * procedures, the client NARROWS on them, and the server RAISES them — one
 * module all three reach, importing nothing else of kolu, so it can never join
 * an import cycle with `surface.ts`.
 *
 * BROWSER-SAFE: Effect only, no `node:` imports.
 */

import { Schema } from "effect";

/** There is no conversation to talk to — the ACP adapter is not installed in
 *  this kolu's closure, the fleet MCP endpoint is not answering, or the
 *  subprocess is not up.
 *
 *  Not a degradation anything works around: the adapter is BAKED and the
 *  endpoint is this process's own, so this is either a build that lost the
 *  adapter, a listener that is not serving, or a child that died — and all
 *  three want the panel's hard "not installed" face with the sentence whoever
 *  found out wrote. `why` is that whole sentence, carried verbatim — nothing
 *  composes around it. */
export class ConductorUnavailable extends Schema.TaggedError<ConductorUnavailable>(
  "kolu/ConductorUnavailable",
)("ConductorUnavailable", { why: Schema.String }) {
  override get message(): string {
    return this.why;
  }
}

/** The AGENT said no — to the turn, to the session, to the option change.
 *
 *  A turn the agent refuses is a turn that ENDED, not an agent that has gone:
 *  the conversation stays ready and the next message goes to the same agent.
 *  So this is its own tag rather than an arm of {@link ConductorUnavailable},
 *  and the panel draws the agent's own words with a retry that asks for the
 *  same thing that was refused. `auth` marks the one refusal with something
 *  else to do about it — nobody is signed in — which is what turns the row
 *  into the sign-in door instead of a bare *send again*. */
export class ConductorRefused extends Schema.TaggedError<ConductorRefused>(
  "kolu/ConductorRefused",
)("ConductorRefused", {
  why: Schema.String,
  auth: Schema.Boolean,
}) {
  override get message(): string {
    return this.why;
  }
}

/** Both classes as ONE list — the source the predicate below is derived from,
 *  so a third conductor failure cannot be declared on a procedure and then
 *  silently routed as a defect. */
const CONDUCTOR_ERROR_CLASSES = [
  ConductorUnavailable,
  ConductorRefused,
] as const;

/** The conductor's declared vocabulary as one closed union — what a consumer
 *  decodes an unknown conductor failure against. */
export const ConductorErrorSchema = Schema.Union([...CONDUCTOR_ERROR_CLASSES]);
export type ConductorError = typeof ConductorErrorSchema.Type;

/** Is `err` one of the DECLARED failures above?
 *
 *  The predicate kolu-server's serving seam uses to route a THROWN value onto
 *  the Effect FAILURE channel rather than the defect channel — the single place
 *  the "declared vs defect" line is drawn for the nine conductor procedures,
 *  instead of once per member. The twin of `isPadiDeclaredError`, and
 *  `instanceof` for the same reason: the value was constructed by kolu-server's
 *  own in-process code moments earlier, in this module realm. */
export function isConductorDeclaredError(err: unknown): err is ConductorError {
  return CONDUCTOR_ERROR_CLASSES.some((Cls) => err instanceof Cls);
}

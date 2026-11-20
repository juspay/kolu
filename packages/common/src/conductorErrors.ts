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
 *  same thing that was refused. */
export class ConductorRefused extends Schema.TaggedError<ConductorRefused>(
  "kolu/ConductorRefused",
)("ConductorRefused", {
  why: Schema.String,
}) {
  override get message(): string {
    return this.why;
  }
}

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
 *  instead of once per member. */
export function isConductorDeclaredError(err: unknown): err is ConductorError {
  return CONDUCTOR_ERROR_CLASSES.some((Cls) => err instanceof Cls);
}

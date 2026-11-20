import { Schema } from "effect";

export const TerminalIdSchema = Schema.String.check(Schema.isUUID());
export type TerminalId = typeof TerminalIdSchema.Type;

/** Is this string a FULL terminal id, rather than a prefix of one? The
 *  predicate half of {@link TerminalIdSchema}. */
export const isTerminalId = Schema.is(TerminalIdSchema);

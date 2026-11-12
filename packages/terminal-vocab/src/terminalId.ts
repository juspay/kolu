/**
 * Terminal IDENTITY — the id schema and its predicate, as a leaf whose only
 * import is effect.
 *
 * Its own subpath (`@kolu/terminal-vocab/terminalId`) rather than only a
 * member of `./schema.ts`, because a reader that needs nothing but "is this
 * string a terminal id?" must not have to load the whole snapshot vocabulary —
 * the agent registry, the forge adapters and git — to ask it.
 * `@kolu/acp-harness` is that reader: it reads ids out of tool calls an agent
 * wrote, and a reading that carried a string which is not one made a stored
 * Conductor transcript fail to encode on every open. `./schema.ts` re-exports
 * all three, so every other importer keeps its one door.
 *
 * Not a brand: `TerminalId` is `string` at the type level, and the UUID check
 * runs where the schema is applied — decode, encode, or {@link isTerminalId}.
 * TypeScript will accept any string where a `TerminalId` is typed; only the
 * check refuses one.
 */

import { Schema } from "effect";

export const TerminalIdSchema = Schema.String.check(Schema.isUUID());
export type TerminalId = typeof TerminalIdSchema.Type;

/** Is this string a FULL terminal id, rather than a prefix of one? The
 *  predicate half of {@link TerminalIdSchema}, spelled beside it: a caller
 *  asking that question must not have to reach for a decoder that answers a
 *  different one, nor re-derive the shape from the UUID check. */
export const isTerminalId = Schema.is(TerminalIdSchema);

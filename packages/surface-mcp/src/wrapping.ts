/**
 * MCP demands OBJECTS on both edges — the whole rule, in one file.
 *
 * A tool's `inputSchema` must describe an object, and `structuredContent` must
 * BE one. So a scalar, an array, a `null` or a union has to travel under a
 * single property, and whatever wraps it must be undone by whatever reads it.
 * The three moves that rule needs are here together — advertise a wrapped
 * input ({@link wrapSchema}), read the argument back out ({@link unwrapArgs}),
 * wrap a non-object result ({@link wrapValue}) — rather than in the three
 * modules that call them held in agreement by an exported constant. `KEY` is
 * private: nothing outside this file has to know the spelling.
 *
 * The two edges are NOT one predicate, and that is worth stating plainly
 * because the shape of it is user-visible — see {@link wrapValue}.
 */

/** The single property a non-object value travels under. Private on purpose:
 *  the rename hazard is gone when only this file knows the string. */
const KEY = "value";

type JsonSchema = Record<string, unknown>;

/** Advertise a non-object INPUT as an object with one property. Decided from
 *  the DECLARED schema, so `wrapped` is a static bit the dispatcher carries
 *  (`ToolEntry.wrapped`) and {@link unwrapArgs} reads back. */
export function wrapSchema(schema: JsonSchema): JsonSchema {
  return { type: "object", properties: { [KEY]: schema }, required: [KEY] };
}

/** Undo {@link wrapSchema} before handing args to a procedure/tool's schema.
 *  `wrapped` is the bit `inputSchema` reported for that input, not a guess
 *  about the value. The one place this rule lives, called by both dispatch
 *  branches. */
export function unwrapArgs(
  wrapped: boolean,
  args: Record<string, unknown>,
): unknown {
  return wrapped ? args[KEY] : args;
}

/** Wrap a RESULT that JSON renders as a non-object, so `structuredContent` is
 *  always the object MCP types it as.
 *
 *  Decided from the VALUE, not from a schema — the adapter advertises no
 *  `outputSchema` (see `server.ts`'s `tools/list`), so there is no declared
 *  result shape to read the bit off. That is the ONE place the two edges
 *  differ, and it is observable: they agree for every scalar, array and `null`,
 *  but a union input whose runtime value happens to be an object is advertised
 *  WRAPPED (`{ value: { a: 1 } }` on the way in) and answers BARE (`{ a: 1 }`
 *  on the way out). A caller therefore cannot recover, from the result alone,
 *  whether a `{ value: 42 }` it received was the tool's own object or a wrapped
 *  scalar `42`. Documented rather than closed: wrapping every result instead
 *  would change the shape of every success this adapter has ever emitted.
 *
 *  Takes a value that has ALREADY been through JSON (see `tools.ts`'s `ok` and
 *  `fail`), which is what makes the object test sound: `typeof` describes the
 *  value in memory and `toJSON` decides the one on the wire, and those disagree
 *  for the everyday case of a `Date`. Handed a live object this returned
 *  `structuredContent` that serializes as a string — which the MCP client
 *  rejects as a PROTOCOL error, on the success path, where no `isError` framing
 *  can catch it. */
export function wrapValue(json: unknown): Record<string, unknown> {
  return typeof json === "object" && json !== null && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : { [KEY]: json };
}

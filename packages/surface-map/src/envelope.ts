/**
 * The uniform fold envelope — the map's internal wire codec. Every entry-member
 * call carries its branded key in a `mapKey` field and its own input, verbatim,
 * in an `input` field: `{ mapKey, input }`. A no-input member sends
 * `input: undefined`; an entry input that itself has a `mapKey` field cannot
 * collide with the folded key (it rides `input`, nested).
 *
 * The envelope shape is ONE axis of change, so it lives in exactly one place: the
 * zod schema (`foldInput`, define.ts), the client encode (`foldMapKey`, client.ts),
 * and the server decode (`unwrapInput`/`parseMapKey`, server.ts) all reference
 * these constants and codecs rather than re-spelling the field literals.
 */

/** The envelope field carrying the branded map key. */
export const MAP_KEY_FIELD = "mapKey";
/** The envelope field carrying the entry member's own input, verbatim. */
export const INPUT_FIELD = "input";

/** ENCODE — wrap a map key + an entry member's own input into the fold envelope.
 *  Uniform across object, primitive, and undefined inputs. */
export function fold(mapKey: unknown, input: unknown): unknown {
  return { [MAP_KEY_FIELD]: mapKey, [INPUT_FIELD]: input };
}

/** DECODE — read the entry member's own input back out of the envelope (the EXACT
 *  value the consumer passed; `undefined` for a no-input member). */
export function unfoldInput(wire: unknown): unknown {
  return (wire as Record<string, unknown> | undefined)?.[INPUT_FIELD];
}

/** DECODE — read the folded map key field back out of the envelope. Pre-validation:
 *  the caller re-validates it through the key schema (the P5 gate). */
export function unfoldKeyField(wire: unknown): unknown {
  return (wire as Record<string, unknown> | undefined)?.[MAP_KEY_FIELD];
}

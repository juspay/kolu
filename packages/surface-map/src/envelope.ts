/**
 * The uniform fold envelope — the map's internal wire codec. Every entry-member
 * call carries its encoded wire key (the {@link KeyCodec}'s `encode` output, always
 * a plain string) in a `mapKey` field and its own input, verbatim, in an `input`
 * field: `{ mapKey, input }`. A void-input member carries NO `input` field at all
 * (`{ mapKey }`, not `{ mapKey, input: undefined }` — see ENCODE below); an entry
 * input that itself has a `mapKey` field cannot collide with the folded key (it
 * rides `input`, nested).
 *
 * The envelope shape is ONE axis of change, so it lives in exactly one place: the
 * wire schema (`foldInput`, define.ts), the client encode (`keyInjectingDispatch`,
 * client.ts), and the server decode (`unwrapInput`/`decodeMapKey`, server.ts) all
 * reference these constants and codecs rather than re-spelling the field literals.
 */

/** The envelope field carrying the encoded wire key (per {@link KeyCodec}). */
export const MAP_KEY_FIELD = "mapKey";
/** The envelope field carrying the entry member's own input, verbatim. */
export const INPUT_FIELD = "input";

/** ENCODE — wrap a map key + an entry member's own input into the fold envelope.
 *  A void-input member carries NO input field at all — `{ mapKey }`, not
 *  `{ mapKey, input: undefined }`.
 *
 *  The rule survives the schema-library change unchanged, and for the same reason.
 *  Relying on the wire dropping an `undefined` value AND on the validator accepting
 *  the resulting MISSING key for a void schema is fragile: zod tightened
 *  `z.object({ input: z.void() })` in >=4.3.7 to REJECT a missing key, which broke
 *  every void-input fold the moment a consumer's lockfile drifted onto it (the
 *  drishti fleet incident). Effect Schema is stricter still — `Schema.Struct({ input:
 *  Schema.Void })` demands the key outright. Omitting the field makes "void = no input
 *  key" the ONE representation on both encode and validate, independent of any
 *  validator's missing-key policy (the served schema for a void member likewise
 *  declares no `input` field — see `foldInput`). */
export function fold(mapKey: unknown, input: unknown): unknown {
  return input === undefined
    ? { [MAP_KEY_FIELD]: mapKey }
    : { [MAP_KEY_FIELD]: mapKey, [INPUT_FIELD]: input };
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

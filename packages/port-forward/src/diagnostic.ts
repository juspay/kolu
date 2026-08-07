/**
 * Making other people's words safe to show.
 *
 * Everything a mechanism reports about a forward can carry text this library
 * did not write: ssh merges the far end's stderr into its own, and any future
 * mechanism that reads a subprocess is in the same position. Those strings are
 * rendered verbatim — by kolu's Inspector and any future consumer — so a
 * hostile or careless remote could otherwise emit SGR (rewriting what the
 * operator reads) or OSC 8 (a clickable link of its choosing).
 *
 * It lives here rather than inside a mechanism because it is a promise the
 * LIBRARY makes: the map sanitises at the seam where it wraps a mechanism's
 * callbacks, so a new mechanism cannot forget to and a new renderer need not
 * remember.
 */

import { stripVTControlCharacters } from "node:util";

/** Every control character, written with \u escapes rather than as literal
 *  bytes so the source stays readable text: C0 (including the bare ESC and BEL
 *  that OSC 8 rides on), DEL, and C1. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]+/g;

/** What an unknown thrown value SAYS. Every mechanism catches `unknown` and has
 *  to put it in a sentence, and each hand-written copy of this coercion was
 *  another chance for one of them to render a bare "[object Object]" at the one
 *  moment the reader needs the reason. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Plain text: ANSI sequences removed, every remaining control character
 *  collapsed to a space. */
export function plainDiagnostic(text: string): string {
  return stripVTControlCharacters(text).replace(CONTROL_CHARACTERS, " ").trim();
}

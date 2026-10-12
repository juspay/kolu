/**
 * Text a step TYPES into a terminal must be ASCII.
 *
 * Steps that paint an agent's screen (a Claude prompt footer, an omp approval
 * box) do it by typing a `printf` command into the terminal's bash. The bytes
 * pass through readline first, and readline only treats non-ASCII input as
 * text when the locale is UTF-8 or an inputrc says so (`input-meta on`,
 * `convert-meta off`, which NixOS's /etc/inputrc sets). Without either, as in
 * a bare `nixos/nix` container, readline turns each UTF-8 byte into a meta key
 * (M-b is backward-word, M-7 a digit argument), and the typed command comes
 * out scrambled: measured on odu's Cloudflare lane, the painted footer
 * " Enter to select · ↑/↓ to navigate · Esc to cancel" reached the screen as
 * " Enter to        select / to        Esc to cancel navigate", and the omp
 * payload never ran at all.
 *
 * So the command carries non-ASCII bytes as octal escapes, which `printf %b`
 * (or a `%b` format) expands back: the screen still shows the real glyphs,
 * and what readline sees is plain ASCII on any host.
 */

/** Escape `text` for a `printf %b` argument: backslashes doubled, every
 *  non-ASCII byte (of its UTF-8 encoding) as `\0NNN`. */
export function printfEscapedAscii(text: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(text)) {
    if (byte === 0x5c) out += "\\\\";
    else if (byte < 0x80) out += String.fromCharCode(byte);
    else out += `\\0${byte.toString(8).padStart(3, "0")}`;
  }
  return out;
}

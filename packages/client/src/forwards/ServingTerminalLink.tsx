/** The way back to the terminal serving a forwarded port — carried by the
 *  terminal's NAME.
 *
 *  This is the third cut, and the first two failed the same way. A bare `↗` at
 *  ten pixels beside three other glyphs was indistinguishable from decoration.
 *  Then the port number itself carried the link, under a dotted rule at 40%
 *  opacity — which the field verdict was blunt about: *the link is invisible, I
 *  could not find it at all.*
 *
 *  Both spent the affordance on chrome. The fix is to spend it on the ANSWER:
 *  every one of these rows raises "what IS this?", the scanner already knows
 *  which terminal serves the port, so the row SAYS which terminal — and that
 *  name, being the answer, is also the way to it. A visible thing the user
 *  wanted to read anyway beats an invisible thing they had to guess at.
 *
 *  Accent-coloured and underlined AT REST, deliberately: a hover-only reveal
 *  fails identically to an invisible one, because you have to already suspect
 *  the link to go looking for it.
 */

import type { Component } from "solid-js";

export const ServingTerminalLink: Component<{
  /** What the rest of the UI calls this terminal — `servingTerminalName`. */
  name: string;
  onJump: () => void;
}> = (props) => (
  <button
    type="button"
    class="min-w-0 truncate rounded text-left text-accent underline decoration-accent/60 underline-offset-2 transition-colors hover:decoration-accent hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer motion-reduce:transition-none"
    data-testid="terminal-jump"
    title={`go to ${props.name} — the terminal serving this port`}
    aria-label={`Go to ${props.name}, the terminal serving this port`}
    onClick={() => props.onJump()}
  >
    {props.name}
  </button>
);

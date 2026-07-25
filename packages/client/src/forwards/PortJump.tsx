/** A forwarded port's number, as the way back to the terminal serving it.
 *
 *  Every surface that shows a forward raises "what IS this?", and the answer is
 *  a terminal the scanner already attributed the port to. The NUMBER carries the
 *  jump rather than a separate glyph: it is the row's subject, it is what the
 *  user is looking at, and the first cut spent the affordance on a bare `↗` at
 *  ten pixels beside three other glyphs — which is indistinguishable from
 *  decoration, and was reported as "there is no link".
 *
 *  When nothing is attributed — a ⌘K forward to a port no terminal serves, or one
 *  whose server has died — the number renders plainly. The row still belongs on
 *  screen, because its door is real and cancellable; what it must not do is offer
 *  a click that goes nowhere.
 */

import { type Component, Show } from "solid-js";

export const PortJump: Component<{
  port: number;
  /** Go to the terminal serving this port. Absent when none is attributed. */
  onJump?: () => void;
}> = (props) => (
  <Show
    when={props.onJump}
    fallback={
      <span class="shrink-0 font-mono tabular-nums text-fg">{props.port}</span>
    }
  >
    {(jump) => (
      <button
        type="button"
        class="shrink-0 rounded font-mono tabular-nums text-fg underline decoration-dotted decoration-fg-3/40 underline-offset-2 transition-colors hover:decoration-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer motion-reduce:transition-none"
        data-testid="port-jump"
        data-port={props.port}
        title="go to the terminal serving this port"
        aria-label={`Go to the terminal serving port ${props.port}`}
        onClick={() => jump()()}
      >
        {props.port}
      </button>
    )}
  </Show>
);

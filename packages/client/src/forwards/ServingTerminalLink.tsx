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

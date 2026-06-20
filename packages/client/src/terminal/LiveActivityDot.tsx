/** Live-output dot — a soft green pulse shown while a terminal's PTY output is
 *  actively streaming, and nothing at all when it sits static.
 *
 *  Distinct from the agent `StatePip` (which encodes agent *state* —
 *  working/awaiting): this lights for ANY terminal moving bytes — a compile,
 *  a `tail -f`, a plain non-agent shell — which is exactly the gap a glance at
 *  the dock or title bar couldn't fill before. Green (`--color-ok`) is the one
 *  state colour the agent pips don't claim (alert=violet, busy=rust,
 *  accent=blue), so the two axes never blur into one. Mirrors
 *  `ChecksIndicator`'s dot geometry so it reads as one visual family. */

import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { useTerminalActivity } from "./useTerminalActivity";

const LiveActivityDot: Component<{ id: TerminalId }> = (props) => {
  const activity = useTerminalActivity();
  return (
    <Show when={activity.isLive(props.id)}>
      <span
        data-testid="live-activity-dot"
        class="inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-ok animate-pulse ring-2 ring-ok/25"
        title="Live — output updating"
      />
    </Show>
  );
};

export default LiveActivityDot;

import { type Component, Show } from "solid-js";
import { FORWARD_RING } from "../forwards/forwardTone";

export function forwardRingLabel(count: number): string {
  return `${count} forwarded port${count === 1 ? "" : "s"} — click to manage`;
}

export const HostStatusDot: Component<{
  statusDot: string;
  forwardCount: number;
}> = (props) => (
  <span class="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
    <span
      class={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${props.statusDot}`}
      data-testid="host-status-pip"
      aria-hidden="true"
    />
    <Show when={props.forwardCount > 0}>
      <span
        class={`pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${FORWARD_RING}`}
        aria-hidden="true"
        data-testid="host-forward-ring"
        data-count={props.forwardCount}
      />
    </Show>
  </span>
);

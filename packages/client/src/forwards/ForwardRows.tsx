import type { KoluForward } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { ForwardControls, ForwardPill } from "./ForwardPill";
import { ServingTerminalLink } from "./ServingTerminalLink";

export const ForwardRow: Component<{
  forward: KoluForward;
  serving?: { name: string; jump: () => void };
}> = (props) => (
  <div
    class="group/fwd flex items-center gap-1.5 rounded px-1 py-0.5 -mx-1 text-[11px] leading-snug transition-colors hover:bg-surface-2/60 motion-reduce:transition-none"
    data-testid="forward-row"
    data-port={props.forward.remotePort}
    data-origin={props.forward.origin}
  >
    <span class="shrink-0 font-mono tabular-nums text-fg">
      {props.forward.remotePort}
    </span>
    <Show when={props.serving}>
      {(s) => <ServingTerminalLink name={s().name} onJump={s().jump} />}
    </Show>
    <ForwardPill forward={props.forward} link testid="forward-open" />
    <span class="ml-auto flex shrink-0 items-center">
      <ForwardControls forward={props.forward} />
    </span>
  </div>
);

export const ForwardRows: Component<{
  forwards: readonly KoluForward[];
  servingFor?: (
    forward: KoluForward,
  ) => { name: string; jump: () => void } | undefined;
}> = (props) => (
  <Show when={props.forwards.length > 0}>
    <div class="flex flex-col gap-1" data-testid="forward-rows">
      <For each={props.forwards}>
        {(forward) => (
          <ForwardRow forward={forward} serving={props.servingFor?.(forward)} />
        )}
      </For>
    </div>
  </Show>
);

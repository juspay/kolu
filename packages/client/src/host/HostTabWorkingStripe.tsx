import { type Component, Show } from "solid-js";

export function hostActiveLabel(count: number): string {
  return `${count} terminal${count === 1 ? "" : "s"} active`;
}

export const HostTabWorkingStripe: Component<{
  active: number;
}> = (props) => (
  <Show when={props.active > 0}>
    <span
      class="host-tab-stripe pointer-events-none absolute inset-x-2.5 bottom-0 h-0.5 overflow-hidden rounded-full"
      data-testid="host-tab-working-stripe"
      aria-hidden="true"
    >
      <span class="host-tab-stripe-segment absolute inset-y-0 left-0 w-[30%] rounded-full" />
    </span>
  </Show>
);

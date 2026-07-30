import { type Accessor, type Component, Show } from "solid-js";

/** One-based shortcut discovery shared by cards and rail rows. */
export const DockShortcutHint: Component<{
  flatIndex: number;
  modHeld: Accessor<boolean>;
  class: string;
}> = (props) => (
  <Show when={props.modHeld() && props.flatIndex < 9}>
    <span
      data-testid="dock-row-shortcut-hint"
      class={props.class}
      aria-hidden="true"
    >
      {props.flatIndex + 1}
    </span>
  </Show>
);

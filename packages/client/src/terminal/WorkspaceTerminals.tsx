import type { TerminalId } from "kolu-common/surface";
import { type JSX, For, Show, onCleanup, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import { Portal } from "solid-js/web";

interface Destination {
  readonly el: HTMLDivElement;
  readonly seen: () => boolean;
  readonly boxDecided: () => boolean;
}

export function WorkspaceTerminals(props: {
  ids: TerminalId[];
  renderBody: (
    id: TerminalId,
    seen: () => boolean,
    boxDecided: () => boolean,
  ) => JSX.Element;
  children: (
    outlet: (
      id: TerminalId,
      seen: () => boolean,
      boxDecided?: () => boolean,
    ) => JSX.Element,
  ) => JSX.Element;
}): JSX.Element {
  const [destinations, setDestinations] = createStore<
    Record<string, Destination | undefined>
  >({});
  const outlet = (
    id: TerminalId,
    seen: () => boolean,
    boxDecided: () => boolean = () => true,
  ) => (
    <div
      class="flex flex-col h-full w-full min-h-0"
      ref={(el) => {
        setDestinations(id, { el, seen, boxDecided });
        onCleanup(() => {
          if (destinations[id]?.el === el) setDestinations(id, undefined);
        });
      }}
    />
  );
  const seenOf = (id: TerminalId) => () => destinations[id]?.seen() ?? false;
  const boxDecidedOf = (id: TerminalId) => () =>
    destinations[id]?.boxDecided() ?? false;
  return (
    <>
      {untrack(() => props.children(outlet))}
      <For each={props.ids}>
        {(id) => (
          <Show when={destinations[id]?.el}>
            <Portal
              mount={destinations[id]?.el}
              ref={(el) => {
                el.className = "flex flex-col h-full w-full min-h-0";
              }}
            >
              {props.renderBody(id, seenOf(id), boxDecidedOf(id))}
            </Portal>
          </Show>
        )}
      </For>
    </>
  );
}

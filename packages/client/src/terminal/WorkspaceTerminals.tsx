/** One terminal body per workspace tile. Layout shells provide destinations;
 *  changing desktop/touch shells moves the existing body without reattaching.
 *  This owner still ends when the workspace closes or a host's ids leave. */
import type { TerminalId } from "kolu-common/surface";
import { type JSX, For, onCleanup, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import { Portal } from "solid-js/web";

export function WorkspaceTerminals(props: {
  ids: TerminalId[];
  renderBody: (id: TerminalId) => JSX.Element;
  children: (outlet: (id: TerminalId) => JSX.Element) => JSX.Element;
}): JSX.Element {
  const [destinations, setDestinations] = createStore<
    Record<string, HTMLDivElement>
  >({});
  const outlet = (id: TerminalId) => (
    <div
      class="h-full w-full min-h-0"
      ref={(el) => {
        setDestinations(id, el);
        onCleanup(() => {
          if (destinations[id] === el) setDestinations(id, undefined!);
        });
      }}
    />
  );
  return (
    <>
      {untrack(() => props.children(outlet))}
      <For each={props.ids}>
        {(id) => {
          // A detached staging node bridges the shell's synchronous ref turnover.
          const staging = document.createElement("div");
          return (
            <Portal
              mount={destinations[id] ?? staging}
              ref={(el) => {
                el.className = "h-full w-full";
              }}
            >
              {props.renderBody(id)}
            </Portal>
          );
        }}
      </For>
    </>
  );
}

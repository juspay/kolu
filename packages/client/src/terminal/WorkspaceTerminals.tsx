/** One terminal body per workspace tile. Layout shells provide destinations;
 *  changing desktop/touch shells moves the existing body without reattaching.
 *  A body exists only while its id has a mounted pane: an id whose pane has
 *  not appeared yet (the canvas gates tiles behind async per-host facts) gets
 *  no body until it does, and the body ends when the pane goes, the workspace
 *  closes, or a host's ids leave. */
import type { TerminalId } from "kolu-common/surface";
import { type JSX, For, Show, onCleanup, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import { Portal } from "solid-js/web";

export function WorkspaceTerminals(props: {
  ids: TerminalId[];
  renderBody: (id: TerminalId) => JSX.Element;
  children: (outlet: (id: TerminalId) => JSX.Element) => JSX.Element;
}): JSX.Element {
  const [destinations, setDestinations] = createStore<
    Record<string, HTMLDivElement | undefined>
  >({});
  const outlet = (id: TerminalId) => (
    <div
      class="flex flex-col h-full w-full min-h-0"
      ref={(el) => {
        setDestinations(id, el);
        onCleanup(() => {
          if (destinations[id] === el) setDestinations(id, undefined);
        });
      }}
    />
  );
  return (
    <>
      {untrack(() => props.children(outlet))}
      <For each={props.ids}>
        {(id) => (
          // Non-keyed: a shell swap replaces the destination element within one
          // update, so the condition stays truthy and the same body moves.
          <Show when={destinations[id]}>
            <Portal
              mount={destinations[id]}
              ref={(el) => {
                el.className = "flex flex-col h-full w-full min-h-0";
              }}
            >
              {props.renderBody(id)}
            </Portal>
          </Show>
        )}
      </For>
    </>
  );
}

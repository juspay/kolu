/** One terminal body per workspace tile. Layout shells provide destinations;
 *  changing desktop/touch shells moves the existing body without reattaching.
 *  A body exists only while its id has a mounted pane: an id whose pane has
 *  not appeared yet (the canvas gates tiles behind async per-host facts) gets
 *  no body until it does, and the body ends when the pane goes, the workspace
 *  closes, or a host's ids leave.
 *
 *  THE SHELL THAT PLACES A BODY SAYS WHETHER IT CAN BE SEEN. A destination is
 *  registered with the accessor its shell already owns — the touch shells'
 *  "this is the active tile", the canvas's rect-against-the-camera — and the
 *  body reads it back through the registry, so swapping shells re-points the
 *  fact at the new shell's answer without the body re-mounting. There is
 *  exactly ONE place per shell that decides this; nothing here or in `App.tsx`
 *  re-derives it from global facts (which is what `visible={isDesktop() || …}`
 *  was: a second derivation that called every desktop tile visible and
 *  attached the lot — kolu#2362). */
import type { TerminalId } from "kolu-common/surface";
import { type JSX, For, Show, onCleanup, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import { Portal } from "solid-js/web";

/** A mounted destination: where the body goes, and whether its shell can see
 *  it. One record so the two can never disagree about which shell is live. */
interface Destination {
  readonly el: HTMLDivElement;
  readonly seen: () => boolean;
}

export function WorkspaceTerminals(props: {
  ids: TerminalId[];
  renderBody: (id: TerminalId, seen: () => boolean) => JSX.Element;
  children: (
    outlet: (id: TerminalId, seen: () => boolean) => JSX.Element,
  ) => JSX.Element;
}): JSX.Element {
  const [destinations, setDestinations] = createStore<
    Record<string, Destination | undefined>
  >({});
  const outlet = (id: TerminalId, seen: () => boolean) => (
    <div
      class="flex flex-col h-full w-full min-h-0"
      ref={(el) => {
        // Wrapped in a record: a bare function value would be read as a store
        // UPDATER rather than stored.
        setDestinations(id, { el, seen });
        onCleanup(() => {
          if (destinations[id]?.el === el) setDestinations(id, undefined);
        });
      }}
    />
  );
  /** The body's live view of its CURRENT shell's answer. Read through the
   *  store (not captured), so a shell swap re-points it in place. A body with
   *  no destination is a body nobody is placing: not seen. */
  const seenOf = (id: TerminalId) => () => destinations[id]?.seen() ?? false;
  return (
    <>
      {untrack(() => props.children(outlet))}
      <For each={props.ids}>
        {(id) => (
          // Non-keyed: a shell swap replaces the destination element within one
          // update, so the condition stays truthy and the same body moves.
          <Show when={destinations[id]?.el}>
            <Portal
              mount={destinations[id]?.el}
              ref={(el) => {
                el.className = "flex flex-col h-full w-full min-h-0";
              }}
            >
              {props.renderBody(id, seenOf(id))}
            </Portal>
          </Show>
        )}
      </For>
    </>
  );
}

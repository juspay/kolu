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
 *  attached the lot — kolu#2362).
 *
 *  The shell also says whether its VIEW is the one in front (`viewShown`):
 *  the Conductor covers every shell without unmounting it, and a tile under
 *  it stays attached but states no size. Each shell answers from the same
 *  `Shown` accessor it is drawn in (`ui/shown.ts`). */
import type { TerminalId } from "kolu-common/surface";
import { type JSX, For, Show, onCleanup, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import { Portal } from "solid-js/web";

/** A mounted destination: where the body goes, whether its shell can SEE it,
 *  whether the view that shell is drawn in is in front, and whether the box
 *  that shell put it in is one the shell's layout DECIDED. One record so the
 *  facts can never disagree about which shell is live. */
interface Destination {
  readonly el: HTMLDivElement;
  readonly seen: () => boolean;
  readonly viewShown: () => boolean;
  readonly boxDecided: () => boolean;
}

export function WorkspaceTerminals(props: {
  ids: TerminalId[];
  renderBody: (
    id: TerminalId,
    seen: () => boolean,
    viewShown: () => boolean,
    boxDecided: () => boolean,
  ) => JSX.Element;
  children: (
    outlet: (
      id: TerminalId,
      seen: () => boolean,
      viewShown: () => boolean,
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
    viewShown: () => boolean,
    // A shell that places one tile at a time, at the window's size, has no
    // other answer to give (see `App.renderTerminalBody`).
    boxDecided: () => boolean = () => true,
  ) => (
    <div
      class="flex flex-col h-full w-full min-h-0"
      ref={(el) => {
        // Wrapped in a record: a bare function value would be read as a store
        // UPDATER rather than stored.
        setDestinations(id, { el, seen, viewShown, boxDecided });
        onCleanup(() => {
          if (destinations[id]?.el === el) setDestinations(id, undefined);
        });
      }}
    />
  );
  /** The body's live view of its CURRENT shell's answers. Read through the
   *  store (not captured), so a shell swap re-points them in place. A body with
   *  no destination is a body nobody is placing: not seen, not in front, and
   *  in nobody's layout. */
  const seenOf = (id: TerminalId) => () => destinations[id]?.seen() ?? false;
  const viewShownOf = (id: TerminalId) => () =>
    destinations[id]?.viewShown() ?? false;
  const boxDecidedOf = (id: TerminalId) => () =>
    destinations[id]?.boxDecided() ?? false;
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
              {props.renderBody(
                id,
                seenOf(id),
                viewShownOf(id),
                boxDecidedOf(id),
              )}
            </Portal>
          </Show>
        )}
      </For>
    </>
  );
}

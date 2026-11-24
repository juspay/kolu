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
import { createStore, produce } from "solid-js/store";
import { Portal } from "solid-js/web";

/** What the shell that places a body says about it — one record, so two
 *  facts of one type can never be passed in each other's place. */
export interface TilePlacement {
  /** Can a user SEE it — what the pane turns into "attach / stop attaching". */
  readonly seen: () => boolean;
  /** Is the view the shell is drawn in the one in front — false while the
   *  Conductor covers it: the body stays attached, and states no size. */
  readonly viewShown: () => boolean;
  /** Is the box the shell put it in one the shell's layout DECIDED — what the
   *  pane turns into "may I measure". */
  readonly boxDecided: () => boolean;
}

/** A destination: where a body goes, and its shell's answers about it. One
 *  record so the facts can never disagree about which shell is live. */
interface Destination extends TilePlacement {
  readonly el: HTMLDivElement;
}

/** What a shell hands the outlet: a {@link TilePlacement} whose `boxDecided`
 *  may be left out by a shell that places one tile at a time, at the
 *  window's size, and so has no answer but yes. */
export type ShellPlacement = Omit<TilePlacement, "boxDecided"> &
  Partial<Pick<TilePlacement, "boxDecided">>;

export function WorkspaceTerminals(props: {
  ids: TerminalId[];
  renderBody: (id: TerminalId, placement: TilePlacement) => JSX.Element;
  children: (
    outlet: (id: TerminalId, placement: ShellPlacement) => JSX.Element,
  ) => JSX.Element;
}): JSX.Element {
  const [destinations, setDestinations] = createStore<
    Record<string, Destination | undefined>
  >({});
  const outlet = (id: TerminalId, placement: ShellPlacement) => (
    <div
      class="flex flex-col h-full w-full min-h-0"
      ref={(el) => {
        const destination: Destination = {
          el,
          seen: placement.seen,
          viewShown: placement.viewShown,
          boxDecided: placement.boxDecided ?? (() => true),
        };
        setDestinations(
          produce((all) => {
            const held = all[id];
            if (held) Object.assign(held, destination);
            else all[id] = destination;
          }),
        );
        onCleanup(() => {
          if (destinations[id]?.el === el)
            setDestinations(
              produce((all) => {
                delete all[id];
              }),
            );
        });
      }}
    />
  );
  /** The body's live view of its CURRENT shell's answers. Read through the
   *  store (not captured), so a shell swap re-points them in place. A body with
   *  no destination is a body nobody is placing: not seen, not in front, and
   *  in nobody's layout. */
  const placementOf = (id: TerminalId): TilePlacement => ({
    seen: () => destinations[id]?.seen() ?? false,
    viewShown: () => destinations[id]?.viewShown() ?? false,
    boxDecided: () => destinations[id]?.boxDecided() ?? false,
  });
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
              {props.renderBody(id, placementOf(id))}
            </Portal>
          </Show>
        )}
      </For>
    </>
  );
}

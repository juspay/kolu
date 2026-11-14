/** THE HELP, in its two placements — a column beside the conversation, and a
 *  sheet the `⋯` menu opens. One set of words (`helpContent.ts`), two
 *  frames around it.
 *
 *  THE COLUMN IS A TRACK OF CONSTANT WIDTH, and that is the whole design.
 *  The frame on a wide window is help · conversation · work in progress
 *  (`ConductorPane.tsx`), and the help's track is the same width whether the
 *  help is open or shut: open, the panel fills it; collapsed, the rail sits at
 *  its start and the rest of the track is margin. So collapsing really does
 *  give the space back, while the reading column — centred in a track whose
 *  width the collapse cannot touch — does not move a pixel on the press. A
 *  track that shrank with the help would slide the conversation half the
 *  column's width sideways on every press: the reader's line of text moving
 *  because they put the manual away.
 *
 *  The frame is drawn exactly at `conductorHelpColumn()` — a width
 *  `index.css` derives from the three measures rather than a number somebody
 *  liked. Below it, and on a phone, the same words are a sheet (the repo's one
 *  modal shell, so Escape, the focus trap and the dialog-depth count the
 *  pane's own Escape stands down for are all the shared implementation).
 *
 *  COLLAPSED IT IS A RAIL with one control, and the control is the only thing
 *  on it: a rail that offered two things to press would be a second menu.
 *  Whether it is open is a device preference (`helpContent.ts`), so a person
 *  who shut it finds it shut tomorrow. */

import Dialog from "@corvu/dialog";
import { type Component, createEffect, For, Show } from "solid-js";
import DocLink from "../ui/DocLink";
import ModalDialog from "../ui/ModalDialog";
import { surface } from "../ui/Surface";
import { useShown } from "../ui/shown";
import { helpOpen, helpSections, helpSheet, setHelpOpen } from "./helpContent";

/** The words themselves, the same in both placements. `placement` rides as
 *  data only — nothing here branches on it — so a scenario can say WHICH copy
 *  it is reading without the two copies being able to differ. */
const ConductorHelpContent: Component<{ placement: "column" | "sheet" }> = (
  props,
) => (
  <div
    data-testid="conductor-help-content"
    data-placement={props.placement}
    class="flex flex-col gap-3 text-conductor-help"
  >
    <For each={helpSections()}>
      {(section) => (
        <section
          data-testid="conductor-help-section"
          data-section={section.id}
          class="min-w-0"
        >
          <h3 class="m-0 mb-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-fg-3">
            {section.heading}
          </h3>
          <For each={section.lines}>
            {(line) => <p class="m-0 text-fg-2">{line}</p>}
          </For>
        </section>
      )}
    </For>
    <DocLink slug="conductor" data-testid="conductor-help-docs">
      Full docs →
    </DocLink>
  </div>
);

/** The column — the frame's first track. Its own width is its measure (or the
 *  rail's), at the START of a track that is a gutter wider, so the gutter
 *  between it and the conversation is what is left over rather than a second
 *  number. */
export const ConductorHelpColumn: Component = () => (
  <aside
    data-testid="conductor-help"
    data-open={String(helpOpen())}
    aria-label="How to use the Conductor"
    class={`flex min-h-0 flex-col justify-self-start border-e border-edge ${helpOpen() ? "w-conductor-help px-3" : "w-9 items-center"}`}
  >
    <Show
      when={helpOpen()}
      fallback={
        <button
          type="button"
          data-testid="conductor-help-toggle"
          aria-expanded={false}
          aria-label="Show how to use the Conductor"
          class="flex h-full w-full cursor-pointer flex-col items-center gap-2 py-3 text-fg-3 hover:bg-surface-2 hover:text-fg"
          onClick={() => setHelpOpen(true)}
        >
          <span aria-hidden="true" class="font-mono text-xs">
            ?
          </span>
          {/* The name of the thing, down the rail: a bare `?` says there is
              something here, not what. */}
          <span
            aria-hidden="true"
            class="rotate-180 font-mono text-[0.6rem] uppercase tracking-[0.12em] [writing-mode:vertical-rl]"
          >
            how to use
          </span>
        </button>
      }
    >
      <div class="flex items-center justify-between gap-2 py-3">
        <h2 class="m-0 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-fg-3">
          how to use
        </h2>
        <button
          type="button"
          data-testid="conductor-help-toggle"
          aria-expanded={true}
          aria-label="Hide how to use the Conductor"
          class="cursor-pointer px-1 font-mono text-xs text-fg-3 hover:text-fg"
          onClick={() => setHelpOpen(false)}
        >
          ‹
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto pb-6">
        <ConductorHelpContent placement="column" />
      </div>
    </Show>
  </aside>
);

const sheetChrome = surface({ portalled: true });

/** The sheet — mounted once by the pane, opened from the `⋯` menu wherever
 *  the column is not drawn.
 *
 *  It CLOSES when the pane goes behind a host tab, for the reason the header's
 *  two popovers do: it is portalled to the document, so the pane's own
 *  `content-visibility` does not hide it, and a help sheet left over somebody
 *  else's terminals would be taking clicks and Escape for a view they left. */
export const ConductorHelpSheet: Component = () => {
  const shown = useShown();
  createEffect(() => {
    if (!shown()) helpSheet.close();
  });
  return (
    <ModalDialog
      open={helpSheet.open()}
      onOpenChange={helpSheet.onOpenChange}
      size="sm"
    >
      <Dialog.Content
        data-testid="conductor-help-sheet"
        class={`${sheetChrome.class} overflow-hidden`}
        style={sheetChrome.style}
      >
        <Dialog.Label class="block border-b border-edge px-4 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-fg-2">
          how to use the conductor
        </Dialog.Label>
        {/* The phone is the narrow case this exists for, so the body scrolls
            inside the sheet rather than growing past the window. */}
        <div class="max-h-[70vh] overflow-y-auto px-4 py-3">
          <ConductorHelpContent placement="sheet" />
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

/** THE HELP — one sheet, behind the **?** in the Conductor's header at every
 *  desktop width and behind **How to use** in the `⋯` menu at every width,
 *  a phone's included. One set of words (`helpContent.ts`), one frame round
 *  it: the repo's one modal shell, so Escape, the focus trap and the
 *  dialog-depth count the pane's own Escape stands down for are all the shared
 *  implementation.
 *
 *  The words are short enough to read whole on a laptop without scrolling;
 *  on a phone the body scrolls inside the sheet rather than growing past the
 *  window. */

import Dialog from "@corvu-next/dialog"
import {
  type Component,
  createEffect,
  createSignal,
  For,
  Match,
  Switch,
} from "solid-js";
import DocLink from "../ui/DocLink";
import Kbd from "../ui/Kbd";
import ModalDialog from "../ui/ModalDialog";
import { surface } from "../ui/Surface";
import { useShown } from "../ui/shown";
import { type HelpPart, helpSections, helpSheet } from "./helpContent";

/** One piece of a bullet, drawn as what it is: a key as the app's keycap, a
 *  thing to type as code, a word the screen shows in the foreground's own
 *  weight, so the eye finds it here and then finds it there. */
const Part: Component<{ part: HelpPart }> = (props) => (
  <Switch>
    <Match when={props.part.kind === "key"}>
      <Kbd>{props.part.text}</Kbd>
    </Match>
    <Match when={props.part.kind === "code"}>
      <code class="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.7rem] text-fg [overflow-wrap:anywhere]">
        {props.part.text}
      </code>
    </Match>
    <Match when={props.part.kind === "screen"}>
      <span class="font-semibold text-fg">{props.part.text}</span>
    </Match>
    <Match when={props.part.kind === "text"}>{props.part.text}</Match>
  </Switch>
);

const sheetChrome = surface({ portalled: true });

/** The sheet — mounted once by the pane.
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
  // FOCUS LANDS ON THE BODY, not on its first link. The only focusable thing
  // in the help is `Full docs` at the bottom, and a dialog that focused it
  // scrolled the sheet to its end on a phone — opening the help with its first
  // section out of sight. The body takes focus instead, at the top, and is
  // what the arrow keys then scroll.
  const [body, setBody] = createSignal<HTMLDivElement>();
  return (
    <ModalDialog
      open={helpSheet.open()}
      onOpenChange={helpSheet.onOpenChange}
      size="md"
      initialFocusEl={body()}
    >
      <Dialog.Content
        data-testid="conductor-help-sheet"
        class={`${sheetChrome.class} overflow-hidden`}
        style={sheetChrome.style}
      >
        <Dialog.Label class="block border-b border-edge px-4 py-3 text-sm font-semibold text-fg">
          How to use the Conductor
        </Dialog.Label>
        <div
          ref={setBody}
          data-testid="conductor-help-body"
          tabIndex={-1}
          class="max-h-[80vh] overflow-y-auto px-4 py-3 outline-none"
        >
          {/* Spacing GROUPS: sections stand clear of each other, a section's
              bullets sit tight under its heading, and a bullet wraps by
              itself. `data-placement` names the one frame these words are
              in, for a scenario reading them. */}
          <div
            data-testid="conductor-help-content"
            data-placement="sheet"
            class="flex flex-col gap-4 text-conductor-help"
          >
            <For each={helpSections()}>
              {(section) => (
                <section
                  data-testid="conductor-help-section"
                  data-section={section.id}
                  class="min-w-0"
                >
                  <h3 class="m-0 mb-1 text-[0.8rem] font-semibold text-fg">
                    {section.heading}
                  </h3>
                  <ul class="m-0 flex list-disc flex-col gap-1 ps-4 text-fg-2 marker:text-fg-3">
                    <For each={section.items}>
                      {(item) => (
                        <li>
                          <For each={item}>
                            {(part) => <Part part={part} />}
                          </For>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              )}
            </For>
            <DocLink slug="conductor" data-testid="conductor-help-docs">
              Full docs →
            </DocLink>
          </div>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

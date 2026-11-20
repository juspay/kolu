import Dialog from "@corvu/dialog";
import {
  type Component,
  createEffect,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";
import DocLink from "../ui/DocLink";
import ModalDialog from "../ui/ModalDialog";
import { surface } from "../ui/Surface";
import { useShown } from "../ui/shown";
import Kbd from "../ui/Kbd";
import {
  type HelpPart,
  helpOpen,
  helpSections,
  helpSheet,
  setHelpOpen,
} from "./helpContent";

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

const ConductorHelpContent: Component<{ placement: "column" | "sheet" }> = (
  props,
) => (
  <div
    data-testid="conductor-help-content"
    data-placement={props.placement}
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
                  <For each={item}>{(part) => <Part part={part} />}</For>
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
);

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
        <h2 class="m-0 text-sm font-semibold text-fg">How to use</h2>
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

export const ConductorHelpSheet: Component = () => {
  const shown = useShown();
  createEffect(() => {
    if (!shown()) helpSheet.close();
  });
  const [body, setBody] = createSignal<HTMLDivElement>();
  return (
    <ModalDialog
      open={helpSheet.open()}
      onOpenChange={helpSheet.onOpenChange}
      size="sm"
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
          tabIndex={-1}
          class="max-h-[70vh] overflow-y-auto px-4 py-3 outline-none"
        >
          <ConductorHelpContent placement="sheet" />
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

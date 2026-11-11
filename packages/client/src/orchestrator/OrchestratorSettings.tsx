/** The session's settings, in the ADAPTER'S own words.
 *
 *  Every row here is an option the agent advertised — its id, its name, its
 *  choices, its hints. kolu composes none of them: an agent that calls its
 *  reasoning levels `low · medium · high · max` gets those four words, and a
 *  build that grows a fifth gets five without anything here being edited. A
 *  refused change leaves the CONFIRMED value where it was, which is why the
 *  selected row is read off the cell rather than from a local optimistic copy —
 *  there is no moment where the panel claims a setting the agent declined.
 *
 *  Which sections exist and in what order is the one composition, and it is
 *  {@link settingsSections}: the model first, booleans as switches, and no
 *  heading over an empty section. What is left here is the drawing, where the
 *  rule is that the LABEL is the choice — it gets the width it needs and the
 *  agent's description underneath takes the truncation, because a mode called
 *  `Ac…` beside a full sentence is a panel that spent its room on the gloss.
 *
 *  NOTHING ABOUT THE SESSION ITSELF lives here any more. A new session, a
 *  stop, a sign-in and a copy are things kolu does to the conversation, not
 *  options the agent advertised, and two homes for "New session" is two
 *  gestures to keep in step — they are the header's `⋯` menu
 *  ({@link OrchestratorMenu}). */

import type { OrchestratorState } from "kolu-common/orchestrator";
import { type Component, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { surface } from "../ui/Surface";
import Toggle from "../ui/Toggle";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";
import {
  type SettingsSection,
  settingsSections,
  switchValue,
} from "./settingsSections";
import { useOrchestrator } from "./useOrchestrator";

/** The switch arm, narrowed for the `Show` that draws it — Solid's `when`
 *  carries the narrowed value into the child, which a bare boolean test
 *  cannot do. */
const asSwitch = (
  section: SettingsSection,
): Extract<SettingsSection, { control: "switch" }> | null =>
  section.control === "switch" ? section : null;

const OrchestratorSettings: Component<{
  options: OrchestratorState["options"];
  triggerRef: HTMLElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = (props) => {
  const orch = useOrchestrator();
  const chrome = surface({ radius: "lg", shadow: "soft", portalled: true });
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => props.triggerRef,
    open: () => props.open,
    onDismiss: () => props.onOpenChange(false),
    anchor: "bottom-start",
    panelMinWidth: 240,
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={panelRef}
          data-testid="orchestrator-settings"
          class={`fixed z-50 ${chrome.class} p-2 w-[17rem] max-h-[70dvh] overflow-y-auto`}
          style={{ ...panelStyle(), ...chrome.style }}
        >
          <For each={settingsSections(props.options)}>
            {(section) => (
              <section
                class="mb-2"
                data-testid="orchestrator-settings-section"
                data-option={section.option.id}
                data-control={section.control}
                /* The agent's confirmed value, on the section itself: what the
                   panel highlights is answerable from the wire without
                   reading colours off a row. */
                data-value={section.option.value ?? undefined}
              >
                <Show
                  when={asSwitch(section)}
                  fallback={
                    <>
                      <div class="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-fg-3 px-1.5 py-1">
                        {section.option.name}
                      </div>
                      <For each={section.option.choices}>
                        {(choice) => (
                          <button
                            type="button"
                            data-testid="orchestrator-option"
                            data-option={section.option.id}
                            data-value={choice.value}
                            data-active={
                              choice.value === section.option.value
                                ? ""
                                : undefined
                            }
                            role="menuitemradio"
                            aria-checked={choice.value === section.option.value}
                            class="w-full flex flex-col gap-0.5 px-2 py-1 rounded-md text-left hover:bg-surface-2 cursor-pointer"
                            classList={{
                              "text-accent":
                                choice.value === section.option.value,
                              "text-fg": choice.value !== section.option.value,
                            }}
                            onClick={() => {
                              orch.setOption(section.option.id, choice.value);
                              props.onOpenChange(false);
                            }}
                          >
                            <span class="text-xs leading-snug break-words">
                              {choice.label}
                            </span>
                            <Show when={choice.hint}>
                              {(hint) => (
                                <span class="block w-full font-mono text-[0.6rem] text-fg-3 truncate">
                                  {hint()}
                                </span>
                              )}
                            </Show>
                          </button>
                        )}
                      </For>
                    </>
                  }
                >
                  {(row) => (
                    <div class="flex items-center justify-between gap-3 px-1.5 py-1">
                      <span class="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-fg-3">
                        {row().option.name}
                      </span>
                      <Toggle
                        enabled={row().on}
                        label={row().option.name}
                        testId="orchestrator-option-toggle"
                        onChange={(on) => {
                          orch.setOption(row().option.id, switchValue(on));
                          props.onOpenChange(false);
                        }}
                      />
                    </div>
                  )}
                </Show>
              </section>
            )}
          </For>
        </div>
      </Portal>
    </Show>
  );
};

export default OrchestratorSettings;

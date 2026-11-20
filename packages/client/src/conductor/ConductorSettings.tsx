import type { ConductorState } from "kolu-common/conductor";
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
import { useConductor } from "./useConductor";

const asSwitch = (
  section: SettingsSection,
): Extract<SettingsSection, { control: "switch" }> | null =>
  section.control === "switch" ? section : null;

const PANEL_WIDTH = 272;

const ConductorSettings: Component<{
  options: ConductorState["options"];
  triggerRef: HTMLElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = (props) => {
  const orch = useConductor();
  const chrome = surface({ radius: "lg", shadow: "soft", portalled: true });
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => props.triggerRef,
    open: () => props.open,
    onDismiss: () => props.onOpenChange(false),
    anchor: "bottom-start",
    panelMinWidth: PANEL_WIDTH,
  });
  const sections = () => settingsSections(props.options);

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={panelRef}
          data-testid="conductor-settings"
          class={`fixed z-50 ${chrome.class} p-2 w-[17rem] max-w-[calc(100vw-1rem)] max-h-[70dvh] overflow-y-auto`}
          style={{ ...panelStyle(), ...chrome.style }}
        >
          <Show when={sections().length === 0}>
            <p
              data-testid="conductor-settings-empty"
              class="px-1.5 py-1 text-xs text-fg-3"
            >
              This agent has not offered any settings for this conversation.
            </p>
          </Show>
          <For each={sections()}>
            {(section) => (
              <section
                class="mb-2"
                data-testid="conductor-settings-section"
                data-option={section.option.id}
                data-control={section.control}
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
                            data-testid="conductor-option"
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
                        testId="conductor-option-toggle"
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

export default ConductorSettings;

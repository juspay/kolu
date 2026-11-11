/** The session's settings, in the ADAPTER'S own words.
 *
 *  Every row here is an option the agent advertised — its id, its name, its
 *  choices, its hints. kolu composes none of them: an agent that calls its
 *  reasoning levels `low · medium · high · max` gets those four words, and a
 *  build that grows a fifth gets five without anything here being edited. A
 *  refused change leaves the CONFIRMED value where it was, which is why the
 *  selected row is read off the cell rather than from a local optimistic copy —
 *  there is no moment where the panel claims a setting the agent declined. */

import type { OrchestratorState } from "@kolu/padi-client/orchestrator";
import { type Component, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";
import { useOrchestrator } from "./useOrchestrator";

const OrchestratorSettings: Component<{
  options: OrchestratorState["options"];
  triggerRef: HTMLElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignIn: () => void;
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
          <For each={props.options}>
            {(option) => (
              <section class="mb-2">
                <div class="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-fg-3 px-1.5 py-1">
                  {option.name}
                </div>
                <For each={option.choices}>
                  {(choice) => (
                    <button
                      type="button"
                      data-testid="orchestrator-option"
                      data-option={option.id}
                      data-value={choice.value}
                      data-active={
                        choice.value === option.value ? "" : undefined
                      }
                      class="w-full flex items-center justify-between gap-3 px-2 py-1 rounded-md text-left text-xs hover:bg-surface-2 cursor-pointer"
                      classList={{
                        "text-accent": choice.value === option.value,
                        "text-fg": choice.value !== option.value,
                      }}
                      onClick={() => {
                        orch.setOption(option.id, choice.value);
                        props.onOpenChange(false);
                      }}
                    >
                      <span class="truncate">{choice.label}</span>
                      <Show when={choice.hint}>
                        {(hint) => (
                          <span class="font-mono text-[0.6rem] text-fg-3 shrink-0">
                            {hint()}
                          </span>
                        )}
                      </Show>
                    </button>
                  )}
                </For>
              </section>
            )}
          </For>
          <div class="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-fg-3 px-1.5 py-1 border-t border-edge/60">
            Session
          </div>
          <button
            type="button"
            data-testid="orchestrator-settings-signin"
            class="w-full text-left px-2 py-1 rounded-md text-xs text-fg hover:bg-surface-2 cursor-pointer"
            onClick={() => {
              props.onOpenChange(false);
              props.onSignIn();
            }}
          >
            Sign in…
          </button>
          <button
            type="button"
            data-testid="orchestrator-settings-new-session"
            class="w-full text-left px-2 py-1 rounded-md text-xs text-fg hover:bg-surface-2 cursor-pointer"
            onClick={() => {
              props.onOpenChange(false);
              orch.newSession();
            }}
          >
            New session
          </button>
        </div>
      </Portal>
    </Show>
  );
};

export default OrchestratorSettings;

import { activeArm, type TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { TerminalIcon } from "../ui/Icons";
import Section from "../ui/Section";
import AgentStatusCard from "./AgentStatusCard";
import ComposeSection from "./ComposeSection";
import KavalAttachSection from "./KavalAttachSection";
import PortsSection from "./PortsSection";
import { useOduLink } from "./useOduLink";
import WorkSection from "./WorkSection";

const MetadataInspector: Component<{
  meta: TerminalMetadata | null;
  terminalId: TerminalId | null;
  tileId: TerminalId | null;
  themeName?: string;
  onThemeClick?: () => void;
}> = (props) => {
  const store = useTerminalStore();

  const tileAwake = () => {
    const id = props.tileId;
    return id !== null && activeArm(store.getMetadata(id)) !== undefined;
  };

  return (
    <Show
      when={props.meta}
      fallback={
        <div class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2 text-[11px]">
          <TerminalIcon class="w-8 h-8 opacity-40" />
          No terminal selected
        </div>
      }
    >
      {(meta) => {
        const odu = useOduLink();
        return (
          <div
            class="overflow-y-auto overflow-x-hidden h-full"
            data-testid="inspector-cwd"
          >
            <Show when={activeArm(meta()) && props.terminalId} keyed>
              {(id) => (
                <Section title="Compose">
                  <ComposeSection terminalId={id} />
                </Section>
              )}
            </Show>

            <Show when={activeArm(meta())?.agent}>
              {(agent) => <AgentStatusCard agent={agent()} />}
            </Show>

            <WorkSection meta={meta()} odu={odu} />

            <Show when={props.tileId}>
              {(id) => <PortsSection terminalId={id()} />}
            </Show>

            <Show when={tileAwake() && props.tileId} keyed>
              {(id) => (
                <Section
                  title="Attach"
                  collapsible
                  data-testid="inspector-attach-section"
                >
                  <KavalAttachSection terminalId={id} />
                </Section>
              )}
            </Show>

            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 font-mono text-[10px] text-fg-3">
              <Show when={activeArm(meta())?.foreground}>
                {(fg) => (
                  <span
                    data-testid="inspector-foreground"
                    title={fg().title ?? undefined}
                  >
                    fg <span class="text-fg-2">{fg().name}</span>
                  </span>
                )}
              </Show>
              <Show when={props.themeName}>
                {(name) => (
                  <button
                    type="button"
                    data-testid="inspector-theme-button"
                    class="cursor-pointer text-accent hover:underline"
                    onClick={props.onThemeClick}
                  >
                    {name()}
                  </button>
                )}
              </Show>
            </div>
          </div>
        );
      }}
    </Show>
  );
};

export default MetadataInspector;

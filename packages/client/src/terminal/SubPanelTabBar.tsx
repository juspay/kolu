import { sleepingArm, type TerminalMetadata } from "@kolu/padi-client/surface";
import { cwdBasename } from "@kolu/terminal-vocab/terminalKey";
import type { TerminalId } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { useAttentionFacts } from "../attention/useAttentionFacts";
import { ACTIONS } from "../input/actions";
import { IntentMarkdownInline } from "../intent/IntentMarkdown";
import { annotationLine } from "../intent/text";
import { encActiveHost } from "../wire";
import LiveActivityDot from "./LiveActivityDot";

const SubPanelTabBar: Component<{
  subIds: TerminalId[];
  activeSubTab: TerminalId | null;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  onSelect: (id: TerminalId) => void;
  onClose: (id: TerminalId) => void;
  onCreate: () => void;
  onCollapse: () => void;
  canCreate: boolean;
}> = (props) => {
  const facts = useAttentionFacts();
  return (
    <div
      data-testid="sub-panel-tab-bar"
      class="flex items-center gap-1 px-2 py-1 bg-surface-0 border-b border-edge text-sm min-h-[32px] shrink-0"
    >
      <For each={props.subIds}>
        {(id, index) => {
          const meta = () => props.getMetadata(id);
          const label = () => {
            const m = meta();
            const base = m ? cwdBasename(m.cwd) : "terminal";
            const suffixed =
              props.subIds.length <= 1 ? base : `${base} ${index() + 1}`;
            return annotationLine(m?.intent, suffixed);
          };
          const isActive = () => props.activeSubTab === id;
          const dormant = () => sleepingArm(meta()) !== undefined;
          return (
            <div class="group relative">
              <button
                type="button"
                class="flex items-center gap-1 px-3 pr-6 py-1 rounded text-fg-3 hover:text-fg transition-colors cursor-pointer truncate max-w-[120px]"
                classList={{
                  "bg-surface-2 text-fg font-medium": isActive(),
                }}
                data-active={isActive() ? "" : undefined}
                data-dormant={dormant() ? "" : undefined}
                title={dormant() ? "Sleeping — Wake to resume" : undefined}
                onClick={() => props.onSelect(id)}
              >
                <Show when={facts.attentionOf(encActiveHost(), id).live}>
                  <LiveActivityDot />
                </Show>
                <Show when={dormant()}>
                  <span aria-hidden="true" class="opacity-70">
                    ☾
                  </span>
                </Show>
                <span class="truncate">
                  <IntentMarkdownInline markdown={label()} />
                </span>
              </button>
              <button
                type="button"
                data-testid="sub-tab-close"
                class="absolute top-0.5 right-0.5 hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-fg-3 hover:text-fg hover:bg-surface-3 transition-colors cursor-pointer text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose(id);
                }}
                title="Close sub-terminal"
              >
                ×
              </button>
            </div>
          );
        }}
      </For>
      <Show when={props.canCreate}>
        <button
          type="button"
          class="px-2 py-1 text-fg-3 hover:text-fg transition-colors cursor-pointer"
          onClick={props.onCreate}
          title={ACTIONS.createSubTerminal.label}
        >
          +
        </button>
      </Show>
      <div class="flex-1" />
      <button
        type="button"
        class="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-mono text-fg-3 hover:text-fg-2 hover:bg-surface-2 transition-colors cursor-pointer"
        onClick={props.onCollapse}
        title="Hide terminal split"
      >
        <span class="text-[10px]">▾</span> Hide
      </button>
    </div>
  );
};

export default SubPanelTabBar;

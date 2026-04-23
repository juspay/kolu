/** PanelTabBar — generic tabs strip for any `PanelSlot`. Renders one
 *  button per tab (label derived from `PanelContent`), a + button to add
 *  another tab (only meaningful for terminal slots today; opens a chooser
 *  for non-terminal slots in the future), and a hide button to collapse
 *  the slot.
 *
 *  Right-clicking a tab surfaces the "Move to {edge}" affordance; the
 *  parent host owns the menu state and rendering. */

import { type Component, For, Show } from "solid-js";
import { match } from "ts-pattern";
import type { PanelContent, TerminalMetadata } from "kolu-common";
import { cwdBasename } from "../path";

const PanelTabBar: Component<{
  tabs: readonly PanelContent[];
  active: number;
  /** Look up metadata for terminal-kind tabs to label them by cwd. */
  getMetadata: (id: string) => TerminalMetadata | undefined;
  /** Hide button label — varies subtly per edge ("Hide" reads OK for any). */
  hideLabel?: string;
  /** Whether the slot accepts more tabs of the same kind. Today this is
   *  true for terminal-kind slots (clicking + creates another sub-terminal)
   *  and false everywhere else. */
  canAddTab: boolean;
  onSelect: (idx: number) => void;
  onClose: (idx: number) => void;
  onAddTab?: () => void;
  onCollapse: () => void;
  /** Right-click on a tab — caller opens a menu rooted at (clientX, clientY). */
  onContextMenu: (idx: number, e: MouseEvent) => void;
}> = (props) => {
  function tabLabel(content: PanelContent, dupeIndex: number): string {
    return match(content)
      .with({ kind: "inspector" }, () => "Inspector")
      .with({ kind: "code" }, (c) =>
        c.mode === "browse" ? "Files" : `Code · ${c.mode}`,
      )
      .with({ kind: "terminal" }, (c) => {
        const m = props.getMetadata(c.id);
        const base = m ? cwdBasename(m.cwd) : "terminal";
        return dupeIndex > 0 ? `${base} ${dupeIndex + 1}` : base;
      })
      .with({ kind: "browser" }, (c) => {
        try {
          return new URL(c.url).host || "Browser";
        } catch {
          return "Browser";
        }
      })
      .exhaustive();
  }

  return (
    <div
      data-testid="panel-tab-bar"
      class="flex items-center gap-1 px-2 py-1 bg-surface-0 border-b border-edge text-sm min-h-[32px] shrink-0"
    >
      <For each={props.tabs}>
        {(content, index) => {
          // Index among same-kind+key tabs — used to disambiguate two
          // terminal tabs that share a cwd (e.g. two `bash` shells).
          const dupeIndex = () => {
            let count = 0;
            for (let i = 0; i < index(); i++) {
              const t = props.tabs[i]!;
              if (t.kind === content.kind) count++;
            }
            return count;
          };
          const isActive = () => props.active === index();
          return (
            <div class="group relative">
              <button
                data-testid={`panel-tab-${content.kind}`}
                class="px-3 pr-6 py-1 rounded text-fg-3 hover:text-fg transition-colors cursor-pointer truncate max-w-[140px]"
                classList={{
                  "bg-surface-2 text-fg font-medium": isActive(),
                }}
                data-active={isActive() || undefined}
                onClick={() => props.onSelect(index())}
                onContextMenu={(e) => {
                  e.preventDefault();
                  props.onContextMenu(index(), e);
                }}
              >
                {tabLabel(content, dupeIndex())}
              </button>
              <span
                data-testid="panel-tab-close"
                class="absolute top-0.5 right-0.5 hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-fg-3 hover:text-fg hover:bg-surface-3 transition-colors cursor-pointer text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose(index());
                }}
                title="Close tab"
              >
                ×
              </span>
            </div>
          );
        }}
      </For>
      <Show when={props.canAddTab && props.onAddTab}>
        <button
          data-testid="panel-tab-add"
          class="px-2 py-1 text-fg-3 hover:text-fg transition-colors cursor-pointer"
          onClick={props.onAddTab}
          title="Add tab"
        >
          +
        </button>
      </Show>
      <div class="flex-1" />
      <button
        data-testid="panel-hide"
        class="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-mono text-fg-3 hover:text-fg-2 hover:bg-surface-2 transition-colors cursor-pointer"
        onClick={props.onCollapse}
        title="Hide panel"
      >
        <span class="text-[10px]">▾</span> {props.hideLabel ?? "Hide"}
      </button>
    </div>
  );
};

export default PanelTabBar;

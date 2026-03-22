import { type Component, For } from "solid-js";
import type { ChromeColors } from "./theme";

/** Sidebar — create button and terminal list with active highlight. */
const Sidebar: Component<{
  terminalIds: string[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  chrome?: ChromeColors;
}> = (props) => {
  return (
    <aside
      data-testid="sidebar"
      class="flex flex-col w-12"
      style={{
        "background-color": props.chrome?.surface,
        "border-right": `1px solid ${props.chrome?.border}`,
      }}
    >
      <button
        data-testid="create-terminal"
        class="p-2 text-lg transition-colors"
        style={{ color: props.chrome?.textMuted }}
        onClick={props.onCreate}
        title="New terminal"
      >
        +
      </button>
      <nav class="flex-1 overflow-y-auto">
        <For each={props.terminalIds}>
          {(id, i) => (
            <button
              data-terminal-id={id}
              class="w-full p-2 text-xs text-center transition-colors"
              style={{
                "background-color":
                  props.activeId === id
                    ? props.chrome?.activeBg
                    : "transparent",
                color:
                  props.activeId === id
                    ? props.chrome?.text
                    : props.chrome?.textMuted,
              }}
              onClick={() => props.onSelect(id)}
              title={id}
            >
              {i() + 1}
            </button>
          )}
        </For>
      </nav>
    </aside>
  );
};

export default Sidebar;

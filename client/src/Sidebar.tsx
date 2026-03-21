import { type Component, For } from "solid-js";

/** Sidebar — create button and terminal list with active highlight. */
const Sidebar: Component<{
  terminalIds: string[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}> = (props) => {
  return (
    <aside
      data-testid="sidebar"
      class="flex flex-col w-12 bg-slate-800 border-r border-slate-700"
    >
      <button
        data-testid="create-terminal"
        class="p-2 text-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
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
              classList={{
                "bg-slate-600 text-white": props.activeId === id,
                "text-slate-400 hover:text-white hover:bg-slate-700":
                  props.activeId !== id,
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

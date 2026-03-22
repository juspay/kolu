import { type Component, For, Show } from "solid-js";

/** Sidebar — collapsible terminal list. Overlays on mobile, pushes content on desktop. */
const Sidebar: Component<{
  terminalIds: string[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  open: boolean;
  onClose: () => void;
}> = (props) => {
  function handleSelect(id: string) {
    props.onSelect(id);
    // Auto-close on mobile
    if (window.innerWidth < 640) {
      props.onClose();
    }
  }

  return (
    <>
      {/* Backdrop — mobile only, shown when sidebar is open */}
      <Show when={props.open}>
        <div
          class="fixed inset-0 bg-black/50 z-30 sm:hidden"
          onClick={() => props.onClose()}
        />
      </Show>

      {/* Sidebar panel */}
      <aside
        data-testid="sidebar"
        class="flex flex-col w-48 bg-slate-800 border-r border-slate-700 transition-transform duration-200 z-40"
        classList={{
          // Mobile: absolute overlay
          "fixed inset-y-0 left-0 sm:relative sm:inset-auto": true,
          // Hidden when closed
          "-translate-x-full sm:translate-x-0": !props.open,
          "translate-x-0": props.open,
          // When closed on desktop, hide completely
          "sm:-translate-x-full sm:hidden": !props.open,
        }}
      >
        <button
          data-testid="create-terminal"
          class="p-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700 transition-colors text-left"
          onClick={props.onCreate}
          title="New terminal"
        >
          + New terminal
        </button>
        <nav class="flex-1 overflow-y-auto">
          <For each={props.terminalIds}>
            {(id, i) => (
              <button
                data-terminal-id={id}
                class="w-full p-2 text-sm text-left transition-colors"
                classList={{
                  "bg-slate-600 text-white": props.activeId === id,
                  "text-slate-400 hover:text-white hover:bg-slate-700":
                    props.activeId !== id,
                }}
                onClick={() => handleSelect(id)}
                title={id}
              >
                Terminal {i() + 1}
              </button>
            )}
          </For>
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;

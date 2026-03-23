import { type Component, For, Show } from "solid-js";
import { shortenCwd } from "./path";

/** Sidebar — collapsible terminal list. Overlays on mobile, pushes content on desktop. */
const Sidebar: Component<{
  terminalIds: string[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  open: boolean;
  onClose: () => void;
  getCwd: (id: string) => string | undefined;
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
          data-testid="sidebar-backdrop"
          class="absolute inset-0 bg-black/50 z-30 sm:hidden"
          onClick={() => props.onClose()}
        />
      </Show>

      {/* Sidebar panel — absolute within content area on mobile, in-flow on desktop */}
      <aside
        data-testid="sidebar"
        class="flex flex-col w-48 bg-slate-800 border-r border-slate-700 transition-transform duration-200 z-40"
        classList={{
          "absolute inset-y-0 left-0 sm:relative sm:inset-auto": true,
          // Mobile closed: slide off-screen; desktop closed: display:none
          "-translate-x-full sm:hidden": !props.open,
          "translate-x-0": props.open,
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
                title={props.getCwd(id) ?? id}
              >
                <div>Terminal {i() + 1}</div>
                <Show when={props.getCwd(id)}>
                  {(cwd) => (
                    <div class="text-xs text-slate-400 truncate">
                      {shortenCwd(cwd()).split("/").pop() || "~"}
                    </div>
                  )}
                </Show>
              </button>
            )}
          </For>
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;

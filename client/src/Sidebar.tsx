import { type Component, For, Show } from "solid-js";
import { cwdBasename } from "./path";
import Tip from "./Tip";
import type { TerminalId, TerminalInfo } from "kolu-common";

/** Sidebar — collapsible terminal list. Overlays on mobile, pushes content on desktop. */
const Sidebar: Component<{
  terminalIds: TerminalId[];
  activeId: TerminalId | null;
  getMeta: (id: TerminalId) => Omit<TerminalInfo, "id"> | undefined;
  onSelect: (id: TerminalId) => void;
  onKill: (id: TerminalId) => void;
  onCreate: () => void;
  open: boolean;
  onClose: () => void;
}> = (props) => {
  function handleSelect(id: TerminalId) {
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
        class="flex flex-col w-44 bg-surface-1 border-r border-edge transition-transform duration-200 ease-out z-40"
        classList={{
          "absolute inset-y-0 left-0 sm:relative sm:inset-auto": true,
          // Mobile closed: slide off-screen; desktop closed: display:none
          "-translate-x-full sm:hidden": !props.open,
          "translate-x-0": props.open,
        }}
      >
        <Tip label="New terminal" class="w-full">
          <button
            data-testid="create-terminal"
            class="p-2 text-sm text-fg-2 hover:text-fg hover:bg-surface-2 transition-colors text-left border-b border-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50 w-full"
            onClick={props.onCreate}
          >
            + New terminal
          </button>
        </Tip>
        <nav class="flex-1 overflow-y-auto">
          <For each={props.terminalIds}>
            {(id) => {
              const m = () => props.getMeta(id);
              return (
                <button
                  data-terminal-id={id}
                  class="group w-full py-1.5 px-2 text-sm text-left transition-colors duration-150 border-l-2"
                  classList={{
                    "border-accent bg-surface-2/50 text-fg":
                      props.activeId === id,
                    "border-transparent text-fg-2 hover:text-fg hover:bg-surface-2":
                      props.activeId !== id,
                  }}
                  onClick={() => handleSelect(id)}
                  // Prevent button from stealing focus — terminal canvas must keep focus
                  // so keyboard input flows to the PTY, even when clicking the already-active tab.
                  onMouseDown={(e) => e.preventDefault()}
                  title={m()?.cwd?.cwd ?? String(id)}
                >
                  <div class="flex items-center gap-1.5">
                    <span
                      data-testid="activity-indicator"
                      class="inline-block w-2 h-2 rounded-full shrink-0 transition-colors duration-300"
                      classList={{
                        "bg-ok animate-activity-pulse": m()?.isActive ?? false,
                        "bg-fg-3": !(m()?.isActive ?? false),
                      }}
                    />
                    <span class="flex-1">{m()?.name ?? `Terminal ${id}`}</span>
                    <Tip label="Close terminal">
                      <span
                        data-testid="close-terminal"
                        class="opacity-0 group-hover:opacity-100 hover:text-danger text-fg-3 px-0.5 transition-opacity duration-150"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("Close this terminal?")) props.onKill(id);
                        }}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        ×
                      </span>
                    </Tip>
                  </div>
                  <Show when={m()?.cwd}>
                    {(cwdInfo) => (
                      <div class="text-xs text-fg-3 truncate ml-3.5">
                        {cwdBasename(cwdInfo().cwd)}
                        <Show when={cwdInfo().git}>
                          {(git) => (
                            <span data-testid="sidebar-branch">
                              {" "}
                              &middot; {git().branch}
                            </span>
                          )}
                        </Show>
                      </div>
                    )}
                  </Show>
                </button>
              );
            }}
          </For>
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;

import {
  type Component,
  type Accessor,
  createSignal,
  For,
  Show,
} from "solid-js";
import { cwdBasename } from "./path";

/** Sidebar — collapsible terminal list. Overlays on mobile, pushes content on desktop. */
const Sidebar: Component<{
  terminalIds: string[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  open: boolean;
  onClose: () => void;
  getCwd: (id: string) => string | undefined;
  getActive: (id: string) => boolean;
  getDisplayName: (id: string) => string;
  renamingId: Accessor<string | null>;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onCancelRename: () => void;
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
            {(id) => (
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
                <div class="flex items-center gap-1.5">
                  <span
                    data-testid="activity-indicator"
                    class="inline-block w-2 h-2 rounded-full shrink-0"
                    classList={{
                      "bg-green-400": props.getActive(id),
                      "bg-slate-500": !props.getActive(id),
                    }}
                  />
                  <Show
                    when={props.renamingId() === id}
                    fallback={
                      <span
                        class="cursor-text hover:underline hover:decoration-slate-500 hover:decoration-dotted"
                        title="Double-click to rename"
                        onDblClick={(e) => {
                          e.stopPropagation();
                          props.onStartRename(id);
                        }}
                      >
                        {props.getDisplayName(id)}
                      </span>
                    }
                  >
                    <InlineRenameInput
                      initialValue={props.getDisplayName(id)}
                      onCommit={(name) => props.onCommitRename(id, name)}
                      onCancel={() => props.onCancelRename()}
                    />
                  </Show>
                </div>
                <Show when={props.getCwd(id)}>
                  {(cwd) => (
                    <div class="text-xs text-slate-400 truncate ml-3.5">
                      {cwdBasename(cwd())}
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

/** Inline text input for renaming a terminal. Auto-focuses and selects text. */
const InlineRenameInput: Component<{
  initialValue: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}> = (props) => {
  const [value, setValue] = createSignal(props.initialValue);
  let committed = false;

  function commit() {
    if (committed) return;
    committed = true;
    const trimmed = value().trim();
    if (trimmed) {
      props.onCommit(trimmed);
    } else {
      props.onCancel();
    }
  }

  return (
    <input
      // ref callback + rAF: reliable focus even when <Show> conditionally mounts this input
      ref={(el) =>
        requestAnimationFrame(() => {
          el.focus();
          el.select();
        })
      }
      type="text"
      class="bg-slate-700 text-white text-sm rounded px-1 py-0 w-full outline-none border border-slate-500 focus:border-blue-400"
      value={value()}
      onInput={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          props.onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => commit()}
    />
  );
};

export default Sidebar;

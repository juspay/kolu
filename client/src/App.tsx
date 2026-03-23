/** App shell: layout + wiring. State lives in useTerminals, behavior in components. */

import {
  type Component,
  createSignal,
  Show,
  For,
  Suspense,
  ErrorBoundary,
} from "solid-js";
import Header from "./Header";
import Sidebar from "./Sidebar";
import Terminal from "./Terminal";
import CommandPalette from "./CommandPalette";
import { getThemeByName } from "./theme";
import { wsStatus } from "./rpc";
import { useTerminals } from "./useTerminals";
import { useSidebar } from "./useSidebar";

const App: Component = () => {
  const {
    terminalIds,
    activeId,
    setActiveId,
    activeThemeName,
    activeTheme,
    activeCwd,
    existingTerminals,
    handleCreate,
    getTerminalThemeName,
    getTerminalCwd,
    getTerminalActive,
    getTerminalDisplayName,
    handleSetName,
    renameRequest,
    clearRenameRequest,
    commands,
  } = useTerminals();

  const { sidebarOpen, toggleSidebar, closeSidebar } = useSidebar();

  // Shared open state: CommandPalette owns it, Header can trigger it
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteInitialQuery, setPaletteInitialQuery] = createSignal("");

  function openPaletteWith(query: string) {
    setPaletteInitialQuery(query);
    setPaletteOpen(true);
  }

  // Reset initial query on close so Cmd/Ctrl+K opens with a clean slate
  function handlePaletteOpenChange(open: boolean) {
    setPaletteOpen(open);
    if (!open) setPaletteInitialQuery("");
  }

  return (
    <div
      class="flex flex-col h-dvh bg-slate-900 text-white"
      style={{
        "padding-top": "env(safe-area-inset-top)",
        "padding-bottom": "env(safe-area-inset-bottom)",
        "padding-left": "env(safe-area-inset-left)",
        "padding-right": "env(safe-area-inset-right)",
      }}
    >
      <CommandPalette
        commands={commands}
        open={paletteOpen()}
        onOpenChange={handlePaletteOpenChange}
        initialQuery={paletteInitialQuery()}
      />
      <Header
        status={wsStatus()}
        onOpenPalette={() => openPaletteWith("")}
        onThemeClick={() => openPaletteWith("Theme: ")}
        themeName={activeThemeName()}
        cwd={activeCwd()}
        onToggleSidebar={toggleSidebar}
      />
      {/* relative: anchor for sidebar's absolute overlay on mobile */}
      <div class="relative flex flex-1 min-h-0">
        <Sidebar
          terminalIds={terminalIds()}
          activeId={activeId()}
          onSelect={setActiveId}
          onCreate={handleCreate}
          open={sidebarOpen()}
          onClose={closeSidebar}
          getCwd={getTerminalCwd}
          getActive={getTerminalActive}
          getDisplayName={getTerminalDisplayName}
          onRename={handleSetName}
          renameRequest={renameRequest}
          onRenameRequestHandled={clearRenameRequest}
        />
        {/* min-w-0: override flex min-width:auto so terminal area shrinks below canvas intrinsic size */}
        <div class="flex-1 min-h-0 min-w-0 p-2">
          <div
            class="h-full rounded border border-slate-700 overflow-hidden p-2"
            style={{ "background-color": activeTheme().background }}
          >
            <ErrorBoundary
              fallback={(err) => (
                <div class="text-red-400 p-4">
                  Failed to connect: {String(err)}
                </div>
              )}
            >
              <Suspense
                fallback={
                  <div class="flex items-center justify-center h-full text-slate-500 text-sm">
                    Connecting...
                  </div>
                }
              >
                {/* Read the resource to trigger Suspense while it loads */}
                {void existingTerminals()}
                <Show when={terminalIds().length === 0}>
                  <div
                    data-testid="empty-state"
                    class="flex items-center justify-center h-full text-slate-500 text-sm"
                  >
                    Click + to create a terminal
                  </div>
                </Show>
                <For each={terminalIds()}>
                  {(id) => (
                    <Terminal
                      terminalId={id}
                      visible={activeId() === id}
                      theme={getThemeByName(getTerminalThemeName(id))}
                    />
                  )}
                </For>
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;

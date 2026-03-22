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
    commands,
  } = useTerminals();

  // Shared open state: CommandPalette owns it, Header can trigger it
  const [paletteOpen, setPaletteOpen] = createSignal(false);

  return (
    <div class="flex flex-col h-dvh bg-slate-900 text-white">
      <CommandPalette
        commands={commands}
        open={paletteOpen()}
        onOpenChange={setPaletteOpen}
      />
      <Header
        status={wsStatus()}
        onOpenPalette={() => setPaletteOpen(true)}
        themeName={activeThemeName()}
        cwd={activeCwd()}
      />
      <div class="flex flex-1 min-h-0">
        <Sidebar
          terminalIds={terminalIds()}
          activeId={activeId()}
          onSelect={setActiveId}
          onCreate={handleCreate}
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

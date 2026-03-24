/** App shell: layout + wiring. State lives in useTerminals, behavior in components. */

import {
  type Component,
  createSignal,
  createEffect,
  on,
  createResource,
  Show,
  For,
  Suspense,
  ErrorBoundary,
} from "solid-js";
import { Title } from "@solidjs/meta";
import Header from "./Header";
import Sidebar from "./Sidebar";
import Terminal from "./Terminal";
import CommandPalette from "./CommandPalette";
import ShortcutsHelp from "./ShortcutsHelp";
import { getThemeByName } from "./theme";
import { client, wsStatus } from "./rpc";
import { renderer } from "./Terminal";
import { useTerminals } from "./useTerminals";
import { useSidebar } from "./useSidebar";
import { useShortcuts } from "./useShortcuts";

const App: Component = () => {
  const {
    terminalIds,
    activeId,
    setActiveId,
    getMeta,
    activeThemeName,
    activeTheme,
    activeCwd,
    existingTerminals,
    handleCreate,
    handleKill,
    commands,
  } = useTerminals();

  const { sidebarOpen, toggleSidebar, closeSidebar } = useSidebar();

  // Fetch hostname from server; used in document title and header
  const [serverInfo] = createResource(() => client.server.info());
  const appTitle = () => {
    const h = serverInfo()?.hostname;
    return h ? `kolu@${h}` : "kolu";
  };

  // Palette state
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteInitialQuery, setPaletteInitialQuery] = createSignal("");

  // Shortcuts help overlay state
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = createSignal(false);

  // Terminal search bar state — close when switching terminals
  const [searchOpen, setSearchOpen] = createSignal(false);
  createEffect(on(activeId, () => setSearchOpen(false), { defer: true }));

  useShortcuts({
    terminalIds,
    activeId,
    setActiveId,
    handleCreate: (cwd?: string) => void handleCreate(cwd),
    activeCwd,
    setPaletteOpen,
    setShortcutsHelpOpen,
    setSearchOpen,
  });

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
      class="flex flex-col h-dvh bg-surface-0 text-fg font-sans"
      style={{
        "padding-top": "env(safe-area-inset-top)",
        "padding-bottom": "env(safe-area-inset-bottom)",
        "padding-left": "env(safe-area-inset-left)",
        "padding-right": "env(safe-area-inset-right)",
      }}
    >
      <Title>{appTitle()}</Title>
      <CommandPalette
        commands={commands}
        open={paletteOpen()}
        onOpenChange={handlePaletteOpenChange}
        initialQuery={paletteInitialQuery()}
      />
      <ShortcutsHelp
        open={shortcutsHelpOpen()}
        onOpenChange={setShortcutsHelpOpen}
      />
      <Header
        status={wsStatus()}
        onOpenPalette={() => openPaletteWith("")}
        onThemeClick={() => openPaletteWith("Theme: ")}
        themeName={activeThemeName()}
        cwd={activeCwd()}
        onToggleSidebar={toggleSidebar}
        onShortcutsHelp={() => setShortcutsHelpOpen(true)}
        onSearch={() => setSearchOpen(true)}
        renderer={renderer()}
        appTitle={appTitle()}
      />
      {/* relative: anchor for sidebar's absolute overlay on mobile */}
      <div class="relative flex flex-1 min-h-0">
        <Sidebar
          terminalIds={terminalIds()}
          activeId={activeId()}
          getMeta={getMeta}
          onSelect={setActiveId}
          onKill={(id) => void handleKill(id)}
          onCreate={() => handleCreate()}
          open={sidebarOpen()}
          onClose={closeSidebar}
        />
        {/* min-w-0: override flex min-width:auto so terminal area shrinks below canvas intrinsic size */}
        <div class="flex-1 min-h-0 min-w-0 p-1">
          <div
            class="h-full rounded border border-edge overflow-hidden p-1"
            style={{ "background-color": activeTheme().background }}
          >
            <ErrorBoundary
              fallback={(err) => (
                <div class="text-danger p-4">
                  Failed to connect: {String(err)}
                </div>
              )}
            >
              <Suspense
                fallback={
                  <div class="flex items-center justify-center h-full text-fg-3 text-sm">
                    Connecting...
                  </div>
                }
              >
                {/* Read the resource to trigger Suspense while it loads */}
                {void existingTerminals()}
                <Show when={terminalIds().length === 0}>
                  <div
                    data-testid="empty-state"
                    class="flex items-center justify-center h-full text-fg-3 text-sm"
                  >
                    Click + to create a terminal
                  </div>
                </Show>
                <For each={terminalIds()}>
                  {(id) => (
                    <Terminal
                      terminalId={id}
                      visible={activeId() === id}
                      theme={getThemeByName(
                        getMeta(id)?.themeName ?? activeThemeName(),
                      )}
                      searchOpen={searchOpen()}
                      onSearchOpenChange={setSearchOpen}
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

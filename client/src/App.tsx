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
import { Toaster } from "solid-sonner";
import Resizable from "@corvu/resizable";
import Header from "./Header";
import Sidebar from "./Sidebar";
import TerminalPane from "./TerminalPane";
import CommandPalette from "./CommandPalette";
import ShortcutsHelp from "./ShortcutsHelp";
import { refocusTerminal } from "./ModalDialog";

import { client, wsStatus } from "./rpc";
import { renderer } from "./Terminal";
import { useTerminals } from "./useTerminals";
import { useSidebar } from "./useSidebar";
import { useShortcuts } from "./useShortcuts";
import { useSubPanel } from "./useSubPanel";

/** Minimum sidebar panel fraction (below this it collapses to closed). */
const SIDEBAR_MIN = 0.05;

const App: Component = () => {
  const {
    terminalIds,
    activeId,
    setActiveId,
    getMeta,
    getActivityHistory,
    activeThemeName,
    activeTheme,
    getTerminalTheme,
    isPreviewingTheme,
    activeMeta,
    existingTerminals,
    handleCreate,
    handleCreateSubTerminal,
    handleKill,
    getSubTerminalIds,
    reorderTerminals,
    commands,
    randomTheme,
    setRandomTheme,
  } = useTerminals();

  const {
    sidebarOpen,
    toggleSidebar,
    closeSidebar,
    sidebarSize,
    setSidebarSize,
    isDesktop,
  } = useSidebar();
  const subPanel = useSubPanel();

  // Fetch hostname from server; used in document title and header
  const [serverInfo] = createResource(() => client.server.info());
  const appTitle = () => {
    const h = serverInfo()?.hostname;
    return h ? `kolu@${h}` : "kolu";
  };

  // Palette state
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteInitialGroup, setPaletteInitialGroup] = createSignal<
    string | undefined
  >();

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
    handleCreateSubTerminal: (parentId, cwd) =>
      void handleCreateSubTerminal(parentId, cwd),
    activeMeta,
    setPaletteOpen,
    setShortcutsHelpOpen,
    setSearchOpen,
    toggleSubPanel: (parentId) => subPanel.togglePanel(parentId),
    getSubTerminalIds,
    cycleSubTab: (parentId, direction) =>
      subPanel.cycleSubTab(parentId, getSubTerminalIds(parentId), direction),
  });

  function openPalette() {
    setPaletteInitialGroup(undefined);
    setPaletteOpen(true);
  }

  function openPaletteGroup(group: string) {
    setPaletteInitialGroup(group);
    setPaletteOpen(true);
  }

  // Reset state on close and return focus to terminal
  function handlePaletteOpenChange(open: boolean) {
    setPaletteOpen(open);
    if (!open) {
      setPaletteInitialGroup(undefined);
      requestAnimationFrame(refocusTerminal);
    }
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
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "var(--color-surface-1)",
            color: "var(--color-fg)",
            border: "1px solid var(--color-edge-bright)",
          },
        }}
      />
      <CommandPalette
        commands={commands}
        open={paletteOpen()}
        onOpenChange={handlePaletteOpenChange}
        initialGroup={paletteInitialGroup()}
        transparentOverlay={isPreviewingTheme()}
      />
      <ShortcutsHelp
        open={shortcutsHelpOpen()}
        onOpenChange={setShortcutsHelpOpen}
      />
      <Header
        status={wsStatus()}
        onOpenPalette={() => openPalette()}
        onThemeClick={() => openPaletteGroup("Theme")}
        themeName={activeThemeName()}
        meta={activeMeta()}
        onToggleSidebar={toggleSidebar}
        onShortcutsHelp={() => setShortcutsHelpOpen(true)}
        onSearch={() => setSearchOpen(true)}
        renderer={renderer()}
        appTitle={appTitle()}
        randomTheme={randomTheme()}
        onRandomThemeChange={setRandomTheme}
      />
      {/* relative: anchor for sidebar's absolute overlay on mobile */}
      <div class="relative flex flex-1 min-h-0">
        <Resizable
          orientation="horizontal"
          sizes={
            sidebarOpen() && isDesktop()
              ? [sidebarSize(), 1 - sidebarSize()]
              : [0, 1]
          }
          onSizesChange={(sizes) => {
            const s = sizes[0];
            // Only persist when panel is meaningfully open (not mid-collapse)
            if (sidebarOpen() && s !== undefined && s >= SIDEBAR_MIN)
              setSidebarSize(s);
          }}
          class="flex flex-1 min-h-0"
        >
          <Resizable.Panel
            as="div"
            class="min-w-0 overflow-hidden"
            minSize={SIDEBAR_MIN}
            collapsible
            collapsedSize={0}
            onCollapse={closeSidebar}
          >
            <Sidebar
              terminalIds={terminalIds()}
              activeId={activeId()}
              getMeta={getMeta}
              getActivityHistory={getActivityHistory}
              getSubTerminalIds={getSubTerminalIds}
              onSelect={setActiveId}
              onCreate={() => handleCreate()}
              onReorder={reorderTerminals}
              open={sidebarOpen()}
              onClose={closeSidebar}
            />
          </Resizable.Panel>

          <Resizable.Handle
            class="w-1 bg-edge hover:bg-accent-bright cursor-col-resize shrink-0 transition-colors hidden sm:block"
            aria-label="Resize sidebar"
          />

          {/* min-w-0: override flex min-width:auto so terminal area shrinks below canvas intrinsic size */}
          <Resizable.Panel as="div" class="min-w-0 min-h-0" minSize={0.3}>
            <div class="h-full p-1">
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
                        <TerminalPane
                          terminalId={id}
                          visible={activeId() === id}
                          theme={getTerminalTheme(id)}
                          searchOpen={searchOpen()}
                          onSearchOpenChange={setSearchOpen}
                          subTerminalIds={getSubTerminalIds(id)}
                          getMeta={getMeta}
                          onCreateSubTerminal={(parentId, cwd) =>
                            void handleCreateSubTerminal(parentId, cwd)
                          }
                          activeMeta={activeMeta()}
                        />
                      )}
                    </For>
                  </Suspense>
                </ErrorBoundary>
              </div>
            </div>
          </Resizable.Panel>
        </Resizable>
      </div>
    </div>
  );
};

export default App;

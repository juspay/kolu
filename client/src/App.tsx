import {
  type Component,
  createSignal,
  createResource,
  createMemo,
  Show,
  For,
  Suspense,
  ErrorBoundary,
} from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import Header, { type WsStatus } from "./Header";
import Sidebar from "./Sidebar";
import Terminal from "./Terminal";
import CommandPalette from "./CommandPalette";
import {
  DEFAULT_THEME_NAME,
  availableThemes,
  getThemeByName,
  getChromeColors,
} from "./theme";
import { client } from "./rpc";
import type { TerminalInfo } from "kolu-common";
import { isMac } from "./platform";

const App: Component = () => {
  const [wsStatus, setWsStatus] = createSignal<WsStatus>("connecting");
  const [terminalIds, setTerminalIds] = createSignal<string[]>([]);
  const [activeId, setActiveId] = createSignal<string | null>(null);
  // Per-terminal theme name (terminal ID → theme name)
  const [terminalThemes, setTerminalThemes] = createSignal<
    Record<string, string>
  >({});

  /** Get the theme name for a terminal, falling back to default. */
  function getTerminalThemeName(id: string): string {
    return terminalThemes()[id] ?? DEFAULT_THEME_NAME;
  }

  /** The active terminal's resolved theme (for container background). */
  const activeTheme = createMemo(() => {
    const id = activeId();
    return getThemeByName(id ? getTerminalThemeName(id) : undefined);
  });

  /** Chrome colors derived from the active terminal's theme. */
  const chrome = createMemo(() => getChromeColors(activeTheme()));

  /** The active terminal's theme name (for header display). */
  const activeThemeName = createMemo(() => {
    const id = activeId();
    return id ? getTerminalThemeName(id) : DEFAULT_THEME_NAME;
  });

  // Restore existing terminals on page load (e.g. after browser refresh).
  // A successful list() call proves the WebSocket is connected.
  const [existingTerminals] = createResource<TerminalInfo[]>(async () => {
    const existing = await client.terminal.list();
    setWsStatus("open");
    if (existing.length > 0) {
      const ids = existing.map((t) => t.id);
      setTerminalIds(ids);
      const running = existing.find((t) => t.status === "running");
      // Prefer a running terminal; fall back to first (which may be exited)
      setActiveId(running?.id ?? ids[0]);
      // Restore per-terminal themes from server
      const themes: Record<string, string> = {};
      for (const t of existing) {
        if (t.themeName) themes[t.id] = t.themeName;
      }
      setTerminalThemes(themes);
    }
    return existing;
  });

  const [paletteOpen, setPaletteOpen] = createSignal(false);

  /** Create a new terminal on the server, add it to the list, and make it active. */
  async function handleCreate() {
    const info = await client.terminal.create();
    setTerminalIds((prev) => [...prev, info.id]);
    setActiveId(info.id);
  }

  /** Set the theme for the active terminal, persisting to server. */
  async function handleSetTheme(themeName: string) {
    const id = activeId();
    if (!id) return;
    setTerminalThemes((prev) => ({ ...prev, [id]: themeName }));
    void client.terminal.setTheme({ id, themeName });
  }

  const commands = createMemo(() => [
    {
      name: "Create new terminal",
      onSelect: () => void handleCreate(),
    },
    ...terminalIds().map((id, i) => ({
      name: `Switch to Terminal ${i + 1}`,
      onSelect: () => setActiveId(id),
    })),
    // Theme switching commands for the active terminal
    ...availableThemes
      .filter((t) => t.name !== activeThemeName())
      .map((t) => ({
        name: `Theme: ${t.name}`,
        onSelect: () => void handleSetTheme(t.name),
      })),
  ]);

  // Cmd/Ctrl+K to toggle command palette
  makeEventListener(
    window,
    "keydown",
    (e: KeyboardEvent) => {
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((prev) => !prev);
      }
    },
    { capture: true },
  );

  return (
    <div
      class="flex flex-col h-dvh"
      style={{
        "background-color": chrome().bg,
        color: chrome().text,
      }}
    >
      <Show when={paletteOpen()}>
        <CommandPalette
          commands={commands()}
          onClose={() => setPaletteOpen(false)}
          chrome={chrome()}
        />
      </Show>
      <Header
        status={wsStatus()}
        onOpenPalette={() => setPaletteOpen(true)}
        themeName={activeThemeName()}
        chrome={chrome()}
      />
      <div class="flex flex-1 min-h-0">
        <Sidebar
          terminalIds={terminalIds()}
          activeId={activeId()}
          onSelect={setActiveId}
          onCreate={handleCreate}
          chrome={chrome()}
        />
        {/* min-w-0: override flex min-width:auto so terminal area shrinks below canvas intrinsic size */}
        <div class="flex-1 min-h-0 min-w-0 p-2">
          <div
            class="h-full rounded overflow-hidden p-2"
            style={{
              "background-color": activeTheme().background,
              border: `1px solid ${chrome().border}`,
            }}
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
                  <div
                    class="flex items-center justify-center h-full text-sm"
                    style={{ color: chrome().textMuted }}
                  >
                    Connecting...
                  </div>
                }
              >
                {/* Read the resource to trigger Suspense while it loads */}
                {void existingTerminals()}
                <Show when={terminalIds().length === 0}>
                  <div
                    data-testid="empty-state"
                    class="flex items-center justify-center h-full text-sm"
                    style={{ color: chrome().textMuted }}
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

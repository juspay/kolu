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
import CommandPalette, { type Command } from "./CommandPalette";
import { THEME } from "./theme";
import { client } from "./rpc";
import type { TerminalInfo } from "kolu-common";
import { isMac } from "./platform";

const App: Component = () => {
  const [wsStatus, setWsStatus] = createSignal<WsStatus>("connecting");
  const [terminalIds, setTerminalIds] = createSignal<string[]>([]);
  const [activeId, setActiveId] = createSignal<string | null>(null);

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

  const commands = createMemo<Command[]>(() => [
    {
      id: "create-terminal",
      name: "Create new terminal",
      onSelect: () => void handleCreate(),
    },
    ...terminalIds().map((id, i) => ({
      id: `switch-terminal-${id}`,
      name: `Switch to Terminal ${i + 1}`,
      onSelect: () => setActiveId(id),
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
    <div class="flex flex-col h-screen bg-slate-900 text-white">
      <Show when={paletteOpen()}>
        <CommandPalette
          commands={commands()}
          onClose={() => setPaletteOpen(false)}
        />
      </Show>
      <Header status={wsStatus()} onOpenPalette={() => setPaletteOpen(true)} />
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
            style={{ "background-color": THEME.background }}
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
                    <Terminal terminalId={id} visible={activeId() === id} />
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

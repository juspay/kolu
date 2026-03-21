import {
  type Component,
  createSignal,
  onMount,
  Show,
  For,
  ErrorBoundary,
} from "solid-js";
import Header, { type WsStatus } from "./Header";
import Sidebar from "./Sidebar";
import Terminal from "./Terminal";
import { THEME } from "./theme";
import { client } from "./rpc";

const App: Component = () => {
  const [wsStatus, setWsStatus] = createSignal<WsStatus>("connecting");
  const [terminalIds, setTerminalIds] = createSignal<string[]>([]);
  const [activeId, setActiveId] = createSignal<string | null>(null);
  // Prevents empty-state flash while onMount restores terminals from server
  const [loaded, setLoaded] = createSignal(false);

  // Restore existing terminals on page load (e.g. after browser refresh).
  // A successful list() call proves the WebSocket is connected.
  onMount(async () => {
    const existing = await client.terminal.list();
    setWsStatus("open");
    if (existing.length > 0) {
      const ids = existing.map((t) => t.id);
      setTerminalIds(ids);
      const running = existing.find((t) => t.status === "running");
      // Prefer a running terminal; fall back to first (which may be exited)
      setActiveId(running?.id ?? ids[0]);
    }
    setLoaded(true);
  });

  /** Create a new terminal on the server, add it to the list, and make it active. */
  async function handleCreate() {
    const info = await client.terminal.create();
    setTerminalIds((prev) => [...prev, info.id]);
    setActiveId(info.id);
  }

  return (
    <div class="flex flex-col h-screen bg-slate-900 text-white">
      <Header status={wsStatus()} />
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
              <Show when={loaded() && terminalIds().length === 0}>
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
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;

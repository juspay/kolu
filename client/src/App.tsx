import { type Component, createSignal, Show } from "solid-js";
import Header, { type WsStatus } from "./Header";
import Terminal from "./Terminal";
import { THEME } from "./theme";
import { client } from "./rpc";

const App: Component = () => {
  const [wsStatus, setWsStatus] = createSignal<WsStatus>("connecting");
  const [terminalId, setTerminalId] = createSignal<string | null>(null);

  // Reuse an existing running terminal if one exists (e.g. after browser refresh),
  // otherwise create a new one. Phase 2b will replace this with sidebar-driven creation.
  (async () => {
    try {
      const existing = await client.terminal.list();
      const running = existing.find((t) => t.status === "running");
      const info = running ?? (await client.terminal.create());
      setTerminalId(info.id);
    } catch (err) {
      console.error("Failed to get/create terminal:", err);
      setWsStatus("closed");
    }
  })();

  return (
    <div class="flex flex-col h-screen bg-slate-900 text-white">
      <Header status={wsStatus()} />
      <div class="flex-1 min-h-0 p-2">
        <div
          class="h-full rounded border border-slate-700 overflow-hidden p-2"
          style={{ "background-color": THEME.background }}
        >
          <Show when={terminalId()}>
            {(id) => (
              <Terminal
                terminalId={id()}
                onConnected={() => setWsStatus("open")}
                onExit={() => setWsStatus("closed")}
              />
            )}
          </Show>
        </div>
      </div>
    </div>
  );
};

export default App;

import {
  type Component,
  createSignal,
  createResource,
  Show,
  Suspense,
  ErrorBoundary,
} from "solid-js";
import Header, { type WsStatus } from "./Header";
import Terminal from "./Terminal";
import { THEME } from "./theme";
import { client } from "./rpc";

/** Reuse an existing running terminal or create a new one (e.g. after browser refresh).
 * Phase 2b will replace this with sidebar-driven creation. */
async function acquireTerminal(): Promise<string> {
  const existing = await client.terminal.list();
  const running = existing.find((t) => t.status === "running");
  return (running ?? (await client.terminal.create())).id;
}

const App: Component = () => {
  const [wsStatus, setWsStatus] = createSignal<WsStatus>("connecting");
  const [terminalId] = createResource(acquireTerminal);

  return (
    <div class="flex flex-col h-screen bg-slate-900 text-white">
      <Header status={terminalId.error ? "closed" : wsStatus()} />
      <div class="flex-1 min-h-0 p-2">
        <div
          class="h-full rounded border border-slate-700 overflow-hidden p-2"
          style={{ "background-color": THEME.background }}
        >
          <Suspense
            fallback={<div class="text-slate-400 p-4">Connecting...</div>}
          >
            <ErrorBoundary
              fallback={(err) => (
                <div class="text-red-400 p-4">
                  Failed to connect: {String(err)}
                </div>
              )}
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
            </ErrorBoundary>
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default App;

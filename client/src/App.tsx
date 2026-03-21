import { type Component, createSignal } from "solid-js";
import Header, { type WsStatus } from "./Header";
import TerminalView from "./TerminalView";
import { GHOSTTY_THEME } from "./ghostty";

const App: Component = () => {
  const [wsStatus, setWsStatus] = createSignal<WsStatus>("connecting");

  return (
    <div class="flex flex-col h-screen bg-slate-900 text-white">
      <Header status={wsStatus()} />
      <div class="flex-1 min-h-0 p-2">
        <div
          class="h-full rounded border border-slate-700 overflow-hidden p-2"
          style={{ "background-color": GHOSTTY_THEME.background }}
        >
          <TerminalView sessionId="default" onWsStatus={setWsStatus} />
        </div>
      </div>
    </div>
  );
};

export default App;

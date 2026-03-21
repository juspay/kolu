import type { Component } from "solid-js";
import Header from "./Header";
import TerminalView from "./TerminalView";

const App: Component = () => {
  return (
    <div class="flex flex-col h-screen bg-slate-900 text-white">
      <Header />
      <div class="flex-1 min-h-0 p-2">
        <div class="h-full rounded border border-slate-700 overflow-hidden">
          <TerminalView sessionId="default" />
        </div>
      </div>
    </div>
  );
};

export default App;

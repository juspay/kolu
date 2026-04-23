import type { Component } from "solid-js";
import { A, Navigate, Route } from "@solidjs/router";

const BoardPlaceholder: Component = () => (
  <main class="flex flex-1 items-center justify-center px-6 py-10">
    <div class="max-w-md rounded-2xl border border-edge bg-surface-1 p-6 text-center shadow-lg">
      <h1 class="text-xl font-semibold text-fg">Board coming soon</h1>
      <p class="mt-2 text-sm text-fg-3">
        The board route is wired up, but the board UI is not implemented yet.
      </p>
      <A
        href="/workspace"
        class="mt-5 inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-1 hover:opacity-90"
      >
        Go to workspace
      </A>
    </div>
  </main>
);

const AppRoutes: Component<{
  workspacePage: Component;
}> = (props) => (
  <>
    <Route path="/" component={() => <Navigate href="/workspace" />} />
    <Route path="/workspace" component={props.workspacePage} />
    <Route path="/board" component={BoardPlaceholder} />
  </>
);

export default AppRoutes;

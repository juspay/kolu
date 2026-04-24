// @vitest-environment jsdom

import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { render } from "solid-js/web";
import { Router } from "@solidjs/router";
import AppRoutes from "./AppRoutes";

function renderAt(path: string) {
  window.history.replaceState({}, "", path);
  const container = document.createElement("div");
  document.body.append(container);
  const dispose = render(
    () => (
      <Router>
        <AppRoutes workspacePage={() => <div>Workspace sentinel</div>} />
      </Router>
    ),
    container,
  );
  return {
    container,
    dispose: () => {
      dispose();
      container.remove();
    },
  };
}

beforeAll(() => {
  vi.stubGlobal("scrollTo", vi.fn());
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("AppRoutes", () => {
  it("renders the workspace page at /workspace", () => {
    const view = renderAt("/workspace");
    expect(view.container.textContent).toContain("Workspace sentinel");
    view.dispose();
  });

  it("renders the board placeholder at /board with a workspace link", () => {
    const view = renderAt("/board");
    expect(view.container.textContent).toContain("Board coming soon");
    const link = view.container.querySelector("a[href='/workspace']");
    expect(link).not.toBeNull();
    view.dispose();
  });

  it("redirects / to /workspace", async () => {
    const view = renderAt("/");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.location.pathname).toBe("/workspace");
    expect(view.container.textContent).toContain("Workspace sentinel");
    view.dispose();
  });
});

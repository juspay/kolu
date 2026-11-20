// @vitest-environment happy-dom

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import BrowseFileDispatcher from "./BrowseFileDispatcher";

vi.mock("./BrowseFileView", () => ({
  default: (props: { content: string }) => (
    <pre data-testid="source-view">{props.content}</pre>
  ),
}));
vi.mock("@kolu/solid-pierre", () => ({ codeViewItemIdAt: () => undefined }));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
});

const show = (path: string, content: string): HTMLElement => {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <BrowseFileDispatcher
        at={null}
        filePath={path}
        file={{ path, source: { content, truncated: false } }}
        error={undefined}
        repoVault={{ paths: [], pending: false }}
        theme="dark"
      />
    ),
    host,
  );
  return host;
};

describe("a file read as text", () => {
  it("says there is no preview when the content holds a NUL", () => {
    const host = show(
      ".waterfall/mockup/fonts/a.woff2",
      "wOF2\0\0\u0001garbage",
    );
    expect(host.querySelector("[data-testid=file-no-preview]")).not.toBeNull();
    expect(host.querySelector("[data-testid=source-view]")).toBeNull();
  });

  it("draws ordinary text as source, as before", () => {
    const host = show("notes.txt", "plain words");
    expect(host.querySelector("[data-testid=file-no-preview]")).toBeNull();
    expect(host.querySelector("[data-testid=source-view]")?.textContent).toBe(
      "plain words",
    );
  });

  it("offers markdown its rendered view, as before", () => {
    const host = show("plan.md", "# The plan");
    expect(host.querySelector("[data-testid=file-no-preview]")).toBeNull();
    expect(
      host
        .querySelector("[data-testid=fileview-toggle-rendered]")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

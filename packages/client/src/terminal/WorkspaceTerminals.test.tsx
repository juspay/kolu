import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { expect, it } from "vitest";
import { WorkspaceTerminals } from "./WorkspaceTerminals";

it("moves the same terminal DOM between desktop and touch shells", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const [desktop, setDesktop] = createSignal(true);
  let mounts = 0;
  const dispose = render(
    () => (
      <WorkspaceTerminals
        ids={["tile"]}
        renderBody={() => {
          mounts++;
          return <textarea data-terminal="" />;
        }}
      >
        {(outlet) => (
          <Show
            when={desktop()}
            fallback={<section data-touch="">{outlet("tile")}</section>}
          >
            <main data-desktop="">{outlet("tile")}</main>
          </Show>
        )}
      </WorkspaceTerminals>
    ),
    host,
  );
  try {
    const terminal = host.querySelector("textarea")!;
    terminal.value = "retained selection";
    terminal.setSelectionRange(2, 8);
    setDesktop(false);
    expect(host.querySelector("[data-touch] textarea")).toBe(terminal);
    setDesktop(true);
    expect(host.querySelector("[data-desktop] textarea")).toBe(terminal);
    expect(terminal.selectionStart).toBe(2);
    expect(mounts).toBe(1);
  } finally {
    dispose();
    host.remove();
  }
});

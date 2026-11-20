import { createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
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
            fallback={
              <section data-touch="">{outlet("tile", () => true)}</section>
            }
          >
            <main data-desktop="">{outlet("tile", () => true)}</main>
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

it("switches hosts when each pane appears after its id", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const [ids, setIds] = createSignal(["a1", "a2"]);
  const [ready, setReady] = createStore<Record<string, boolean>>({
    a1: true,
    a2: true,
  });
  const mountedWithoutPane: string[] = [];
  const dispose = render(
    () => (
      <WorkspaceTerminals
        ids={ids()}
        renderBody={(id) => {
          if (!ready[id]) mountedWithoutPane.push(id);
          return <textarea data-body={id} />;
        }}
      >
        {(outlet) => (
          <For each={ids()}>
            {(id) => (
              <Show when={ready[id]}>
                <section data-pane={id}>{outlet(id, () => true)}</section>
              </Show>
            )}
          </For>
        )}
      </WorkspaceTerminals>
    ),
    host,
  );
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const bodyInPane = (id: string) =>
    host.querySelector(`[data-pane="${id}"] [data-body="${id}"]`);
  try {
    setIds(["b1", "b2"]);
    await settle();
    setReady({ b1: true, b2: true });
    await settle();
    expect(bodyInPane("b1")).not.toBeNull();
    expect(bodyInPane("b2")).not.toBeNull();
    expect(host.querySelector('[data-body="a1"]')).toBeNull();
    setIds(["a1", "a2"]);
    await settle();
    expect(bodyInPane("a1")).not.toBeNull();
    expect(bodyInPane("a2")).not.toBeNull();
    expect(mountedWithoutPane).toEqual([]);
  } finally {
    dispose();
    host.remove();
  }
});

it("asks the shell that is placing the body whether it can be seen", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const [desktop, setDesktop] = createSignal(true);
  const [onCanvas, setOnCanvas] = createSignal(false);
  let mounts = 0;
  const dispose = render(
    () => (
      <WorkspaceTerminals
        ids={["tile"]}
        renderBody={(_id, seen) => {
          mounts++;
          return <output data-seen={seen() ? "" : undefined} />;
        }}
      >
        {(outlet) => (
          <Show
            when={desktop()}
            fallback={
              <section data-touch="">{outlet("tile", () => true)}</section>
            }
          >
            <main data-desktop="">{outlet("tile", onCanvas)}</main>
          </Show>
        )}
      </WorkspaceTerminals>
    ),
    host,
  );
  const seen = () => host.querySelector("output")?.hasAttribute("data-seen");
  try {
    expect(seen()).toBe(false);
    setOnCanvas(true);
    expect(seen()).toBe(true);
    setDesktop(false);
    setOnCanvas(false);
    expect(seen()).toBe(true);
    setDesktop(true);
    expect(seen()).toBe(false);
    expect(mounts).toBe(1);
  } finally {
    dispose();
    host.remove();
  }
});

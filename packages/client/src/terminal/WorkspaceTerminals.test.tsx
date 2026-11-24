import { createSignal, For, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { render } from "solid-js/web";
import { expect, it } from "vitest";
import { WorkspaceTerminals } from "./WorkspaceTerminals";

/** A shell's placement that is seen and in front. */
const ALWAYS = { seen: () => true, viewShown: () => true };

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
            fallback={<section data-touch="">{outlet("tile", ALWAYS)}</section>}
          >
            <main data-desktop="">{outlet("tile", ALWAYS)}</main>
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
  // The desktop canvas gates every tile behind async per-host facts (tile
  // content + display info), so a pane can mount AFTER its id is listed. A
  // host switch swaps the ids wholesale while the old bodies are live.
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
                <section data-pane={id}>{outlet(id, ALWAYS)}</section>
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
    // B's records arrive a beat after the switch.
    setReady(
      produce((ready) => {
        Object.assign(ready, { b1: true, b2: true });
      }),
    );
    await settle();
    expect(bodyInPane("b1")).not.toBeNull();
    expect(bodyInPane("b2")).not.toBeNull();
    expect(host.querySelector('[data-body="a1"]')).toBeNull();
    setIds(["a1", "a2"]);
    await settle();
    expect(bodyInPane("a1")).not.toBeNull();
    expect(bodyInPane("a2")).not.toBeNull();
    // A body never starts life outside a real pane (it would measure a bogus
    // grid and re-attach once moved).
    expect(mountedWithoutPane).toEqual([]);
  } finally {
    dispose();
    host.remove();
  }
});

it("asks the shell that is placing the body whether it can be seen", () => {
  const host = document.createElement("div");
  document.body.append(host);
  // Each shell answers for itself: the canvas from its camera, the touch pane
  // from its active tile. The body reads whichever shell is placing it now —
  // and a swap re-points that without rebuilding the body.
  const [desktop, setDesktop] = createSignal(true);
  const [onCanvas, setOnCanvas] = createSignal(false);
  let mounts = 0;
  const dispose = render(
    () => (
      <WorkspaceTerminals
        ids={["tile"]}
        renderBody={(_id, { seen }) => {
          mounts++;
          return <output data-seen={seen() ? "" : undefined} />;
        }}
      >
        {(outlet) => (
          <Show
            when={desktop()}
            fallback={<section data-touch="">{outlet("tile", ALWAYS)}</section>}
          >
            <main data-desktop="">
              {outlet("tile", { seen: onCanvas, viewShown: () => true })}
            </main>
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
    // The touch shell shows its one tile unconditionally, so the canvas's
    // answer stops being the body's the moment the shell swaps.
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

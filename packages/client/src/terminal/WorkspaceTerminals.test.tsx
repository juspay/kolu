import {
  createSignal,
  createStore,
  flush,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { render } from "@solidjs/web";
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
    // The shell swap is a staged write: the DOM moves on the flush that
    // follows, which is where a real consumer sees it.
    flush();
    expect(host.querySelector("[data-touch] textarea")).toBe(terminal);
    setDesktop(true);
    flush();
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
    setReady((ready) => {
      Object.assign(ready, { b1: true, b2: true });
    });
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
    flush();
    expect(seen()).toBe(true);
    // The touch shell shows its one tile unconditionally, so the canvas's
    // answer stops being the body's the moment the shell swaps.
    setDesktop(false);
    setOnCanvas(false);
    flush();
    expect(seen()).toBe(true);
    setDesktop(true);
    flush();
    expect(seen()).toBe(false);
    expect(mounts).toBe(1);
  } finally {
    dispose();
    host.remove();
  }
});

it("keeps the body when the new shell's slot is placed before the old is released", () => {
  const host = document.createElement("div");
  document.body.append(host);
  // The two shells are siblings, so the swap ARRIVES before it DEPARTS: the
  // incoming slot's ref runs first, and the outgoing slot is released after.
  // The release must see that the destination is no longer its own element.
  const [desktop, setDesktop] = createSignal(true);
  // The slot's ref and its release run in these same two places (a child ref,
  // and the branch owner's cleanup), so they pin WHICH way round the swap
  // happened.
  const order: string[] = [];
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
        {(outlet) => {
          const Desktop = () => {
            onCleanup(() => order.push("desktop out"));
            return (
              <main data-desktop="" ref={() => order.push("desktop in")}>
                {outlet("tile", ALWAYS)}
              </main>
            );
          };
          return (
            <>
              <Show when={!desktop()}>
                <section data-touch="" ref={() => order.push("touch in")}>
                  {outlet("tile", ALWAYS)}
                </section>
              </Show>
              <Show when={desktop()}>
                <Desktop />
              </Show>
            </>
          );
        }}
      </WorkspaceTerminals>
    ),
    host,
  );
  try {
    const terminal = host.querySelector("textarea")!;
    setDesktop(false);
    flush();
    // The hazard is real only if the arrival ran first.
    expect(order).toEqual(["desktop in", "touch in", "desktop out"]);
    expect(host.querySelector("[data-touch] textarea")).toBe(terminal);
    expect(mounts).toBe(1);
  } finally {
    dispose();
    host.remove();
  }
});

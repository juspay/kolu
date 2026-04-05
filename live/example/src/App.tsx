/**
 * Example client: a worker dashboard demonstrating all live/ primitives.
 *
 * - createLive returns a SolidJS signal: meta() reads the value
 * - meta.pending(), meta.error() for lifecycle
 * - createAction for mutations with pending state
 * - Fine-grained reactivity: () => meta()?.tickCount
 */

import { Show, For, createMemo } from "solid-js";
import { createLive, createAction } from "../../src/solid.ts";
import { client } from "./rpc.ts";

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function WorkerDashboard() {
  const list = createLive(() => client.worker.list());
  const [create, creating] = createAction(() => client.worker.create());

  return (
    <div
      style={{
        "font-family": "monospace",
        padding: "20px",
        "max-width": "800px",
      }}
    >
      <h1>live/ example</h1>
      <p style={{ color: "#666", "margin-bottom": "16px" }}>
        createLive (signal) · createAction · fine-grained reactivity
      </p>

      <button
        onClick={() => create()}
        disabled={creating.pending()}
        style={{
          padding: "8px 16px",
          "margin-bottom": "16px",
          cursor: "pointer",
        }}
      >
        {creating.pending() ? "Creating..." : "+ New Worker"}
      </button>

      <Show when={list.pending()}>
        <p>Connecting...</p>
      </Show>
      <Show when={list.error()}>
        {(err) => <p style={{ color: "#f85149" }}>Error: {err().message}</p>}
      </Show>

      <For
        each={list()}
        fallback={<p style={{ color: "#666" }}>No workers yet.</p>}
      >
        {(info) => <WorkerCard id={info.id} />}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-worker card
// ---------------------------------------------------------------------------

function WorkerCard(props: { id: string }) {
  // meta() IS a SolidJS signal — reads the current value
  const meta = createLive(() =>
    client.worker.onMetadataChange({ id: props.id }),
  );

  // Accumulating via reducer
  const samples = createLive(
    () => client.worker.onActivityChange({ id: props.id }),
    {
      reduce: (acc: [number, boolean][], sample: [number, boolean]) =>
        [...acc, sample].slice(-50),
      initial: [] as [number, boolean][],
    },
  );

  const output = createLive(() => client.worker.attach({ id: props.id }), {
    reduce: (acc: string[], line: string) => [...acc, line].slice(-5),
    initial: [] as string[],
  });

  const [kill, killing] = createAction(() =>
    client.worker.kill({ id: props.id }),
  );
  const [toggle] = createAction(() => client.worker.toggle({ id: props.id }));

  // Derived — just read from the signal directly
  const name = () => meta()?.name ?? "...";
  const tickCount = () => meta()?.tickCount ?? 0;
  const status = () => meta()?.status ?? "...";
  const intervalMs = () => meta()?.intervalMs ?? 0;

  const sparkline = createMemo(() => {
    const s = samples() ?? [];
    return s.map(([, active]) => (active ? "▓" : "░")).join("");
  });

  return (
    <div
      style={{
        border: "1px solid #333",
        padding: "12px",
        "margin-bottom": "8px",
        "border-radius": "4px",
        background: status() === "paused" ? "#1a1a1a" : "#0d1117",
      }}
    >
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
        }}
      >
        <strong>
          {name()} <span style={{ color: "#666" }}>#{props.id}</span>
        </strong>
        <span>
          <button
            onClick={() => toggle()}
            style={{ "margin-right": "4px", cursor: "pointer" }}
          >
            {status() === "running" ? "⏸" : "▶"}
          </button>
          <button
            onClick={() => kill()}
            disabled={killing.pending()}
            style={{ cursor: "pointer" }}
          >
            ✕
          </button>
        </span>
      </div>

      <div
        style={{ "font-size": "12px", color: "#8b949e", "margin-top": "4px" }}
      >
        {status()} · {tickCount()} ticks · every {intervalMs()}ms
      </div>

      <div
        style={{
          "font-size": "10px",
          "margin-top": "4px",
          "letter-spacing": "1px",
        }}
      >
        {sparkline()}
      </div>

      <Show when={(output()?.length ?? 0) > 0}>
        <pre
          style={{
            "font-size": "11px",
            color: "#7ee787",
            background: "#0d1117",
            padding: "4px",
            "margin-top": "4px",
            "max-height": "80px",
            overflow: "hidden",
          }}
        >
          {output()?.join("\n")}
        </pre>
      </Show>
    </div>
  );
}

export default WorkerDashboard;

/**
 * Example client: a worker dashboard demonstrating all live/ primitives.
 *
 * - createLive (replacing): worker list, per-worker metadata
 * - createLive (accumulating): activity samples with reducer
 * - createAction: create/kill/toggle mutations with pending state
 * - Fine-grained reactivity: derived accessors like () => meta.value()?.tickCount
 */

import { Show, For, createMemo } from "solid-js";
import { createLive, createAction } from "../../src/solid.ts";
import { client } from "./rpc.ts";

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function WorkerDashboard() {
  // Live worker list (replacing — each event is the full list)
  const list = createLive(() => client.worker.list());

  // Mutation with lifecycle tracking
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
        createLive (replacing + accumulating) · createAction · fine-grained
        reactivity
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
        each={list.value()}
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
  // Live metadata (replacing) — fine-grained: each field tracked independently
  const meta = createLive(() =>
    client.worker.onMetadataChange({ id: props.id }),
  );

  // Activity samples (accumulating via reducer, keep last 50)
  const samples = createLive(
    () => client.worker.onActivityChange({ id: props.id }),
    {
      reduce: (acc: [number, boolean][], sample: [number, boolean]) =>
        [...acc, sample].slice(-50),
      initial: [] as [number, boolean][],
    },
  );

  // Live tick output (accumulating, keep last 5 lines)
  const output = createLive(() => client.worker.attach({ id: props.id }), {
    reduce: (acc: string[], line: string) => [...acc, line].slice(-5),
    initial: [] as string[],
  });

  // Mutations
  const [kill, killing] = createAction(() =>
    client.worker.kill({ id: props.id }),
  );
  const [toggle] = createAction(() => client.worker.toggle({ id: props.id }));

  // Derived accessors — only re-render when the specific field changes
  const name = () => meta.value()?.name ?? "...";
  const tickCount = () => meta.value()?.tickCount ?? 0;
  const status = () => meta.value()?.status ?? "...";
  const intervalMs = () => meta.value()?.intervalMs ?? 0;

  // Activity sparkline
  const sparkline = createMemo(() => {
    const s = samples.value() ?? [];
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

      <Show when={(output.value()?.length ?? 0) > 0}>
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
          {output.value()?.join("\n")}
        </pre>
      </Show>
    </div>
  );
}

export default WorkerDashboard;

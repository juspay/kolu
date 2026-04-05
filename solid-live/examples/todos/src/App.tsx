/**
 * Shared todo list — add, edit, complete, delete.
 * Open in two browser tabs to see changes sync instantly.
 *
 * Demonstrates:
 * - createLive for live stream (signal + .pending() + .error())
 * - Plain RPC calls for mutations, with error handling
 * - createMemo for derived state (counts)
 */

import { Show, For, createMemo, createSignal } from "solid-js";
import { createSubscription } from "../../../src/solid.ts";
import { client } from "./rpc.ts";

type Todo = { id: string; text: string; done: boolean };

/** Shared error signal — mutations catch and display errors here. */
const [lastError, setLastError] = createSignal<string | null>(null);

/** Call an RPC mutation, catch errors and surface them. */
async function rpc<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    setLastError(null);
    return await fn();
  } catch (err) {
    setLastError(err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

function TodoApp() {
  // Live stream — solid-live
  const todos = createSubscription(() => client.todos.list());
  const [input, setInput] = createSignal("");

  // Derived counts — standard SolidJS
  const total = createMemo(() => todos()?.length ?? 0);
  const done = createMemo(() => todos()?.filter((t) => t.done).length ?? 0);
  const remaining = createMemo(() => total() - done());

  function handleSubmit(e: Event) {
    e.preventDefault();
    const text = input().trim();
    if (!text) return;
    rpc(() => client.todos.add({ text }));
    setInput("");
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>solid-live todos</h1>
      <p style={styles.hint}>
        Open this page in two tabs — changes sync instantly.
      </p>

      {/* Stream loading state */}
      <Show when={todos.pending()}>
        <p style={styles.loading}>Connecting to server...</p>
      </Show>

      {/* Stream error (WebSocket disconnected, etc.) */}
      <Show when={todos.error()}>
        {(err) => <p style={styles.error}>Stream error: {err().message}</p>}
      </Show>

      {/* Mutation error (RPC call failed) */}
      <Show when={lastError()}>
        {(msg) => (
          <p style={styles.error}>
            {msg()}{" "}
            <button onClick={() => setLastError(null)} style={styles.dismiss}>
              dismiss
            </button>
          </p>
        )}
      </Show>

      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          type="text"
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          placeholder="What needs to be done?"
          style={styles.input}
        />
        <button type="submit" style={styles.addBtn}>
          Add
        </button>
      </form>

      <For each={todos()} fallback={<p style={styles.hint}>No todos yet.</p>}>
        {(todo) => <TodoItem todo={todo} />}
      </For>

      <Show when={total() > 0}>
        <div style={styles.stats}>
          {done()} done · {remaining()} remaining · {total()} total
        </div>
      </Show>
    </div>
  );
}

function TodoItem(props: { todo: Todo }) {
  const [editing, setEditing] = createSignal(false);
  const [editText, setEditText] = createSignal(props.todo.text);

  function handleEdit(e: Event) {
    e.preventDefault();
    const text = editText().trim();
    if (text && text !== props.todo.text) {
      rpc(() => client.todos.edit({ id: props.todo.id, text }));
    }
    setEditing(false);
  }

  return (
    <div
      style={{
        ...styles.item,
        opacity: props.todo.done ? "0.5" : "1",
      }}
    >
      <input
        type="checkbox"
        checked={props.todo.done}
        onChange={() => rpc(() => client.todos.toggle({ id: props.todo.id }))}
        style={styles.checkbox}
      />

      <Show
        when={editing()}
        fallback={
          <span
            onDblClick={() => {
              setEditing(true);
              setEditText(props.todo.text);
            }}
            style={{
              ...styles.text,
              "text-decoration": props.todo.done ? "line-through" : "none",
            }}
          >
            {props.todo.text}
          </span>
        }
      >
        <form onSubmit={handleEdit} style={{ flex: "1" }}>
          <input
            type="text"
            value={editText()}
            onInput={(e) => setEditText(e.currentTarget.value)}
            onBlur={handleEdit}
            autofocus
            style={styles.editInput}
          />
        </form>
      </Show>

      <button
        onClick={() => rpc(() => client.todos.remove({ id: props.todo.id }))}
        style={styles.removeBtn}
      >
        ✕
      </button>
    </div>
  );
}

const styles = {
  container: {
    "font-family": "system-ui, sans-serif",
    "max-width": "480px",
    margin: "40px auto",
    padding: "0 20px",
  },
  title: {
    "font-size": "24px",
    "font-weight": "600",
    "margin-bottom": "4px",
  },
  hint: {
    color: "#8b949e",
    "font-size": "13px",
    "margin-bottom": "16px",
  },
  loading: {
    color: "#58a6ff",
    "font-size": "13px",
    "margin-bottom": "8px",
  },
  error: {
    color: "#f85149",
    "font-size": "13px",
    "margin-bottom": "8px",
    padding: "8px 12px",
    background: "#1c1012",
    "border-radius": "6px",
    border: "1px solid #f8514933",
  },
  dismiss: {
    border: "none",
    background: "none",
    color: "#8b949e",
    cursor: "pointer",
    "text-decoration": "underline",
    "font-size": "12px",
  },
  form: {
    display: "flex",
    gap: "8px",
    "margin-bottom": "16px",
  },
  input: {
    flex: "1",
    padding: "8px 12px",
    border: "1px solid #333",
    "border-radius": "6px",
    background: "#161b22",
    color: "#e6edf3",
    "font-size": "14px",
    outline: "none",
  },
  addBtn: {
    padding: "8px 16px",
    border: "1px solid #333",
    "border-radius": "6px",
    background: "#238636",
    color: "#fff",
    cursor: "pointer",
    "font-size": "14px",
  },
  item: {
    display: "flex",
    "align-items": "center",
    gap: "8px",
    padding: "8px 0",
    "border-bottom": "1px solid #21262d",
  },
  checkbox: {
    width: "18px",
    height: "18px",
    cursor: "pointer",
  },
  text: {
    flex: "1",
    "font-size": "14px",
    cursor: "default",
  },
  editInput: {
    width: "100%",
    padding: "4px 8px",
    border: "1px solid #58a6ff",
    "border-radius": "4px",
    background: "#161b22",
    color: "#e6edf3",
    "font-size": "14px",
    outline: "none",
  },
  removeBtn: {
    border: "none",
    background: "none",
    color: "#8b949e",
    cursor: "pointer",
    "font-size": "14px",
    padding: "4px 8px",
  },
  stats: {
    "margin-top": "12px",
    "font-size": "13px",
    color: "#8b949e",
  },
} as const;

export default TodoApp;

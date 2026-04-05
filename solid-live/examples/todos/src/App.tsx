/**
 * Shared todo list — add, edit, complete, delete.
 * Open in two browser tabs to see changes sync in real time.
 */

import { Show, For, createMemo, createSignal } from "solid-js";
import { createLive, createAction } from "../../../src/solid.ts";
import { client } from "./rpc.ts";

type Todo = { id: string; text: string; done: boolean };

function TodoApp() {
  const todos = createLive(() => client.todos.list());
  const [add, adding] = createAction((text: string) =>
    client.todos.add({ text }),
  );

  const [input, setInput] = createSignal("");

  // Derived counts — reactive, update automatically
  const total = createMemo(() => todos()?.length ?? 0);
  const done = createMemo(() => todos()?.filter((t) => t.done).length ?? 0);
  const pending = createMemo(() => total() - done());

  function handleSubmit(e: Event) {
    e.preventDefault();
    const text = input().trim();
    if (!text) return;
    add(text);
    setInput("");
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>solid-live todos</h1>
      <p style={styles.hint}>
        Open this page in two tabs — changes sync instantly.
      </p>

      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          type="text"
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          placeholder="What needs to be done?"
          style={styles.input}
        />
        <button type="submit" disabled={adding.pending()} style={styles.addBtn}>
          {adding.pending() ? "..." : "Add"}
        </button>
      </form>

      <Show when={todos.pending()}>
        <p style={styles.hint}>Connecting...</p>
      </Show>
      <Show when={todos.error()}>
        {(err) => <p style={{ color: "#f85149" }}>{err().message}</p>}
      </Show>

      <For each={todos()} fallback={<p style={styles.hint}>No todos yet.</p>}>
        {(todo) => <TodoItem todo={todo} />}
      </For>

      <Show when={total() > 0}>
        <div style={styles.stats}>
          {done()} done · {pending()} pending · {total()} total
        </div>
      </Show>
    </div>
  );
}

function TodoItem(props: { todo: Todo }) {
  const [toggle] = createAction(() =>
    client.todos.toggle({ id: props.todo.id }),
  );
  const [remove, removing] = createAction(() =>
    client.todos.remove({ id: props.todo.id }),
  );
  const [edit] = createAction((text: string) =>
    client.todos.edit({ id: props.todo.id, text }),
  );

  const [editing, setEditing] = createSignal(false);
  const [editText, setEditText] = createSignal(props.todo.text);

  function handleEdit(e: Event) {
    e.preventDefault();
    const text = editText().trim();
    if (text && text !== props.todo.text) edit(text);
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
        onChange={() => toggle()}
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
        onClick={() => remove()}
        disabled={removing.pending()}
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

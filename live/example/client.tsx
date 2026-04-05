/**
 * Example client: SolidJS components consuming live streams.
 *
 * Demonstrates:
 *  - createLive for replacing streams (counter, metadata)
 *  - createLive with reducer for accumulating streams (chat messages)
 *  - createAction for mutation lifecycle tracking
 *  - Fine-grained reactivity via store/reconcile (only changed fields re-render)
 *  - Optimistic updates via mutate()
 *
 * This is a conceptual example — not runnable as-is, but shows the exact
 * API patterns you'd use in a real SolidJS app with oRPC or similar.
 */

import { Show, For } from "solid-js";
import { createLive, createAction } from "../src/solid.ts";

// ---------------------------------------------------------------------------
// Assume these come from an oRPC client (or any typed RPC returning
// Promise<AsyncIterable<T>> for streaming endpoints)
// ---------------------------------------------------------------------------

declare const client: {
  counter: {
    live: () => Promise<AsyncIterable<number>>;
  };
  chat: {
    messages: (input: {
      room: string;
    }) => Promise<AsyncIterable<{ user: string; text: string }>>;
    send: (input: {
      room: string;
      text: string;
    }) => Promise<{ user: string; text: string }>;
  };
  terminal: {
    onMetadataChange: (input: {
      id: string;
    }) => Promise<
      AsyncIterable<{
        label: string;
        cwd: string;
        git: { branch: string } | null;
      }>
    >;
    setTheme: (input: { id: string; theme: string }) => Promise<void>;
  };
};

// ---------------------------------------------------------------------------
// 1. Simple replacing stream — counter
// ---------------------------------------------------------------------------

function CounterDisplay() {
  const counter = createLive(() => client.counter.live());

  return (
    <div>
      <Show when={counter.pending()}>Connecting...</Show>
      <Show when={counter.error()}>
        {(err) => <span>Error: {err().message}</span>}
      </Show>
      <Show when={!counter.pending()}>Count: {counter.value()}</Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Accumulating stream with reducer — chat messages
// ---------------------------------------------------------------------------

type ChatMessage = { user: string; text: string };

function ChatRoom(props: { room: string }) {
  // Accumulate messages into an array, keep last 100
  const messages = createLive(
    () => client.chat.messages({ room: props.room }),
    {
      reduce: (acc: ChatMessage[], msg: ChatMessage) =>
        [...acc, msg].slice(-100),
      initial: [] as ChatMessage[],
    },
  );

  // Mutation with lifecycle tracking
  const [send, sending] = createAction((text: string) =>
    client.chat.send({ room: props.room, text }),
  );

  return (
    <div>
      <For each={messages.value()}>
        {(msg) => (
          <p>
            <strong>{msg.user}:</strong> {msg.text}
          </p>
        )}
      </For>

      <button onClick={() => send("hello!")} disabled={sending.pending()}>
        {sending.pending() ? "Sending..." : "Send"}
      </button>

      <Show when={sending.error()}>
        {(err) => <span>Failed: {err().message}</span>}
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Fine-grained reactivity — only re-render changed fields
// ---------------------------------------------------------------------------

function TerminalTab(props: { id: string }) {
  const meta = createLive(() =>
    client.terminal.onMetadataChange({ id: props.id }),
  );

  // These are plain derived accessors — no select() needed.
  // Because createLive uses createStore + reconcile internally,
  // each field is tracked independently. Accessing meta.value()?.cwd
  // only subscribes to the cwd field; changes to label or git
  // won't cause this component to re-render.
  const label = () => meta.value()?.label;
  const cwd = () => meta.value()?.cwd;
  const branch = () => meta.value()?.git?.branch;

  return (
    <div>
      <Show when={meta.pending()}>Loading...</Show>
      <h3>{label()}</h3>
      <span>{cwd()}</span>
      <Show when={branch()}>{(b) => <span> ({b()})</span>}</Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Optimistic update via mutate()
// ---------------------------------------------------------------------------

function ThemePicker(props: { terminalId: string }) {
  const meta = createLive(() =>
    client.terminal.onMetadataChange({ id: props.terminalId }),
  );

  function setTheme(theme: string) {
    // Optimistic: update local state immediately
    // Server call fires in the background
    // Next live push from server overwrites (confirms or corrects)
    meta.mutate(
      (current) => ({ ...current, label: `${current.label} [${theme}]` }),
      () => client.terminal.setTheme({ id: props.terminalId, theme }),
    );
  }

  return <button onClick={() => setTheme("dracula")}>Set Dracula</button>;
}

// ---------------------------------------------------------------------------
// Exports for type-checking — this file is conceptual, not runnable
// ---------------------------------------------------------------------------
export { CounterDisplay, ChatRoom, TerminalTab, ThemePicker };

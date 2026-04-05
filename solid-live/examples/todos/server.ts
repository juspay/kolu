/**
 * Shared todo list — server holds state as a signal,
 * multiple clients see changes in real time.
 */

import { RPCHandler } from "@orpc/server/ws";
import { implement } from "@orpc/server";
import { WebSocketServer } from "ws";
import { oc, eventIterator } from "@orpc/contract";
import { z } from "zod";
import { createSignal, flush } from "@solidjs/signals";
import { live } from "../../src/server.ts";

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

const TodoSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
});

const contract = oc.router({
  todos: {
    list: oc.output(eventIterator(z.array(TodoSchema))),
    add: oc.input(z.object({ text: z.string() })).output(TodoSchema),
    toggle: oc.input(z.object({ id: z.string() })).output(z.void()),
    edit: oc
      .input(z.object({ id: z.string(), text: z.string() }))
      .output(z.void()),
    remove: oc.input(z.object({ id: z.string() })).output(z.void()),
  },
});

export type { contract };

// ---------------------------------------------------------------------------
// State — one signal, the entire todo list
// ---------------------------------------------------------------------------

type Todo = z.infer<typeof TodoSchema>;

const [todos, setTodos] = createSignal<Todo[]>([]);
let nextId = 1;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const t = implement(contract);

const router = t.router({
  todos: {
    list: t.todos.list.handler(async function* ({ signal }) {
      yield* live(() => todos())(signal);
    }),

    add: t.todos.add.handler(async ({ input }) => {
      const todo: Todo = {
        id: String(nextId++),
        text: input.text,
        done: false,
      };
      setTodos((list) => [...list, todo]);
      flush();
      console.log(`+ "${todo.text}"`);
      return todo;
    }),

    toggle: t.todos.toggle.handler(async ({ input }) => {
      setTodos((list) =>
        list.map((t) => (t.id === input.id ? { ...t, done: !t.done } : t)),
      );
      flush();
    }),

    edit: t.todos.edit.handler(async ({ input }) => {
      setTodos((list) =>
        list.map((t) => (t.id === input.id ? { ...t, text: input.text } : t)),
      );
      flush();
    }),

    remove: t.todos.remove.handler(async ({ input }) => {
      setTodos((list) => list.filter((t) => t.id !== input.id));
      flush();
      console.log(`- removed ${input.id}`);
    }),
  },
});

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const PORT = 3123;
const wss = new WebSocketServer({ port: PORT });
const rpcHandler = new RPCHandler(router);

wss.on("connection", (ws) => {
  rpcHandler.upgrade(ws, { context: {} });
});

console.log(`Todo server: ws://localhost:${PORT}`);

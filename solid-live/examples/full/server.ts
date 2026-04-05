/**
 * Example server: a worker manager using signals for state.
 *
 * Workers tick at random intervals. State is reactive signals —
 * `live()` bridges signals to the wire. Discrete events (ticks,
 * activity) use oRPC's MemoryPublisher.
 */

import { RPCHandler } from "@orpc/server/ws";
import { implement } from "@orpc/server";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import { WebSocketServer } from "ws";
import { oc, eventIterator } from "@orpc/contract";
import { z } from "zod";
import { createSignal, createMemo, flush } from "@solidjs/signals";
import { toAsyncIterable } from "../../src/server.ts";

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

const WorkerInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
});

const WorkerMetaSchema = z.object({
  name: z.string(),
  tickCount: z.number(),
  status: z.enum(["running", "paused"]),
  intervalMs: z.number(),
});

const ActivitySampleSchema = z.tuple([z.number(), z.boolean()]);
const IdInput = z.object({ id: z.string() });

const contract = oc.router({
  worker: {
    list: oc.output(eventIterator(z.array(WorkerInfoSchema))),
    onMetadataChange: oc.input(IdInput).output(eventIterator(WorkerMetaSchema)),
    onActivityChange: oc
      .input(IdInput)
      .output(eventIterator(ActivitySampleSchema)),
    attach: oc.input(IdInput).output(eventIterator(z.string())),
    create: oc.output(WorkerInfoSchema),
    kill: oc.input(IdInput).output(z.void()),
    toggle: oc.input(IdInput).output(z.void()),
  },
});

export type { contract };

// ---------------------------------------------------------------------------
// Event publisher — oRPC's MemoryPublisher for discrete events
// ---------------------------------------------------------------------------

type WorkerId = string;
type ActivitySample = [epochMs: number, isActive: boolean];

// Channel names are keyed by worker ID (e.g., "tick:1", "activity:1")
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const publisher = new MemoryPublisher<Record<string, any>>();

// ---------------------------------------------------------------------------
// Worker entity — reactive state via signals
// ---------------------------------------------------------------------------

type Worker = {
  info: z.infer<typeof WorkerInfoSchema>;
  tickCount: ReturnType<typeof createSignal<number>>;
  status: ReturnType<typeof createSignal<"running" | "paused">>;
  meta: () => z.infer<typeof WorkerMetaSchema>;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  activityHistory: ActivitySample[];
};

// ---------------------------------------------------------------------------
// Worker list — reactive signal
// ---------------------------------------------------------------------------

const workerMap = new Map<WorkerId, Worker>();
const [workerList, setWorkerList] = createSignal<
  z.infer<typeof WorkerInfoSchema>[]
>([]);

function syncWorkerList() {
  setWorkerList([...workerMap.values()].map((w) => w.info));
  flush();
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

let nextId = 1;
const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];

function createWorker(): z.infer<typeof WorkerInfoSchema> {
  const id = String(nextId++);
  const name = names[(nextId - 2) % names.length]!;
  const intervalMs = 500 + Math.floor(Math.random() * 1500);

  const [tickCount, setTickCount] = createSignal(0);
  const [status, setStatus] = createSignal<"running" | "paused">("running");
  const meta = createMemo(() => ({
    name,
    tickCount: tickCount(),
    status: status(),
    intervalMs,
  }));

  const worker: Worker = {
    info: { id, name, createdAt: Date.now() },
    tickCount: [tickCount, setTickCount],
    status: [status, setStatus],
    meta,
    intervalMs,
    timer: null,
    activityHistory: [],
  };

  worker.timer = setInterval(() => tick(worker), intervalMs);
  workerMap.set(id, worker);
  syncWorkerList();
  console.log(`+ worker ${id} (${name}) every ${intervalMs}ms`);
  return worker.info;
}

function tick(worker: Worker) {
  const [, setTickCount] = worker.tickCount;
  setTickCount((c) => c + 1);
  flush();

  const count = worker.tickCount[0]();
  void publisher.publish(
    `tick:${worker.info.id}`,
    `[${worker.info.name}] tick #${count}`,
  );

  const sample: ActivitySample = [Date.now(), true];
  worker.activityHistory.push(sample);
  if (worker.activityHistory.length > 100)
    worker.activityHistory = worker.activityHistory.slice(-100);
  void publisher.publish(`activity:${worker.info.id}`, sample);
}

function requireWorker(id: WorkerId): Worker {
  const worker = workerMap.get(id);
  if (!worker) throw new Error(`worker ${id} not found`);
  return worker;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const t = implement(contract);

const router = t.router({
  worker: {
    // State streams — powered by live() + signals
    list: t.worker.list.handler(async function* ({ signal }) {
      yield* toAsyncIterable(() => workerList())(signal);
    }),

    onMetadataChange: t.worker.onMetadataChange.handler(async function* ({
      input,
      signal,
    }) {
      const worker = requireWorker(input.id);
      yield* toAsyncIterable(() => worker.meta())(signal);
    }),

    // Event streams — oRPC publisher, snapshot then live
    onActivityChange: t.worker.onActivityChange.handler(async function* ({
      input,
      signal,
    }) {
      const worker = requireWorker(input.id);
      for (const sample of worker.activityHistory) yield sample;
      for await (const sample of publisher.subscribe(`activity:${input.id}`, {
        signal,
      }) as AsyncIterable<ActivitySample>) {
        yield sample;
      }
    }),

    attach: t.worker.attach.handler(async function* ({ input, signal }) {
      requireWorker(input.id);
      for await (const msg of publisher.subscribe(`tick:${input.id}`, {
        signal,
      }) as AsyncIterable<string>) {
        yield msg;
      }
    }),

    // Mutations
    create: t.worker.create.handler(async () => createWorker()),

    kill: t.worker.kill.handler(async ({ input }) => {
      const worker = requireWorker(input.id);
      if (worker.timer) clearInterval(worker.timer);
      workerMap.delete(input.id);
      syncWorkerList();
      console.log(`- worker ${input.id} (${worker.info.name})`);
    }),

    toggle: t.worker.toggle.handler(async ({ input }) => {
      const worker = requireWorker(input.id);
      const [, setStatus] = worker.status;
      const [status] = worker.status;
      if (status() === "running") {
        if (worker.timer) clearInterval(worker.timer);
        worker.timer = null;
        setStatus("paused");
        flush();
        void publisher.publish(`activity:${input.id}`, [
          Date.now(),
          false,
        ] as ActivitySample);
      } else {
        setStatus("running");
        flush();
        worker.timer = setInterval(() => tick(worker), worker.intervalMs);
        void publisher.publish(`activity:${input.id}`, [
          Date.now(),
          true,
        ] as ActivitySample);
      }
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

console.log(`Worker manager: ws://localhost:${PORT}`);

// Seed one worker
createWorker();

/**
 * Example server: a worker manager using signals for state.
 *
 * Workers tick at random intervals. State is reactive signals —
 * no manual publish calls. `live()` bridges signals to the wire.
 * Activity samples use `events()` (discrete events, not state).
 */

import { RPCHandler } from "@orpc/server/ws";
import { implement } from "@orpc/server";
import { WebSocketServer } from "ws";
import { oc, eventIterator } from "@orpc/contract";
import { z } from "zod";
import { createSignal, createMemo, flush } from "@solidjs/signals";
import { live, events } from "../../src/server.ts";

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
// Worker entity — reactive state via signals
// ---------------------------------------------------------------------------

type WorkerId = string;
type ActivitySample = [epochMs: number, isActive: boolean];

type Worker = {
  info: z.infer<typeof WorkerInfoSchema>;
  tickCount: ReturnType<typeof createSignal<number>>;
  status: ReturnType<typeof createSignal<"running" | "paused">>;
  meta: () => z.infer<typeof WorkerMetaSchema>;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  activityHistory: ActivitySample[];
  pushActivity: (sample: ActivitySample) => void;
  iterateActivity: (signal?: AbortSignal) => AsyncIterable<ActivitySample>;
  pushTick: (msg: string) => void;
  iterateTicks: (signal?: AbortSignal) => AsyncIterable<string>;
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

  const [pushActivity, iterateActivity] = events<ActivitySample>();
  const [pushTick, iterateTicks] = events<string>();

  const worker: Worker = {
    info: { id, name, createdAt: Date.now() },
    tickCount: [tickCount, setTickCount],
    status: [status, setStatus],
    meta,
    intervalMs,
    timer: null,
    activityHistory: [],
    pushActivity,
    iterateActivity,
    pushTick,
    iterateTicks,
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
  worker.pushTick(`[${worker.info.name}] tick #${count}`);

  const sample: ActivitySample = [Date.now(), true];
  worker.activityHistory.push(sample);
  if (worker.activityHistory.length > 100)
    worker.activityHistory = worker.activityHistory.slice(-100);
  worker.pushActivity(sample);
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
      yield* live(() => workerList())(signal);
    }),

    onMetadataChange: t.worker.onMetadataChange.handler(async function* ({
      input,
      signal,
    }) {
      const worker = requireWorker(input.id);
      yield* live(() => worker.meta())(signal);
    }),

    // Event streams — snapshot then live events
    onActivityChange: t.worker.onActivityChange.handler(async function* ({
      input,
      signal,
    }) {
      const worker = requireWorker(input.id);
      for (const sample of worker.activityHistory) yield sample;
      for await (const sample of worker.iterateActivity(signal)) yield sample;
    }),

    attach: t.worker.attach.handler(async function* ({ input, signal }) {
      const worker = requireWorker(input.id);
      for await (const msg of worker.iterateTicks(signal)) yield msg;
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
        worker.pushActivity([Date.now(), false]);
      } else {
        setStatus("running");
        flush();
        worker.timer = setInterval(() => tick(worker), worker.intervalMs);
        worker.pushActivity([Date.now(), true]);
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

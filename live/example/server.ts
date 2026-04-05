/**
 * Example server: a worker manager demonstrating all live primitives.
 *
 * Workers tick at random intervals. Each worker has:
 *  - Live metadata (name, tickCount, status) — replacing stream
 *  - Activity samples — accumulating stream
 *  - Tick output — raw stream
 *
 * Uses oRPC for typed WebSocket RPC (same as Kolu).
 */

import { RPCHandler } from "@orpc/server/ws";
import { implement } from "@orpc/server";
import { WebSocketServer } from "ws";
import { oc, eventIterator } from "@orpc/contract";
import { z } from "zod";
import {
  createChannel,
  createKeyedChannel,
  liveQuery,
  liveQueryMany,
} from "../src/server.ts";

// ---------------------------------------------------------------------------
// Contract (shared types — in a real app, this lives in a common/ package)
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
// Channels
// ---------------------------------------------------------------------------

type WorkerId = string;
type ActivitySample = [epochMs: number, isActive: boolean];

const workerList = createChannel<z.infer<typeof WorkerInfoSchema>[]>();
const metadataCh = createKeyedChannel<
  WorkerId,
  z.infer<typeof WorkerMetaSchema>
>();
const activityCh = createKeyedChannel<WorkerId, ActivitySample>();
const ticksCh = createKeyedChannel<WorkerId, string>();

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

type WorkerEntry = {
  info: z.infer<typeof WorkerInfoSchema>;
  meta: z.infer<typeof WorkerMetaSchema>;
  activityHistory: ActivitySample[];
  timer: ReturnType<typeof setInterval> | null;
};

const workers = new Map<WorkerId, WorkerEntry>();
let nextId = 1;
const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];

function listWorkers() {
  return [...workers.values()].map((w) => w.info);
}

function tick(entry: WorkerEntry) {
  entry.meta = { ...entry.meta, tickCount: entry.meta.tickCount + 1 };
  metadataCh.publish(entry.info.id, entry.meta);
  ticksCh.publish(
    entry.info.id,
    `[${entry.info.name}] tick #${entry.meta.tickCount}`,
  );
  const sample: ActivitySample = [Date.now(), true];
  entry.activityHistory.push(sample);
  if (entry.activityHistory.length > 100)
    entry.activityHistory = entry.activityHistory.slice(-100);
  activityCh.publish(entry.info.id, sample);
}

function createWorker() {
  const id = String(nextId++);
  const name = names[(nextId - 2) % names.length]!;
  const intervalMs = 500 + Math.floor(Math.random() * 1500);
  const entry: WorkerEntry = {
    info: { id, name, createdAt: Date.now() },
    meta: { name, tickCount: 0, status: "running", intervalMs },
    activityHistory: [],
    timer: null,
  };
  entry.timer = setInterval(() => tick(entry), intervalMs);
  workers.set(id, entry);
  workerList.publish(listWorkers());
  console.log(`+ worker ${id} (${name}) every ${intervalMs}ms`);
  return entry.info;
}

function require(id: WorkerId): WorkerEntry {
  const entry = workers.get(id);
  if (!entry) throw new Error(`worker ${id} not found`);
  return entry;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const t = implement(contract);

const router = t.router({
  worker: {
    list: t.worker.list.handler(async function* ({ signal }) {
      yield* liveQuery(
        (s) => workerList.subscribe(s),
        () => listWorkers(),
      )(signal);
    }),

    onMetadataChange: t.worker.onMetadataChange.handler(async function* ({
      input,
      signal,
    }) {
      const entry = require(input.id);
      yield* liveQuery(
        (s) => metadataCh.subscribe(input.id, s),
        () => ({ ...entry.meta }),
      )(signal);
    }),

    onActivityChange: t.worker.onActivityChange.handler(async function* ({
      input,
      signal,
    }) {
      const entry = require(input.id);
      yield* liveQueryMany(
        (s) => activityCh.subscribe(input.id, s),
        () => [...entry.activityHistory],
      )(signal);
    }),

    attach: t.worker.attach.handler(async function* ({ input, signal }) {
      require(input.id);
      for await (const msg of ticksCh.subscribe(input.id, signal)) yield msg;
    }),

    create: t.worker.create.handler(async () => createWorker()),

    kill: t.worker.kill.handler(async ({ input }) => {
      const entry = require(input.id);
      if (entry.timer) clearInterval(entry.timer);
      workers.delete(input.id);
      workerList.publish(listWorkers());
      console.log(`- worker ${input.id} (${entry.info.name})`);
    }),

    toggle: t.worker.toggle.handler(async ({ input }) => {
      const entry = require(input.id);
      if (entry.meta.status === "running") {
        if (entry.timer) clearInterval(entry.timer);
        entry.timer = null;
        entry.meta = { ...entry.meta, status: "paused" };
        activityCh.publish(input.id, [Date.now(), false]);
      } else {
        entry.meta = { ...entry.meta, status: "running" };
        entry.timer = setInterval(() => tick(entry), entry.meta.intervalMs);
        activityCh.publish(input.id, [Date.now(), true]);
      }
      metadataCh.publish(input.id, entry.meta);
    }),
  },
});

// ---------------------------------------------------------------------------
// WebSocket server (same pattern as Kolu's server/src/index.ts)
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

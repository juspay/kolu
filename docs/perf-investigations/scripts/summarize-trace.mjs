#!/usr/bin/env node
import fs from "node:fs";

function usage() {
  console.error("usage: summarize-trace.mjs <trace.json> [--focus-pid <pid>] [--out <path>]");
  process.exit(2);
}

const tracePath = process.argv[2];
if (!tracePath) usage();

let focusPid = null;
let out = null;
for (let i = 3; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--focus-pid") focusPid = Number(process.argv[++i]);
  else if (arg === "--out") out = process.argv[++i];
  else usage();
}

const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));
const events = Array.isArray(trace) ? trace : trace.traceEvents;
if (!Array.isArray(events)) throw new Error(`no traceEvents array in ${tracePath}`);

const threadName = new Map();
const processName = new Map();
let minTs = Infinity;
let maxTs = -Infinity;

for (const event of events) {
  if (event.ph !== "M" && typeof event.ts === "number") {
    minTs = Math.min(minTs, event.ts);
    maxTs = Math.max(maxTs, event.ts + (event.dur ?? 0));
  }
  if (event.ph === "M" && event.name === "thread_name" && event.args?.name) {
    threadName.set(`${event.pid}:${event.tid}`, event.args.name);
  }
  if (event.ph === "M" && event.name === "process_name" && event.args?.name) {
    processName.set(event.pid, event.args.name);
  }
}

const traceWallMs = (maxTs - minTs) / 1000;
const busyByThread = new Map();
const eventByThread = new Map();
const interestingNames = new Set([
  "AnimationFrame",
  "BeginFrame",
  "BeginMainThreadFrame",
  "CompositeLayers",
  "EvaluateScript",
  "EventDispatch",
  "FireAnimationFrame",
  "FunctionCall",
  "HitTest",
  "InvalidateLayout",
  "Layout",
  "Layerize",
  "Paint",
  "PrePaint",
  "RasterTask",
  "RequestAnimationFrame",
  "RunTask",
  "ScheduleStyleRecalculation",
  "TimerFire",
  "UpdateLayoutTree",
  "UpdateLayerTree",
]);

function threadKey(event) {
  return `${event.pid}:${event.tid}`;
}

function add(map, key, us) {
  map.set(key, (map.get(key) ?? 0) + us);
}

function addEvent(thread, name, us) {
  if (!eventByThread.has(thread)) eventByThread.set(thread, new Map());
  add(eventByThread.get(thread), name, us);
}

let paintCount = 0;
let beginFrameCount = 0;

for (const event of events) {
  if (event.name === "Paint") paintCount += 1;
  if (event.name === "BeginFrame" || event.name === "BeginMainThreadFrame") {
    beginFrameCount += 1;
  }
  if (event.ph !== "X" || typeof event.dur !== "number") continue;
  const key = threadKey(event);
  if (event.name === "RunTask") add(busyByThread, key, event.dur);
  if (interestingNames.has(event.name)) addEvent(key, event.name, event.dur);
}

function roundMs(us) {
  return Math.round((us / 1000) * 10) / 10;
}

function pct(ms) {
  return traceWallMs > 0 ? Math.round((ms / traceWallMs) * 1000) / 10 : 0;
}

function threadRecord([key, totalUs]) {
  const [pidText, tidText] = key.split(":");
  const pid = Number(pidText);
  const tid = Number(tidText);
  const name = threadName.get(key) ?? `tid:${tid}`;
  const ms = roundMs(totalUs);
  const breakdown = [...(eventByThread.get(key) ?? new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([event, us]) => ({ event, ms: roundMs(us) }));
  return {
    key,
    pid,
    tid,
    process: processName.get(pid) ?? null,
    name,
    ms,
    cpuPercentOneCore: pct(ms),
    breakdown,
  };
}

const topThreads = [...busyByThread.entries()]
  .map(threadRecord)
  .sort((a, b) => b.ms - a.ms);

const rendererMainThreads = topThreads.filter((thread) => thread.name === "CrRendererMain");
const focusRenderer =
  (focusPid && rendererMainThreads.find((thread) => thread.pid === focusPid)) ??
  rendererMainThreads[0] ??
  null;
const rendererAll = topThreads.filter((thread) => thread.pid === focusRenderer?.pid);
const gpuThreads = topThreads.filter((thread) => thread.process === "GPU Process");

const summary = {
  tracePath,
  traceWallMs: Math.round(traceWallMs * 10) / 10,
  focusPid,
  inferredRendererPid: focusRenderer?.pid ?? null,
  rendererMain: focusRenderer,
  rendererAllMs: Math.round(rendererAll.reduce((sum, thread) => sum + thread.ms, 0) * 10) / 10,
  rendererAllCpuPercentOneCore: pct(rendererAll.reduce((sum, thread) => sum + thread.ms, 0)),
  gpuAllMs: Math.round(gpuThreads.reduce((sum, thread) => sum + thread.ms, 0) * 10) / 10,
  gpuAllCpuPercentOneCore: pct(gpuThreads.reduce((sum, thread) => sum + thread.ms, 0)),
  paintCount,
  beginFrameCount,
  topThreads: topThreads.slice(0, 20),
};

const json = JSON.stringify(summary, null, 2);
if (out) fs.writeFileSync(out, `${json}\n`);
else console.log(json);

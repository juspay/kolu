#!/usr/bin/env node
/* Headless-Chrome CDP tracer. Connects to a Chrome already listening on
 * --remote-debugging-port, navigates to a URL, records a fixed IDLE window
 * (no interaction), and aggregates main-thread / compositor / raster busy time
 * plus a breakdown by rendering event. The headline metric is CrRendererMain
 * busy time during idle — the GPU-independent "CPU spinning" number.
 *
 *   node trace.js <url> <idleMs> <port> <tag>
 */
const CDP = require("chrome-remote-interface");

async function main() {
  const url = process.argv[2];
  const idleMs = parseInt(process.argv[3] || "6000", 10);
  const port = parseInt(process.argv[4] || "9222", 10);
  const tag = process.argv[5] || "scene";

  const client = await CDP({ port });
  const { Page, Tracing } = client;
  await Page.enable();
  await Page.navigate({ url });
  await Page.loadEventFired();
  // Let layout/first paint settle before the measurement window opens.
  await sleep(1500);

  const events = [];
  Tracing.dataCollected(({ value }) => {
    for (const e of value) events.push(e);
  });

  await Tracing.start({
    transferMode: "ReportEvents",
    traceConfig: {
      recordMode: "recordContinuously",
      includedCategories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "blink.user_timing",
        "__metadata",
      ],
    },
  });

  // Pure idle window: we do nothing — only the CSS animations run.
  await sleep(idleMs);

  const complete = Tracing.tracingComplete();
  await Tracing.end();
  await complete;
  await client.close();

  // ── Aggregate ────────────────────────────────────────────────────────────
  // Map tid -> thread name from metadata events.
  const threadName = {};
  for (const e of events) {
    if (e.name === "thread_name" && e.args && e.args.name) {
      threadName[`${e.pid}/${e.tid}`] = e.args.name;
    }
  }

  // Top-level RunTask.dur summed per thread = total busy time on that thread.
  const busyByThread = {};
  // Self-ish breakdown by rendering event name (these nest, so treat as
  // "inclusive time spent in" — indicative of where main-thread time goes).
  const byEvent = {};
  let paintCount = 0;
  let beginFrameCount = 0;

  for (const e of events) {
    if (e.ph !== "X" || typeof e.dur !== "number") continue;
    const tname = threadName[`${e.pid}/${e.tid}`] || `tid:${e.tid}`;
    if (e.name === "RunTask") {
      busyByThread[tname] = (busyByThread[tname] || 0) + e.dur;
    }
    // Rendering-pipeline events (mostly on CrRendererMain).
    if (
      [
        "UpdateLayoutTree", // style recalc
        "Layout",
        "Paint",
        "PrePaint",
        "Layerize",
        "UpdateLayerTree",
        "CompositeLayers",
        "HitTest",
        "ScheduleStyleRecalculation",
        "ParseAuthorStyleSheet",
      ].includes(e.name)
    ) {
      if (!byEvent[e.name]) byEvent[e.name] = { totalUs: 0, count: 0 };
      byEvent[e.name].totalUs += e.dur;
      byEvent[e.name].count += 1;
    }
    if (e.name === "Paint") paintCount++;
  }
  for (const e of events) {
    if (e.name === "BeginFrame" || e.name === "BeginMainThreadFrame") beginFrameCount++;
  }

  // Round to ms for readability.
  const ms = (us) => Math.round(us / 100) / 10;
  const busyMs = {};
  for (const [k, v] of Object.entries(busyByThread)) busyMs[k] = ms(v);
  const eventMs = {};
  for (const [k, v] of Object.entries(byEvent))
    eventMs[k] = { ms: ms(v.totalUs), count: v.count };

  const mainBusy = busyMs["CrRendererMain"] || 0;
  const compositorBusy = busyMs["Compositor"] || 0;
  let rasterBusy = 0;
  for (const [k, v] of Object.entries(busyMs))
    if (/Raster|Compositor.*Worker|ThreadPoolForeground/i.test(k)) rasterBusy += v;

  const summary = {
    tag,
    url,
    idleMs,
    totalTraceEvents: events.length,
    mainThreadBusyMs: mainBusy,
    mainThreadBusyPct: Math.round((mainBusy / idleMs) * 1000) / 10,
    compositorBusyMs: compositorBusy,
    rasterBusyMs: Math.round(rasterBusy * 10) / 10,
    paintEventCount: paintCount,
    beginFrameCount,
    busyByThreadMs: busyMs,
    mainThreadEventBreakdown: eventMs,
  };
  console.log(JSON.stringify(summary, null, 2));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

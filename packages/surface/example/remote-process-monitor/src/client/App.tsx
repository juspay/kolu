/**
 * Remote process monitor — htop-flavoured single-page UI.
 *
 * Header strip = host + connection chip + live process count + load /
 * mem / uptime / OS, with a usage bar across the top.
 * Body = process table sorted by descending CPU% (click headers to
 * re-sort by user / mem / pid); a search box above the table filters
 * by PID, user, or command substring.
 *
 * The "connecting overlay" exhibits row 4 of the falsifiability table:
 * the parent's `connection` cell yields its current value synchronously
 * on subscribe — the overlay attaches before `connect()` returns and
 * still sees the initial `state === "connecting"` (or `"copying"`).
 */

import type { SurfaceHealth } from "@kolu/surface/solid";
import { HostStatusPip } from "@kolu/surface/solid/HostStatusPip";
import { SurfaceGate } from "@kolu/surface/solid/SurfaceGate";
import { type Accessor, createMemo, createSignal, For, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
  type CoreId,
  type CpuCore,
  DEFAULT_CONNECTION,
  DEFAULT_SYSTEM,
  type Pid,
  type Process,
} from "../common/surface";
import { app } from "./wire";

type SortKey = "cpu" | "mem" | "pid" | "user";

export default function App() {
  // System cell: snapshot-then-delta of OS metrics from the remote
  // agent. Server authority — the parent forwards the agent's reads.
  const system = app.cells.system.use({});
  // Connection cell: snapshot-then-delta of the parent-to-agent link
  // lifecycle. Independent of `system` — the link can be "copying" or
  // "disconnected" while `system` still holds the last good snapshot.
  // The overlay attaches before `connect()` returns and sees the
  // initial `connecting` state (R-1.5 falsifiability row 4).
  const connection = app.cells.connection.use({});

  // Processes table — driven by the bulk `processesSnapshot` stream,
  // NOT the per-key `processes` collection. For a 600+ row htop view,
  // N+1 per-key WS subscribes drip rows one at a time even over local
  // WS; one snapshot frame lands the whole table at once. The framework
  // collection stays available on the surface for small-N use cases
  // (R-2's `terminalMetadata` is the canonical fit — ~3-20 keys, where
  // per-key reactivity is exactly what you want).
  const [processes, setProcesses] = createStore<Record<Pid, Process>>({});
  // Leak A: this bulk table is a RAW streaming RPC (not a framework Cell/
  // Collection/Stream), so it owns its loop. `app.rawStream` is the STRUCTURAL
  // path — it can't bypass `app.health()`: it owns the `pending`/`error`, enrols
  // them, runs the loop self-clearing on each frame, and aborts on cleanup. So a
  // snapshot-stream failure surfaces in the one health FACT (closing the
  // `<SurfaceGate>` below) instead of a private `console.error` nobody sees — and
  // `rawStream` THROWS if it were ever driven outside this component owner, so
  // forgetting to enrol isn't possible, not just discouraged.
  app.rawStream(
    "processesSnapshot",
    app.rpc.surface.processesSnapshot.get,
    {},
    {
      onItem: (msg) => {
        if (msg.kind === "snapshot") {
          const next: Record<Pid, Process> = {};
          for (const [pid, value] of msg.entries) next[pid] = value;
          setProcesses(reconcile(next));
        } else {
          for (const [pid, value] of msg.upserts) setProcesses(pid, value);
          for (const pid of msg.removes) setProcesses(pid, undefined!);
        }
      },
    },
  );

  const [filter, setFilter] = createSignal("");
  const [sortKey, setSortKey] = createSignal<SortKey>("cpu");

  const currentSystem = createMemo(() => system.value() ?? DEFAULT_SYSTEM);
  const currentConnection = createMemo(
    () => connection.value() ?? DEFAULT_CONNECTION,
  );

  const allPids = createMemo<Pid[]>(() =>
    Object.keys(processes).map((k) => Number(k)),
  );

  // CPU cores — Collection<K,T> via the framework's per-key hook.
  // Small-N (typical 4-32), so per-key fan-out is exactly the right
  // shape; each core gets its own reactive subscription, the strip
  // updates per-cell independently.
  // No `onError`: each per-core sub is enrolled in `app.health()` (the framework
  // does it), so a core's failure surfaces through the one health FACT and the
  // `<SurfaceGate>` below — not a private `console.error`.
  const cores = app.collections.cpuCores.use();
  const coreIds = createMemo<CoreId[]>(() =>
    [...cores.keys()].sort((a, b) => a - b),
  );

  /** Pre-resolved {pid, proc} entries — sorted, filtered, ready to render.
   *  Reads run through the SolidJS Store's per-key reactive proxy so
   *  only changed PIDs invalidate the memo's inputs. */
  const visibleRows = createMemo(() => {
    const q = filter().trim().toLowerCase();
    const rows: Array<{ pid: Pid; proc: Process }> = [];
    for (const pid of allPids()) {
      const proc = processes[pid];
      if (proc === undefined) continue;
      if (
        q.length > 0 &&
        !String(pid).includes(q) &&
        !proc.user.toLowerCase().includes(q) &&
        !proc.command.toLowerCase().includes(q)
      )
        continue;
      rows.push({ pid, proc });
    }
    const cmp = comparator(sortKey());
    rows.sort(cmp);
    return rows;
  });

  const killProcess = async (pid: number, signal: "TERM" | "KILL") => {
    try {
      await app.rpc.surface.process.kill({ pid, signal });
    } catch (err) {
      console.error(`kill ${pid} ${signal} failed`, err);
    }
  };

  return (
    <div class="min-h-screen bg-gray-50 p-4 font-mono text-sm dark:bg-gray-950">
      <div class="mx-auto max-w-6xl overflow-hidden rounded border border-gray-300 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <Header
          system={currentSystem()}
          connection={currentConnection()}
          health={app.health}
          count={allPids().length}
        />
        {/* The body is ready when the agent link is CONNECTED (domain policy —
            the `connection` cell's lifecycle state) AND no subscription is
            erroring (the framework health FACT, which now includes the enrolled
            `processesSnapshot` stream and every per-core sub). `<SurfaceGate>`
            owns that policy via its `ready` override; the `fallback` shows the
            connecting overlay, surfacing a subscription error if one is what's
            holding the gate closed. Don't gate on `pending` — the original
            example never blocked the table on per-key first-frames, and a single
            slow core shouldn't blank the whole view. */}
        <SurfaceGate
          health={app.health}
          ready={(h) =>
            h.live &&
            currentConnection().state === "connected" &&
            !h.subs.some((s) => s.error)
          }
          fallback={(h) => (
            <ConnectingOverlay
              state={h().live ? currentConnection().state : "connecting"}
              error={h().subs.find((s) => s.error)?.error?.message}
            />
          )}
        >
          <CpuStrip coreIds={coreIds()} getCore={(id) => cores.byKey(id)?.()} />
          <FilterBar
            filter={filter()}
            onFilter={setFilter}
            visible={visibleRows().length}
            total={allPids().length}
          />
          <ProcessTable
            rows={visibleRows()}
            sortKey={sortKey()}
            onSort={setSortKey}
            onKill={killProcess}
          />
        </SurfaceGate>
      </div>
    </div>
  );
}

function comparator(key: SortKey): (a: Row, b: Row) => number {
  if (key === "cpu")
    return (a, b) => b.proc.cpuPct - a.proc.cpuPct || a.pid - b.pid;
  if (key === "mem")
    return (a, b) => b.proc.memPct - a.proc.memPct || a.pid - b.pid;
  if (key === "user")
    return (a, b) => a.proc.user.localeCompare(b.proc.user) || a.pid - b.pid;
  return (a, b) => a.pid - b.pid;
}

type Row = { pid: Pid; proc: Process };

function Header(props: {
  system: ReturnType<() => typeof DEFAULT_SYSTEM>;
  connection: ReturnType<() => typeof DEFAULT_CONNECTION>;
  health: Accessor<SurfaceHealth>;
  count: number;
}) {
  const memPct = () => {
    const total = props.system.memTotal;
    return total > 0 ? (100 * props.system.memUsed) / total : 0;
  };
  const memGb = () => ({
    used: (props.system.memUsed / 1e9).toFixed(1),
    total: (props.system.memTotal / 1e9).toFixed(1),
  });
  const uptimeFmt = () => {
    const u = props.system.uptime;
    const d = Math.floor(u / 86400);
    const h = Math.floor((u % 86400) / 3600);
    const m = Math.floor((u % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };
  return (
    <div class="border-b border-gray-200 dark:border-gray-800">
      <UsageBar pct={memPct()} />
      <div class="flex items-center justify-between px-4 py-2">
        <div class="flex items-center gap-3">
          <span class="font-semibold">remote-process-monitor</span>
          <span class="text-gray-400">·</span>
          <span>
            <span class="text-gray-500">host:</span>{" "}
            <span class="font-semibold">{props.system.hostname || "—"}</span>
          </span>
          <span class="flex items-center gap-1.5 text-xs">
            {/* The connection dot is the framework `<HostStatusPip>` — its GREEN
                comes ONLY from the health FACT (the same `ready` the gate below
                uses), so a stale `connected` cell over a dead link can't paint it.
                The state WORD stays a neutral label, never a raw-state green. */}
            <HostStatusPip
              health={props.health}
              ready={(h) =>
                h.live &&
                props.connection.state === "connected" &&
                !h.subs.some((s) => s.error)
              }
              readyColor="#10b981"
              notReadyTone={() =>
                props.connection.state === "failed" ? "#ef4444" : "#f59e0b"
              }
              pulse={props.connection.state !== "failed"}
              title={props.connection.state}
            />
            <span class="text-gray-500">{props.connection.state}</span>
          </span>
          <span class="text-gray-500">·</span>
          <span class="text-gray-500">
            {props.count} {props.count === 1 ? "process" : "processes"}
          </span>
        </div>
        <span class="text-xs text-gray-500">poll: every 2s</span>
      </div>
      <div class="flex flex-wrap gap-4 border-t border-gray-100 px-4 py-1.5 text-xs text-gray-700 dark:border-gray-800 dark:text-gray-300">
        <span>
          load{" "}
          <span class="font-semibold">
            {props.system.loadAvg[0].toFixed(2)}
          </span>{" "}
          <span class="text-gray-400">
            {props.system.loadAvg[1].toFixed(2)}
          </span>{" "}
          <span class="text-gray-400">
            {props.system.loadAvg[2].toFixed(2)}
          </span>
        </span>
        <span>
          mem <span class="font-semibold">{memGb().used}</span>
          <span class="text-gray-400">/{memGb().total} GB</span>
          <span class="ml-1 text-gray-400">({memPct().toFixed(0)}%)</span>
        </span>
        <span>
          uptime <span class="font-semibold">{uptimeFmt()}</span>
        </span>
        <span>
          os <span class="font-semibold">{props.system.os}</span>
        </span>
      </div>
    </div>
  );
}

/** Thin top bar showing total memory usage at a glance. */
function UsageBar(props: { pct: number }) {
  const colour = () => {
    if (props.pct > 85) return "bg-red-500";
    if (props.pct > 65) return "bg-amber-500";
    return "bg-emerald-500";
  };
  return (
    <div class="h-1 w-full bg-gray-100 dark:bg-gray-800">
      <div
        class={`h-full transition-all ${colour()}`}
        style={{ width: `${Math.min(100, props.pct).toFixed(1)}%` }}
      />
    </div>
  );
}

function FilterBar(props: {
  filter: string;
  onFilter: (q: string) => void;
  visible: number;
  total: number;
}) {
  return (
    <div class="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
      <input
        type="text"
        placeholder="filter pid / user / command"
        class="w-64 rounded border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs focus:border-emerald-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
        value={props.filter}
        onInput={(e) => props.onFilter(e.currentTarget.value)}
      />
      <span class="text-xs text-gray-500">
        showing {props.visible} of {props.total}
      </span>
    </div>
  );
}

function ConnectingOverlay(props: { state: string; error?: string }) {
  // A live subscription error (the gate held closed while CONNECTED) wins the
  // headline — it's the actionable failure; otherwise show the link-lifecycle
  // line keyed off the `connection` cell's state.
  const msg = () =>
    props.error ??
    {
      copying: "Copying agent to remote…",
      connecting: "Connecting…",
      disconnected: "Reconnecting…",
      failed: "Connection failed — gave up retrying.",
    }[props.state] ??
    "Initializing…";
  return (
    <div class="px-4 py-12 text-center text-gray-600 dark:text-gray-400">
      <div class="mb-2 text-lg">{msg()}</div>
      <div class="text-xs">
        First connect provisions the agent closure via <code>nix copy</code>.
        Subsequent connects reuse it.
      </div>
    </div>
  );
}

function ProcessTable(props: {
  rows: readonly Row[];
  sortKey: SortKey;
  onSort: (k: SortKey) => void;
  onKill: (pid: number, signal: "TERM" | "KILL") => void;
}) {
  return (
    <div class="max-h-[70vh] overflow-y-auto">
      <table class="w-full">
        <thead class="sticky top-0 bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900 dark:text-gray-400">
          <tr class="border-b border-gray-200 dark:border-gray-800">
            <SortableTh
              label="PID"
              align="right"
              active={props.sortKey === "pid"}
              onClick={() => props.onSort("pid")}
            />
            <SortableTh
              label="USER"
              align="left"
              active={props.sortKey === "user"}
              onClick={() => props.onSort("user")}
            />
            <SortableTh
              label="CPU%"
              align="right"
              active={props.sortKey === "cpu"}
              onClick={() => props.onSort("cpu")}
            />
            <SortableTh
              label="MEM%"
              align="right"
              active={props.sortKey === "mem"}
              onClick={() => props.onSort("mem")}
            />
            <th class="px-3 py-1.5 text-left">COMMAND</th>
            <th class="px-3 py-1.5 text-right" />
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr class="border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-gray-800/40">
                <td class="px-3 py-0.5 text-right tabular-nums">{row.pid}</td>
                <td class="px-3 py-0.5 text-left">{row.proc.user}</td>
                <td
                  class={`px-3 py-0.5 text-right tabular-nums ${pctClass(row.proc.cpuPct)}`}
                >
                  {row.proc.cpuPct.toFixed(1)}
                </td>
                <td
                  class={`px-3 py-0.5 text-right tabular-nums ${pctClass(row.proc.memPct)}`}
                >
                  {row.proc.memPct.toFixed(1)}
                </td>
                <td class="max-w-md truncate px-3 py-0.5 text-left text-gray-700 dark:text-gray-300">
                  {row.proc.command}
                </td>
                <td class="px-3 py-0.5 text-right">
                  <button
                    type="button"
                    class="rounded border border-gray-300 px-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-gray-700 dark:text-red-400 dark:hover:bg-red-950/40"
                    onClick={() => props.onKill(row.pid, "TERM")}
                    title="Send SIGTERM"
                  >
                    kill
                  </button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

function SortableTh(props: {
  label: string;
  align: "left" | "right";
  active: boolean;
  onClick: () => void;
}) {
  const alignClass = () =>
    props.align === "right" ? "text-right" : "text-left";
  return (
    <th class={`px-3 py-1.5 ${alignClass()}`}>
      <button
        type="button"
        class={`cursor-pointer ${props.active ? "text-emerald-600 dark:text-emerald-400" : ""}`}
        onClick={props.onClick}
      >
        {props.label}
        {props.active ? " ▾" : ""}
      </button>
    </th>
  );
}

/** htop-ish band: green low / amber mid / red high. */
function pctClass(pct: number): string {
  if (pct > 50) return "font-semibold text-red-500";
  if (pct > 10) return "text-amber-500";
  return "text-gray-700 dark:text-gray-400";
}

/** Per-core CPU strip — one cell per core, each its own
 *  `Collection<K,T>` per-key subscription. Re-renders only the cells
 *  whose core changed (Solid `<For keyed>` semantics + per-key
 *  reactive identity from `app.collections.cpuCores.use()`). */
function CpuStrip(props: {
  coreIds: readonly CoreId[];
  getCore: (id: CoreId) => CpuCore | undefined;
}) {
  return (
    <Show when={props.coreIds.length > 0}>
      <div class="border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <div class="mb-1 text-xs uppercase tracking-wide text-gray-500">
          CPU cores ({props.coreIds.length})
        </div>
        <div class="grid grid-cols-4 gap-2 md:grid-cols-8">
          <For each={props.coreIds}>
            {(id) => <CpuCoreCell id={id} get={() => props.getCore(id)} />}
          </For>
        </div>
      </div>
    </Show>
  );
}

function CpuCoreCell(props: { id: CoreId; get: () => CpuCore | undefined }) {
  const core = createMemo(() => props.get());
  const pct = () => core()?.usagePct ?? 0;
  const barColor = createMemo(() => {
    const p = pct();
    if (p > 80) return "bg-red-500";
    if (p > 50) return "bg-amber-500";
    return "bg-emerald-500";
  });
  return (
    <div class="flex items-center gap-1 text-xs">
      <span class="w-6 shrink-0 text-gray-500 tabular-nums">c{props.id}</span>
      <div class="h-2 flex-1 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
        <div
          class={`h-full transition-all ${barColor()}`}
          style={{ width: `${Math.min(100, pct()).toFixed(1)}%` }}
        />
      </div>
      <span class="w-10 shrink-0 text-right tabular-nums text-gray-700 dark:text-gray-300">
        {pct().toFixed(0)}%
      </span>
    </div>
  );
}

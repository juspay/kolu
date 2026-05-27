/**
 * Remote process monitor — single-page UI.
 *
 * Layout (mirroring plan §R-1.5):
 *
 *   ┌─ Remote process monitor ───────────────────────────────────────────┐
 *   │ Host: prod-web-01  ● connected     [ Disconnect ]   poll: every 2s │
 *   │ Load: 1.42 / 1.18 / 0.97   Mem: 6.2 / 16.0 GB   Uptime: 14d 3h     │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │ PID    USER    CPU%   MEM%   COMMAND                               │
 *   │ …                                                                  │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * The "connecting overlay" exhibits row 4 of the falsifiability table:
 * the parent's `system` cell yields its current value synchronously on
 * subscribe — the overlay attaches before `connect()` returns and still
 * sees the initial `state === "connecting"` (or `"copying"`).
 */

import { createMemo, For, Show } from "solid-js";
import {
  DEFAULT_CONNECTION,
  DEFAULT_SYSTEM,
  type Pid,
} from "../common/surface";
import { app } from "./wire";

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

  // Processes collection. Per-key subscriptions are built via the
  // bound `keys` and `byKey` accessors.
  const processes = app.collections.processes.use({
    onError: (err) => console.error("processes subscription failed", err),
  });

  // Sort by descending CPU%, stable secondary by PID. Re-evaluates
  // whenever the key set changes; per-PID values aren't in the sort
  // path (the SolidJS reactive identity stays stable across CPU
  // jiggles).
  const sortedPids = createMemo<readonly Pid[]>(() => {
    const keys = processes.keys();
    return [...keys].sort((a, b) => a - b);
  });

  const killProcess = async (pid: number, signal: "TERM" | "KILL") => {
    try {
      await app.rpc.surface.process.kill({ pid, signal });
    } catch (err) {
      console.error(`kill ${pid} ${signal} failed`, err);
    }
  };

  const currentSystem = createMemo(() => system.value() ?? DEFAULT_SYSTEM);
  const currentConnection = createMemo(
    () => connection.value() ?? DEFAULT_CONNECTION,
  );

  return (
    <div class="min-h-screen p-4 font-mono text-sm">
      <div class="mx-auto max-w-5xl rounded border border-gray-400 dark:border-gray-700">
        <Header />
        <Show
          when={currentConnection().state === "connected"}
          fallback={<ConnectingOverlay state={currentConnection().state} />}
        >
          <ProcessTable
            pids={sortedPids()}
            getProc={(pid) => processes.byKey(pid)?.()}
            onKill={killProcess}
          />
        </Show>
      </div>
    </div>
  );

  function Header() {
    const stateColor = createMemo(() => {
      const st = currentConnection().state;
      if (st === "connected") return "text-green-600 dark:text-green-400";
      if (st === "disconnected") return "text-red-600 dark:text-red-400";
      return "text-amber-600 dark:text-amber-400";
    });
    const memGb = createMemo(() => ({
      used: (currentSystem().memUsed / 1e9).toFixed(1),
      total: (currentSystem().memTotal / 1e9).toFixed(1),
    }));
    const uptimeFmt = createMemo(() => {
      const u = currentSystem().uptime;
      const d = Math.floor(u / 86400);
      const h = Math.floor((u % 86400) / 3600);
      const m = Math.floor((u % 3600) / 60);
      if (d > 0) return `${d}d ${h}h`;
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    });
    return (
      <div class="border-b border-gray-400 px-3 py-2 dark:border-gray-700">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="font-semibold">Remote process monitor</span>
            <span>·</span>
            <span>
              Host:{" "}
              <span class="font-semibold">
                {currentSystem().hostname || "—"}
              </span>
            </span>
            <span class={stateColor()}>● {currentConnection().state}</span>
          </div>
          <div class="text-xs text-gray-600 dark:text-gray-400">
            poll: every 2s
          </div>
        </div>
        <div class="mt-1 flex gap-4 text-xs text-gray-700 dark:text-gray-300">
          <span>
            Load: {currentSystem().loadAvg[0].toFixed(2)} /{" "}
            {currentSystem().loadAvg[1].toFixed(2)} /{" "}
            {currentSystem().loadAvg[2].toFixed(2)}
          </span>
          <span>
            Mem: {memGb().used} / {memGb().total} GB
          </span>
          <span>Uptime: {uptimeFmt()}</span>
          <span>OS: {currentSystem().os}</span>
        </div>
      </div>
    );
  }
}

function ConnectingOverlay(props: { state: string }) {
  const msg = () => {
    if (props.state === "copying") return "Copying agent to remote…";
    if (props.state === "connecting") return "Connecting…";
    if (props.state === "disconnected") return "Disconnected. Retrying…";
    return "Initializing…";
  };
  return (
    <div class="px-4 py-8 text-center text-gray-600 dark:text-gray-400">
      <div class="mb-2 text-lg">{msg()}</div>
      <div class="text-xs">
        First connect provisions the agent closure via <code>nix copy</code>.
        Subsequent connects reuse it.
      </div>
    </div>
  );
}

function ProcessTable(props: {
  pids: readonly number[];
  getProc: (
    pid: number,
  ) =>
    | { user: string; cpuPct: number; memPct: number; command: string }
    | undefined;
  onKill: (pid: number, signal: "TERM" | "KILL") => void;
}) {
  return (
    <table class="w-full">
      <thead>
        <tr class="border-b border-gray-300 text-xs uppercase text-gray-600 dark:border-gray-700 dark:text-gray-400">
          <th class="px-3 py-1 text-left">PID</th>
          <th class="px-3 py-1 text-left">User</th>
          <th class="px-3 py-1 text-right">CPU%</th>
          <th class="px-3 py-1 text-right">Mem%</th>
          <th class="px-3 py-1 text-left">Command</th>
          <th class="px-3 py-1 text-right">Action</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.pids}>
          {(pid) => {
            const proc = createMemo(() => props.getProc(pid));
            return (
              <Show when={proc()}>
                {(p) => (
                  <tr class="border-b border-gray-200 dark:border-gray-800">
                    <td class="px-3 py-1 text-left tabular-nums">{pid}</td>
                    <td class="px-3 py-1 text-left">{p().user}</td>
                    <td class="px-3 py-1 text-right tabular-nums">
                      {p().cpuPct.toFixed(1)}
                    </td>
                    <td class="px-3 py-1 text-right tabular-nums">
                      {p().memPct.toFixed(1)}
                    </td>
                    <td class="truncate px-3 py-1 text-left">{p().command}</td>
                    <td class="px-3 py-1 text-right">
                      <button
                        type="button"
                        class="rounded border border-gray-400 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 dark:border-gray-600 dark:text-red-400 dark:hover:bg-red-950"
                        onClick={() => props.onKill(pid, "TERM")}
                        title="Send SIGTERM"
                      >
                        kill
                      </button>
                    </td>
                  </tr>
                )}
              </Show>
            );
          }}
        </For>
      </tbody>
    </table>
  );
}

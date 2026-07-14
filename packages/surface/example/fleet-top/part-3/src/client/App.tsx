/**
 * fleet-top part 3 — a mini-drishti: N boxes as chips, one selected canvas.
 *
 *   - `app.entries.use().keys()` → the chip strip; each chip shows
 *     `app.entry(host).state().kind` (warming / connected / failed). One dead
 *     box = one honest `failed` chip, the rest keep serving.
 *   - `app.useEntry(activeHost)` → the canvas re-keys on switch; the old host's
 *     subscriptions dispose and the new host's populate synchronously.
 */

import { createMemo, createSignal, For, Show } from "solid-js";
import type { Pid } from "../common/surface";
import { app } from "./wire";

export default function App() {
  // #region mapped
  const entries = app.entries.use();
  const [activeHost, setActiveHost] = createSignal<string>(
    entries.keys()[0] ?? "localhost",
  );
  const active = app.useEntry(activeHost);

  const load = active.cells.load.use();
  const memory = active.cells.memory.use();
  const processes = active.collections.processes.use();

  const rows = createMemo<Pid[]>(() =>
    [...processes.keys()].sort(
      (a, b) =>
        (processes.byKey(b)?.()?.cpuPct ?? 0) -
        (processes.byKey(a)?.()?.cpuPct ?? 0),
    ),
  );

  // Declared procedures ride `entry.procedures.<ns>.<verb>` — bound and typed from
  // the entry spec, NO cast (the narrow `procedures` map dodges the TS2590 union
  // overflow the full `entry.rpc` contract client trips on a generic map).
  const kill = async (pid: Pid): Promise<void> => {
    await active.procedures.process.kill({ pid, signal: "TERM" });
  };
  // #endregion

  const gb = (bytes: number): string => (bytes / 1e9).toFixed(1);

  return (
    <main class="top">
      <header class="bar">
        <h1>fleet-top</h1>
        <div class="chips">
          <For each={entries.keys()}>
            {(host) => {
              const status = () => app.entry(host).state();
              return (
                <button
                  type="button"
                  class="chip"
                  classList={{
                    active: host === activeHost(),
                    [status().kind]: true,
                  }}
                  onClick={() => setActiveHost(host)}
                >
                  {host} · {status().kind}
                </button>
              );
            }}
          </For>
        </div>
      </header>

      <div class="bar">
        <Show
          when={load.value()}
          fallback={<span class="dim">connecting…</span>}
        >
          {(l) => (
            <span class="metric">
              load{" "}
              {l()
                .avg.map((n) => n.toFixed(2))
                .join(" ")}{" "}
              · {l().cores} cores
            </span>
          )}
        </Show>
        <Show when={memory.value()}>
          {(m) => (
            <span class="metric">
              mem {gb(m().used)} / {gb(m().total)} GB
            </span>
          )}
        </Show>
      </div>

      <table>
        <thead>
          <tr>
            <th>PID</th>
            <th>USER</th>
            <th>CPU%</th>
            <th>MEM%</th>
            <th>COMMAND</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <For
            each={rows()}
            fallback={
              <tr>
                <td colspan="6" class="dim">
                  no processes yet
                </td>
              </tr>
            }
          >
            {(pid) => {
              const proc = () => processes.byKey(pid)?.();
              return (
                <Show when={proc()}>
                  {(p) => (
                    <tr>
                      <td>{pid}</td>
                      <td>{p().user}</td>
                      <td>{p().cpuPct.toFixed(1)}</td>
                      <td>{p().memPct.toFixed(1)}</td>
                      <td class="cmd">{p().command}</td>
                      <td>
                        <button type="button" onClick={() => void kill(pid)}>
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
    </main>
  );
}

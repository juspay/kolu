/**
 * fleet-top part 1 — a live `top` in the browser, wired with the bound
 * `.use()` hooks.
 *
 *   - `app.cells.load.use()`        → the load-average header
 *   - `app.cells.memory.use()`      → the memory bar
 *   - `app.collections.processes.use()` → the process table (snapshot-then-delta)
 *   - `app.procedures.process.kill(...)` → the one mutation
 */

import { createMemo, For, Show } from "solid-js";
import type { Pid } from "../common/surface";
import { app } from "./wire";

export default function App() {
  // #region hooks
  const load = app.cells.load.use();
  const memory = app.cells.memory.use();
  const processes = app.collections.processes.use({
    onError: (err) => console.error("processes subscription failed", err),
  });

  // Busiest first — sort the live key set by the current cpu reading.
  const rows = createMemo<Pid[]>(() =>
    [...processes.keys()].sort(
      (a, b) =>
        (processes.byKey(b)?.()?.cpuPct ?? 0) -
        (processes.byKey(a)?.()?.cpuPct ?? 0),
    ),
  );

  const kill = async (pid: Pid): Promise<void> => {
    await app.procedures.process.kill({ pid, signal: "TERM" });
  };
  // #endregion

  const gb = (bytes: number): string => (bytes / 1e9).toFixed(1);

  return (
    <main class="top">
      <header class="bar">
        <h1>fleet-top</h1>
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
      </header>

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

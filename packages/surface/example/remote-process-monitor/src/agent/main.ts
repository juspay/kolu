/**
 * process-monitor-agent entrypoint.
 *
 * Modes:
 *   --stdio                   serve the surface over stdin/stdout (the
 *                             headline path; what `ssh $host $agent
 *                             --stdio` invokes).
 *   --broken-stdout-log       deliberately log a stray line to stdout
 *                             before any RPC, reproducing lesson #4.
 *                             The parent's client peer sees garbage and
 *                             surfaces a frame-parse failure rather than
 *                             hanging. Used by the demo's "deliberately
 *                             broken" smoke test; not for production.
 *   (no args)                 print usage to stderr and exit 1.
 *
 * The agent polls `proc` and `system` every `POLL_INTERVAL_MS` and
 * pushes deltas through the surface's typed `ctx` — the framework
 * mutates the snapshot AND publishes per-key updates in one call. New
 * subscribers see a full snapshot as their first yield
 * (snapshot-then-delta invariant) and per-PID upserts/removes
 * thereafter.
 *
 * **Stdout is the protocol channel.** All logging goes to fd 2
 * (`process.stderr.write`). The framework's `serveOverStdio` defensively
 * redirects `console.log` to stderr too, but this module avoids
 * `console.log` entirely for clarity. Lesson #4.
 */

import {
  implementSurface,
  inMemoryChannel,
  inMemoryStore,
} from "@kolu/surface/server";
import { serveOverStdio } from "@kolu/surface/peer-server";
import {
  DEFAULT_CONNECTION,
  type Pid,
  type Process,
  surface,
} from "../common/surface";
import { createProcReader } from "./proc";

const POLL_INTERVAL_MS = 2000;

function log(...args: unknown[]): void {
  process.stderr.write(`${args.map((a) => String(a)).join(" ")}\n`);
}

function usage(): never {
  process.stderr.write(
    [
      "process-monitor-agent — exposes /proc or sysctl as a typed @kolu/surface over stdio.",
      "",
      "Usage:",
      "  process-monitor-agent --stdio                # serve over stdin/stdout (normal mode)",
      "  process-monitor-agent --stdio --broken-stdout-log",
      "                                                # demo lesson #4 (stdout corruption)",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.includes("--stdio")) usage();
  const brokenStdoutLog = args.includes("--broken-stdout-log");

  const reader = createProcReader();
  log(`process-monitor-agent: os=${reader.os}, pid=${process.pid}`);

  const systemStore = inMemoryStore(await reader.readSystem());
  const processSnapshot = new Map<Pid, Process>();
  for (const [pid, value] of await reader.readProcesses())
    processSnapshot.set(pid, value);

  // Build the surface implementation. The `processes` collection's
  // `readAll` yields the current snapshot; `upsert`/`remove` are the
  // single in-process write seam (the poll loop calls
  // `fragment.ctx.collections.processes.upsert/remove`, which mutates
  // the snapshot AND publishes through the framework's keyed channels).
  const fragment = implementSurface(surface, {
    channel: <T>(_name: string) => inMemoryChannel<T>(),
    cells: {
      system: { store: systemStore },
      // `connection` lives in the shared surface so the browser can
      // subscribe via the framework's snapshot-then-delta. The agent
      // has no visibility into the parent↔agent link from the inside
      // (lesson #6 — the link's health is the *parent's* observation,
      // not the agent's), so the agent serves the default and the
      // parent overrides on its own surface implementation.
      connection: { store: inMemoryStore({ ...DEFAULT_CONNECTION }) },
    },
    collections: {
      processes: {
        readAll: () => processSnapshot,
        upsert: (key, value) => {
          processSnapshot.set(key, value);
        },
        remove: (key) => {
          processSnapshot.delete(key);
        },
      },
    },
    procedures: {
      process: {
        kill: async ({ input }) => {
          try {
            process.kill(input.pid, input.signal);
            return { ok: true };
          } catch (err) {
            log(
              `kill ${input.pid} ${input.signal} failed: ${(err as Error).message}`,
            );
            return { ok: false };
          }
        },
      },
    },
  });

  // Poll loop: refresh system + processes, diff against current
  // `processSnapshot`, push deltas through the framework's ctx (which
  // mutates the snapshot AND publishes to subscribers in one step).
  const tick = async (): Promise<void> => {
    try {
      const [nextSystem, nextProcesses] = await Promise.all([
        reader.readSystem(),
        reader.readProcesses(),
      ]);
      systemStore.set(nextSystem);
      for (const [pid, value] of nextProcesses) {
        const prev = processSnapshot.get(pid);
        if (
          prev === undefined ||
          prev.cpuPct !== value.cpuPct ||
          prev.memPct !== value.memPct ||
          prev.command !== value.command
        ) {
          fragment.ctx.collections.processes.upsert(pid, value);
        }
      }
      for (const pid of [...processSnapshot.keys()]) {
        if (!nextProcesses.has(pid))
          fragment.ctx.collections.processes.remove(pid);
      }
    } catch (err) {
      log(`tick error: ${(err as Error).message}`);
    }
  };
  const interval = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);

  // ── Lesson #4 (deliberately broken variant) ─────────────────────────
  if (brokenStdoutLog) {
    // Bypass console.log redirection — write directly to fd 1. This is
    // exactly the wire-corrupting bug `serveOverStdio` documents.
    process.stdout.write(
      "DEBUG: this line corrupts the protocol channel, see lesson #4\n",
    );
  }

  log("serving surface over stdio (read=stdin, write=stdout)");
  await serveOverStdio({
    router: fragment.router,
    onFirstRequest: () => log("first RPC received — link is live"),
  });
  clearInterval(interval);
  log("stdin closed — agent exiting");
}

main().catch((err) => {
  log(`fatal: ${(err as Error).message}\n${(err as Error).stack ?? ""}`);
  process.exit(1);
});

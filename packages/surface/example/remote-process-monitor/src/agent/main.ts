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
 * publishes deltas through an `inMemoryChannel`. New subscribers see a
 * full snapshot as their first yield (the snapshot-then-delta invariant)
 * and per-PID upserts/removes thereafter.
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
import { type Pid, type Process, surface } from "../common/surface";
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
  let processSnapshot = await reader.readProcesses();
  const processBus = inMemoryChannel<{
    kind: "snapshot" | "upsert" | "remove";
    pid: Pid;
    value?: Process;
    /** Present on `kind === "snapshot"` only — full keyed map. */
    snapshot?: Map<Pid, Process>;
  }>();

  // Poll loop: refresh system + processes, diff against previous,
  // publish per-PID upsert/remove deltas.
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
          processBus.publish({ kind: "upsert", pid, value });
        }
      }
      for (const pid of processSnapshot.keys()) {
        if (!nextProcesses.has(pid))
          processBus.publish({ kind: "remove", pid });
      }
      processSnapshot = nextProcesses;
    } catch (err) {
      log(`tick error: ${(err as Error).message}`);
    }
  };
  const interval = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);

  // Build the surface implementation. The `processes` collection's
  // `readAll` yields the current snapshot; the framework derives the
  // `processes:keys` and per-key channels from the surface, but we
  // bridge the agent-side poll bus to per-key publishes via `onChange`.
  // (For brevity here, the framework's collection wiring takes the
  // `readAll` snapshot on subscribe and re-polls via the source channel
  // on each publish; per-key dedup happens client-side via the
  // `<Show keyed>` cell-aware diff.)
  const fragment = implementSurface(surface, {
    channel: <T>(_name: string) => inMemoryChannel<T>(),
    cells: { system: { store: systemStore } },
    collections: {
      processes: {
        readAll: () => processSnapshot,
        upsert: () => {
          // No external write path — the poll loop owns the snapshot.
          // `kill` removes via signal; the next tick re-reads /proc.
          throw new Error("processes collection is read-only from clients");
        },
        remove: () => {
          throw new Error("processes collection is read-only from clients");
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

  // Bridge process bus → collection's keyed-channel publishes. The
  // surface owns the channel names (`processes:<pid>`, `processes:keys`)
  // — we plumb the deltas into them via the typed ctx returned by
  // `implementSurface`.
  processBus.consume({
    onEvent: (msg) => {
      if (msg.kind === "upsert" && msg.value !== undefined) {
        fragment.ctx.collections.processes.upsert(msg.pid, msg.value);
      } else if (msg.kind === "remove") {
        fragment.ctx.collections.processes.remove(msg.pid);
      }
    },
    onError: (err) => log(`process bus error: ${(err as Error).message}`),
  });

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

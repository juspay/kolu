/** `startHeartbeat` — periodic liveness probe over a `HostSession`'s
 *  pinned client. The transport (ssh + stdio) handles disconnect
 *  detection on its own; what an app-level heartbeat adds is
 *  *stuck-agent* detection — the ssh subprocess and the agent process
 *  are both alive, but the agent has hung (deadlock, infinite loop)
 *  and never responds. Without a heartbeat, parent-side `await
 *  callAgent(...)` blocks indefinitely on the next RPC; with one, we
 *  notice within `intervalMs * maxMisses` and tear the session down
 *  so its reconnect loop can re-establish.
 *
 *  Starts probing as soon as the session is `connected` (per
 *  `current().connection`) — first probe waits one interval. Stops
 *  on returned cleanup or when the session is destroyed.
 */

import type { AgentClient, HostSession } from "@kolu/surface-nix-host";
import type { AgentContract } from "kolu-common/agentSurface";
import { log } from "../log.ts";

export interface HeartbeatOptions {
  session: HostSession<AgentContract>;
  /** Interval between probes when the session is connected. */
  intervalMs?: number;
  /** Per-probe RPC timeout. */
  timeoutMs?: number;
  /** After this many consecutive misses, call `onUnhealthy` and reset
   *  the miss counter. */
  maxMisses?: number;
  onUnhealthy: () => void;
}

export function startHeartbeat(opts: HeartbeatOptions): () => void {
  const intervalMs = opts.intervalMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const maxMisses = opts.maxMisses ?? 5;
  let missed = 0;
  let stopped = false;

  const interval = setInterval(() => {
    if (stopped || opts.session.isDestroyed()) return;
    if (opts.session.current().connection !== "connected") return;
    void probe();
  }, intervalMs);

  async function probe(): Promise<void> {
    let clientPromise: Promise<AgentClient<AgentContract>> | null = null;
    try {
      clientPromise = opts.session.currentClient();
      if (!clientPromise) return; // No live client; nothing to probe.
      const client = await clientPromise;
      // `Promise.race` against a timer is fine here — the
      // server-side handler doesn't carry state we'd want to abort,
      // so a leaked outstanding RPC is harmless (it'll resolve and
      // the result gets discarded).
      const result = await Promise.race([
        client.surface.system.heartbeat({}),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`heartbeat timeout (${timeoutMs}ms)`)),
            timeoutMs,
          ),
        ),
      ]);
      if (result.ok) missed = 0;
    } catch (err) {
      missed += 1;
      log.warn({ err, missed, maxMisses }, "remote agent heartbeat failed");
      if (missed >= maxMisses) {
        log.error({ missed }, "remote agent unhealthy — triggering reconnect");
        missed = 0;
        opts.onUnhealthy();
      }
    }
  }

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

/**
 * One platform's lane, coordinator side: provision the runner closure on the
 * host (HostSession: `nix copy --derivation` → remote realise → spawn over
 * ssh), configure the run over the surface, and pump node state + logs back.
 *
 * Lanes are **one-shot** (design review): the first link death after attach
 * is terminal — the runner process died with the pipe, taking live state
 * with it, and Phase 1 explicitly defers runner-restart survival. The lane
 * reports `onDead` and the coordinator marks unfinished nodes `errored`
 * rather than letting HostSession's reconnect loop respawn a fresh idle
 * runner that would silently re-run completed work. Pre-attach, a bounded
 * number of connect attempts (a down host fails fast instead of retrying
 * forever on ssh's exit 255).
 */

import {
  destroyAllSessions,
  getHostSession,
  type HostSessionState,
} from "@kolu/surface-nix-host";
import type { TaskSpec } from "../common/spec";
import type {
  laneSurface,
  NodeLogFrame,
  PipelineState,
} from "../common/surface";

const MAX_CONNECT_ATTEMPTS = 3;
const CONNECT_DEADLINE_MS = Number(
  process.env.ODU_LANE_CONNECT_TIMEOUT_MS ?? 30 * 60 * 1000,
);

export interface LaneOptions {
  platform: string;
  host: string;
  /** Recipe tasks for this lane — the runner prepends `_ci-setup` itself. */
  tasks: TaskSpec[];
  pipelineName: string;
  /** Fetch source for remote lanes; null when `workspace` is provided. */
  origin: string | null;
  sha: string | null;
  /** Pre-existing checkout (the coordinator's HEAD snapshot) for localhost
   *  lanes; null for remote lanes. */
  workspace: string | null;
  resolveDrvPath: () => Promise<string>;
  /** Provision / lifecycle lines — land in `_ci-setup@<platform>`'s log. */
  onSetupLine: (line: string) => void;
  onNodes: (state: PipelineState) => void;
  onLogFrame: (nodeId: string, frame: NodeLogFrame) => void;
  /** Terminal lane death (never called after `close()`). */
  onDead: (error: string) => void;
}

export interface Lane {
  readonly platform: string;
  rerun(nodeId: string): Promise<boolean>;
  /** Graceful teardown at end of run — never triggers `onDead`. */
  close(): void;
}

export function startLane(opts: LaneOptions): Lane {
  let closed = false;
  let dead = false;
  let attached = false;
  let disconnects = 0;
  const aborts: AbortController[] = [];

  const session = getHostSession<typeof laneSurface.contract>({
    host: opts.host,
    resolveDrvPath: opts.resolveDrvPath,
    binary: "odu-runner",
  });

  const die = (error: string): void => {
    if (dead || closed) return;
    dead = true;
    opts.onSetupLine(`[odu] lane ${opts.platform} died: ${error}`);
    teardown();
    opts.onDead(error);
  };

  const teardown = (): void => {
    for (const controller of aborts) controller.abort();
    aborts.length = 0;
    clearTimeout(deadline);
    session.destroy();
  };

  const deadline = setTimeout(() => {
    if (!attached) die(`no runner attach within ${CONNECT_DEADLINE_MS}ms`);
  }, CONNECT_DEADLINE_MS);
  deadline.unref?.();

  let seenProgress = 0;
  session.onState((state: HostSessionState) => {
    for (const line of state.progressLines.slice(seenProgress)) {
      opts.onSetupLine(line);
    }
    seenProgress = state.progressLines.length;
    if (closed || dead) return;
    if (state.connection === "failed") {
      die(state.lastError ?? "host session failed");
      return;
    }
    if (state.connection === "disconnected") {
      if (attached) {
        // One-shot: the runner died with the pipe; its state is gone.
        die(state.lastError ?? "lane link dropped");
        return;
      }
      disconnects += 1;
      if (disconnects >= MAX_CONNECT_ATTEMPTS) {
        die(
          `could not reach ${opts.host} (${disconnects} attempts): ${state.lastError ?? "unknown"}`,
        );
      }
    }
  });

  const pump = async (): Promise<void> => {
    const client = await session.pin();

    // First RPC must be cheap (a cold configure would trip the connect
    // watchdog): pump the nodes cell; flip the session to connected on the
    // first frame; configure once, after.
    let configured = false;
    for await (const state of await client.surface.nodes.get({})) {
      if (closed || dead) return;
      if (!configured) {
        configured = true;
        attached = true;
        session.markConnected();
        const ack = await client.surface.run.configure({
          name: opts.pipelineName,
          origin: opts.origin,
          sha: opts.sha,
          workspace: opts.workspace,
          tasks: opts.tasks,
        });
        if (!ack.ok) {
          die(`configure rejected: ${ack.error ?? "unknown"}`);
          return;
        }
        attachLogs(client);
        continue; // the pre-configure EMPTY_STATE frame carries nothing
      }
      opts.onNodes(state);
    }
    if (!closed && !dead) die("lane state stream ended");
  };

  const attachLogs = (
    client: Awaited<ReturnType<typeof session.pin>>,
  ): void => {
    for (const id of ["_ci-setup", ...opts.tasks.map((t) => t.id)]) {
      const controller = new AbortController();
      aborts.push(controller);
      void (async () => {
        try {
          for await (const frame of await client.surface.nodeLog.get(
            { id },
            { signal: controller.signal },
          )) {
            if (closed || dead) return;
            opts.onLogFrame(id, frame);
          }
        } catch (err) {
          if (controller.signal.aborted || closed || dead) return;
          opts.onLogFrame(id, {
            kind: "append",
            text: `\n[odu] log stream error: ${(err as Error).message}\n`,
          });
        }
      })();
    }
  };

  void pump().catch((err: unknown) => {
    die((err as Error).message);
  });

  return {
    platform: opts.platform,
    rerun: async (nodeId: string): Promise<boolean> => {
      const clientPromise = session.currentClient();
      if (clientPromise === null) return false;
      try {
        const client = await clientPromise;
        const result = await client.surface.node.rerun({ id: nodeId });
        return result.ok;
      } catch {
        return false;
      }
    },
    close: (): void => {
      if (closed || dead) return;
      closed = true;
      teardown();
    },
  };
}

export { destroyAllSessions };

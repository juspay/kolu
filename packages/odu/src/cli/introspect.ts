/**
 * In-band introspection of a live run — `odu status` / `logs` / `monitor`
 * attach to the coordinator's fan-in surface on `.ci/odu.sock`. The same
 * three primitives every face speaks: one snapshot of the `nodes` cell, a
 * log stream with snapshot-then-append replay, the dashboard with `r`erun.
 */

import type { NodeLogFrame, PipelineState } from "../common/surface";
import { dialSocket, type OduClient } from "../coordinator/socket";
import {
  applyLogFrame,
  defaultAttachId,
  renderDashboard,
  STATUS_GLYPH,
  summarize,
} from "./render";

async function firstSnapshot(client: OduClient): Promise<PipelineState> {
  for await (const state of await client.surface.nodes.get({})) {
    return state;
  }
  throw new Error("odu: coordinator closed before sending state");
}

/** Resolve a node argument against the live state: exact id, or unique
 *  suffix-ish match (`e2e@x86_64-linux` ≡ `ci::e2e@x86_64-linux`). */
function resolveNodeId(state: PipelineState, token: string): string {
  if (state.nodes[token] !== undefined) return token;
  const matches = state.order.filter(
    (id) =>
      id === token || id.endsWith(`::${token}`) || id.includes(`::${token}@`),
  );
  if (matches.length === 1 && matches[0] !== undefined) return matches[0];
  throw new Error(
    matches.length === 0
      ? `odu: no node matches "${token}" (try: ${state.order.join(", ")})`
      : `odu: "${token}" is ambiguous (${matches.join(", ")})`,
  );
}

export async function statusCommand(json: boolean): Promise<number> {
  const { client, close } = await dialSocket();
  const state = await firstSnapshot(client);
  close();
  if (json) {
    const rows = state.order
      .map((id) => state.nodes[id])
      .filter((n) => n !== undefined)
      .map((n) => ({
        name: n.id,
        status: n.status,
        exit_code: n.exitCode,
        duration_ms: n.durationMs,
      }));
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  } else {
    for (const id of state.order) {
      const node = state.nodes[id];
      if (node === undefined) continue;
      process.stdout.write(
        `${STATUS_GLYPH[node.status]} ${node.status.padEnd(8)} ${id}\n`,
      );
    }
  }
  return summarize(state).failedOverall ? 1 : 0;
}

export async function logsCommand(
  token: string,
  follow: boolean,
): Promise<number> {
  const { client, close } = await dialSocket();
  const state = await firstSnapshot(client);
  const id = resolveNodeId(state, token);
  for await (const frame of await client.surface.nodeLog.get({ id })) {
    process.stdout.write(frame.text);
    if (!follow && frame.kind === "snapshot") break;
  }
  close();
  return 0;
}

export async function monitorCommand(json: boolean): Promise<number> {
  const interactive =
    !json && process.stdin.isTTY === true && process.stdout.isTTY === true;
  const { client, close } = await dialSocket();
  if (!interactive) return monitorStream(client, close, json);
  return monitorDashboard(client, close);
}

/** Non-tty / `-o json`: one line per node transition, no polling — the
 *  monitor analogue of `--progress json`. */
async function monitorStream(
  client: OduClient,
  close: () => void,
  json: boolean,
): Promise<number> {
  const seen = new Map<string, string>();
  let last: PipelineState | undefined;
  for await (const state of await client.surface.nodes.get({})) {
    last = state;
    for (const id of state.order) {
      const node = state.nodes[id];
      if (node === undefined || seen.get(id) === node.status) continue;
      seen.set(id, node.status);
      if (node.status === "pending") continue;
      if (json) {
        process.stdout.write(
          `${JSON.stringify({
            node: id,
            status: node.status,
            ...(node.exitCode !== null ? { exit_code: node.exitCode } : {}),
          })}\n`,
        );
      } else {
        process.stdout.write(`${node.status.padEnd(8)} ${id}\n`);
      }
    }
    if (summarize(state).done) break;
  }
  close();
  return last !== undefined && summarize(last).failedOverall ? 1 : 0;
}

/** Interactive dashboard — node table + attached log pane.
 *  Keys: digits attach, n/p cycle, r rerun (the one mutation), q quit. */
async function monitorDashboard(
  client: OduClient,
  close: () => void,
): Promise<number> {
  let state: PipelineState | undefined;
  let attachedId: string | undefined;
  let log = "";
  let detachLog: (() => void) | undefined;

  const repaint = (): void => {
    if (state === undefined) return;
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(`${renderDashboard({ state, attachedId, log })}\n`);
    process.stdout.write(
      "\n[digits] attach · [n/p] cycle · [r] rerun · [q] quit\n",
    );
  };

  const attachLog = (id: string): (() => void) => {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const frame of await client.surface.nodeLog.get(
          { id },
          { signal: controller.signal },
        )) {
          log = applyLogFrame(log, frame as NodeLogFrame);
          repaint();
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        log += `\n[odu] log stream error: ${(err as Error).message}\n`;
        repaint();
      }
    })();
    return () => controller.abort();
  };

  const attach = (id: string | undefined): void => {
    if (id === undefined || id === attachedId) return;
    attachedId = id;
    log = "";
    detachLog?.();
    detachLog = attachLog(id);
    repaint();
  };

  const quit = (code: number): void => {
    detachLog?.();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    close();
    process.exit(code);
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (key: string) => {
    if (key === "q" || key === "\x03" || key === "\x04") return quit(0);
    if (key === "r" && attachedId !== undefined) {
      void client.surface.node.rerun({ id: attachedId });
      return;
    }
    if (state === undefined) return;
    if (key === "n" || key === "p") {
      const idx =
        attachedId !== undefined ? state.order.indexOf(attachedId) : -1;
      const delta = key === "n" ? 1 : -1;
      attach(
        state.order[(idx + delta + state.order.length) % state.order.length],
      );
      return;
    }
    if (key >= "1" && key <= "9") {
      const next = state.order[Number(key) - 1];
      if (next !== undefined) attach(next);
    }
  });

  let first = true;
  for await (const next of await client.surface.nodes.get({})) {
    if (first) {
      first = false;
      attach(defaultAttachId(next));
    }
    state = next;
    repaint();
  }
  quit(state !== undefined && summarize(state).failedOverall ? 1 : 0);
  return 0;
}

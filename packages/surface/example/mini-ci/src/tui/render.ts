/**
 * Pure rendering + state-derivation helpers for the TUI.
 *
 * Everything here is a pure function of the surface state — no I/O, no
 * terminal control — so the dashboard logic is unit-testable without a tty.
 * `main.ts` is the thin glue that wires these to stdin/stdout.
 */

import {
  clampLog,
  type NodeState,
  type PipelineState,
} from "../common/surface";

const STATUS_GLYPH: Record<NodeState["status"], string> = {
  pending: "◦",
  running: "▶",
  ok: "✔",
  failed: "✗",
  skipped: "⊘",
};

export interface PipelineSummary {
  total: number;
  running: number;
  ok: number;
  failed: number;
  skipped: number;
  pending: number;
  /** No node is pending or running — the pipeline has settled. */
  done: boolean;
  /** Settled with at least one failure. */
  failedOverall: boolean;
}

export function summarize(state: PipelineState): PipelineSummary {
  const counts = { running: 0, ok: 0, failed: 0, skipped: 0, pending: 0 };
  for (const id of state.order) {
    const node = state.nodes[id];
    if (node === undefined) continue;
    counts[node.status] += 1;
  }
  const done = counts.pending === 0 && counts.running === 0;
  return {
    total: state.order.length,
    ...counts,
    done,
    failedOverall: done && counts.failed > 0,
  };
}

/** The default node to attach to: the first running node, else the first
 *  non-terminal node, else the last node. */
export function defaultAttachId(state: PipelineState): string | undefined {
  const running = state.order.find(
    (id) => state.nodes[id]?.status === "running",
  );
  if (running !== undefined) return running;
  const pending = state.order.find(
    (id) => state.nodes[id]?.status === "pending",
  );
  if (pending !== undefined) return pending;
  return state.order.at(-1);
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  return ` (${(ms / 1000).toFixed(1)}s)`;
}

/** One status row per node — the top half of the dashboard. */
export function renderTable(state: PipelineState, attachedId?: string): string {
  const lines = [`pipeline: ${state.name}`];
  for (const id of state.order) {
    const node = state.nodes[id];
    if (node === undefined) continue;
    const marker = id === attachedId ? "›" : " ";
    const glyph = STATUS_GLYPH[node.status];
    const needs =
      node.needs.length > 0 ? `  [needs: ${node.needs.join(", ")}]` : "";
    lines.push(
      `${marker} ${glyph} ${node.name.padEnd(10)} ${node.status}` +
        `${formatDuration(node.durationMs)}${needs}`,
    );
  }
  return lines.join("\n");
}

/** Keep a log buffer in sync with a stream of `nodeLog` frames — reset on a
 *  `snapshot` frame, append on a `delta`. Returns the new buffer. */
export function applyLogFrame(
  buffer: string,
  frame: { kind: "snapshot" | "append"; text: string },
): string {
  return clampLog(frame.kind === "snapshot" ? frame.text : buffer + frame.text);
}

/** Status line — the bottom of the dashboard. */
export function renderStatusLine(summary: PipelineSummary): string {
  if (summary.done) {
    return summary.failedOverall
      ? `● done — ${summary.failed} failed, ${summary.ok} ok, ${summary.skipped} skipped`
      : `● done — ${summary.ok} ok`;
  }
  return `● ${summary.running} running · ${summary.ok} ok · ${summary.pending} pending`;
}

/** The whole dashboard: status table, the attached node's log tail, status
 *  line. `logRows` bounds how much of the (potentially long) log we paint. */
export function renderDashboard(opts: {
  state: PipelineState;
  attachedId?: string;
  log: string;
  logRows?: number;
}): string {
  const { state, attachedId, log } = opts;
  const logRows = opts.logRows ?? 12;
  const summary = summarize(state);
  const sections = [renderTable(state, attachedId), "─".repeat(40)];
  if (attachedId !== undefined) {
    const node = state.nodes[attachedId];
    sections.push(`$ ${node?.command ?? attachedId}`);
    const tail = log.split("\n").slice(-logRows).join("\n");
    sections.push(tail);
  }
  sections.push("─".repeat(40), renderStatusLine(summary));
  return sections.join("\n");
}

/**
 * Pure rendering + state-derivation helpers for `odu monitor` (and the unit
 * tests). Everything is a pure function of surface state — no I/O, no
 * terminal control. Ported from the mini-ci example TUI, with the `errored`
 * status and CI-sized node ids.
 */

import { formatGoDuration } from "../common/duration";
import {
  clampLog,
  type NodeState,
  type PipelineState,
  STATUS_META,
} from "../common/surface";

/** The TUI glyph per status — read off the single status projection. */
export const STATUS_GLYPH: Record<NodeState["status"], string> =
  Object.fromEntries(
    Object.entries(STATUS_META).map(([status, meta]) => [status, meta.glyph]),
  ) as Record<NodeState["status"], string>;

export interface PipelineSummary {
  total: number;
  running: number;
  ok: number;
  failed: number;
  skipped: number;
  errored: number;
  pending: number;
  /** No node is pending or running — the pipeline has settled. */
  done: boolean;
  /** Settled with at least one failure or infrastructure error. */
  failedOverall: boolean;
}

export function summarize(state: PipelineState): PipelineSummary {
  const counts = {
    running: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
    errored: 0,
    pending: 0,
  };
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
    failedOverall: done && counts.failed + counts.errored > 0,
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

/** One status row per node — the top half of the dashboard. */
export function renderTable(state: PipelineState, attachedId?: string): string {
  const width = Math.max(12, ...state.order.map((id) => id.length));
  const lines = [`pipeline: ${state.name}`];
  for (const id of state.order) {
    const node = state.nodes[id];
    if (node === undefined) continue;
    const marker = id === attachedId ? "›" : " ";
    const glyph = STATUS_GLYPH[node.status];
    const dur =
      node.durationMs !== null ? ` (${formatGoDuration(node.durationMs)})` : "";
    lines.push(`${marker} ${glyph} ${id.padEnd(width)} ${node.status}${dur}`);
  }
  return lines.join("\n");
}

/** Keep a log buffer in sync with a stream of `nodeLog` frames — reset on a
 *  `snapshot` frame, append on a delta. Returns the new buffer. */
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
      ? `● done — ${summary.failed} failed, ${summary.errored} errored, ${summary.ok} ok, ${summary.skipped} skipped`
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
  const sections = [renderTable(state, attachedId), "─".repeat(60)];
  if (attachedId !== undefined) {
    const node = state.nodes[attachedId];
    sections.push(`$ ${node?.command ?? attachedId}`);
    const tail = log.split("\n").slice(-logRows).join("\n");
    sections.push(tail);
  }
  sections.push("─".repeat(60), renderStatusLine(summary));
  return sections.join("\n");
}

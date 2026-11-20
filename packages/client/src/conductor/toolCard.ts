import type {
  ConductorKoluCall,
  ConductorToolRow,
} from "kolu-common/conductor";
import { formatElapsedShort } from "../time/duration";
import type { TerminalId } from "kolu-common/surface";

export function callSubject(
  call: ConductorKoluCall | undefined,
): { readonly host: string; readonly id: TerminalId } | null {
  if (call === undefined || call.terminalId === null || call.host === null) {
    return null;
  }
  return { host: call.host, id: call.terminalId };
}

export function agentLineSubject(
  row: ConductorToolRow,
): { readonly host: string; readonly id: TerminalId } | null {
  return row.kolu?.kind === "create" ? callSubject(row.kolu) : null;
}

export function sentInput(
  call: Extract<ConductorKoluCall, { kind: "sendInput" }>,
): { readonly as: "text" | "key"; readonly value: string } | null {
  if (call.text !== null) return { as: "text", value: call.text };
  if (call.key !== null) return { as: "key", value: call.key };
  return null;
}

export function waitedFor(elapsedMs: number | null): string | null {
  return elapsedMs === null ? null : formatElapsedShort(elapsedMs);
}

export function toolLabel(row: ConductorToolRow): string {
  return row.tool ?? row.server ?? "tool";
}

const MCP_BRAND = "surface-mcp: ";

function unfenced(text: string): string {
  if (text.length < 6 || !text.startsWith("```") || !text.endsWith("```")) {
    return text;
  }
  const body = text.slice(3, -3);
  const lineEnd = body.indexOf("\n");
  return lineEnd === -1 ? body : body.slice(lineEnd + 1);
}

export function failureReason(row: ConductorToolRow): string | null {
  if (row.status !== "failed") return null;
  const call = row.kolu;
  const said =
    row.progress ??
    (call?.kind === "screen"
      ? call.snapshot
      : call?.kind === "settle"
        ? call.screenTail
        : null);
  if (said === null) return null;
  let reason = unfenced(said.trim()).trim();
  if (reason.startsWith(MCP_BRAND)) reason = reason.slice(MCP_BRAND.length);
  reason = reason.trim();
  return reason === "" ? null : reason;
}

const UNWRAP_LIMIT = 2;

const HARNESS_BLOCK_SEPARATOR = "\n\n";

function unwrapNestedJson(block: string, limit: number): unknown {
  let value: unknown = block;
  for (let depth = 0; depth < limit; depth++) {
    if (typeof value !== "string") break;
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      break;
    }
  }
  return value;
}

export function foldJson(detail: string): string {
  return detail
    .split(HARNESS_BLOCK_SEPARATOR)
    .map((block) => {
      const value = unwrapNestedJson(block, UNWRAP_LIMIT);
      if (typeof value !== "object" || value === null) return block;
      return JSON.stringify(value, null, 2);
    })
    .join(HARNESS_BLOCK_SEPARATOR);
}

const CLOCK_AFTER_MS = 3_000;

interface RunningCall {
  readonly status: "in_progress";
  readonly startedAt: string;
}

function runningCall(
  row: Pick<ConductorToolRow, "status" | "startedAt">,
): RunningCall | null {
  if (row.status !== "in_progress" || row.startedAt === undefined) return null;
  return { status: row.status, startedAt: row.startedAt };
}

export function runningFor(
  row: Pick<ConductorToolRow, "status" | "startedAt">,
  now: number,
): string | null {
  const call = runningCall(row);
  if (call === null) return null;
  const started = Date.parse(call.startedAt);
  if (Number.isNaN(started)) return null;
  const elapsed = now - started;
  if (elapsed < CLOCK_AFTER_MS) return null;
  return formatElapsedShort(elapsed);
}

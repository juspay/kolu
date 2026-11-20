import type { PtyHostDataMsg } from "kaval";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OSCILLATION_CYCLES,
  type OpenedAttach,
  REATTACH_PAUSE_MS,
  reattachingDeltas,
} from "./reattachingDeltas.ts";

const { lines, record } = vi.hoisted(() => {
  const lines: {
    level: string;
    fields: Record<string, unknown>;
    msg: string;
  }[] = [];
  return {
    lines,
    record:
      (level: string) =>
      (fields: Record<string, unknown>, msg: string): void => {
        lines.push({ level, fields, msg });
      },
  };
});
vi.mock("../log.ts", () => ({
  log: {
    warn: record("warn"),
    info: record("info"),
    error: record("error"),
    debug: record("debug"),
    fatal: record("fatal"),
    trace: record("trace"),
  },
}));

const ctx = { id: "t-osc" as TerminalId };

function oneFrameThenEnd(n: number): AsyncIterator<PtyHostDataMsg> {
  let sent = false;
  return {
    next: () => {
      if (sent) return Promise.resolve({ done: true, value: undefined });
      sent = true;
      return Promise.resolve({
        done: false,
        value: { kind: "delta", data: `d${n}` } as PtyHostDataMsg,
      });
    },
  };
}

async function oscillate(stop: number): Promise<number> {
  let cycles = 0;
  const gen = reattachingDeltas(
    () => {
      cycles++;
      return Promise.resolve({
        snapshot: "S",
        topLine: 0,
        grid: { cols: 80, rows: 24 },
        iter: oneFrameThenEnd(cycles),
      } satisfies OpenedAttach);
    },
    oneFrameThenEnd(0),
    ctx,
  );
  for await (const _ of gen) {
    if (cycles >= stop) break;
  }
  return cycles;
}

beforeEach(() => {
  lines.length = 0;
});

describe("reattachingDeltas — a sustained oscillation is loud, a transient is not", () => {
  it("reports ONCE, naming the terminal, within twice the derived cycle count", async () => {
    const cycles = await oscillate(OSCILLATION_CYCLES * 2);
    expect(cycles).toBeGreaterThanOrEqual(OSCILLATION_CYCLES * 2);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line?.level).toBe("warn");
    expect(line?.fields.id).toBe(ctx.id);
    expect(line?.fields.cycles).toBeGreaterThanOrEqual(OSCILLATION_CYCLES);
    expect(line?.fields.pauseMs).toBe(REATTACH_PAUSE_MS);
    expect(line?.msg).toMatch(/oscillating/);
  }, 20_000);

  it("a two-cycle transient stays SILENT", async () => {
    const cycles = await oscillate(2);
    expect(cycles).toBe(2);
    expect(lines).toEqual([]);
  }, 20_000);
});

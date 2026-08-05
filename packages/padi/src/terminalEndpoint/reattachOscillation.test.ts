/**
 * K3-server (kolu#2101): the one-frame oscillation lane gets LOUDNESS, not a cap.
 *
 * A leg that delivers a frame and then ends plainly refills the re-open budget by
 * design — the reset is what keeps a genuinely recovering chain alive, and these
 * tests do NOT take it away. What they pin is the other half: a chain that keeps
 * doing it forever must say so, exactly once per report interval, with the
 * terminal named; and a genuine 1–2 cycle transient must still say nothing.
 *
 * Before this, a flaky proxy could hold this loop at ~150ms per cycle for the
 * life of the PTY and emit zero log lines of any level.
 */

import type { PtyHostDataMsg } from "kaval";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OSCILLATION_CYCLES,
  type OpenedAttach,
  REATTACH_PAUSE_MS,
  reattachingDeltas,
} from "./reattachingDeltas.ts";

/** Every structured line the loop emitted, at any level — so "it stayed silent"
 *  is asserted against the whole logger, not just the level under test. */
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

/** A leg that delivers ONE frame and then ends plainly — the cycle that refills
 *  the budget, and the one a flaky proxy repeats forever. */
function oneFrameThenEnd(n: number): AsyncIterator<PtyHostDataMsg> {
  let sent = false;
  return {
    next: () =>
      Promise.resolve(
        sent
          ? { done: true, value: undefined }
          : ((sent = true), {
              done: false,
              value: { kind: "delta", data: `d${n}` } as PtyHostDataMsg,
            }),
      ),
  };
}

/** Run the oscillation for `stop` cycles and return how many it actually ran. */
async function oscillate(stop: number): Promise<number> {
  let cycles = 0;
  const gen = reattachingDeltas(
    () => {
      cycles++;
      return Promise.resolve({
        snapshot: "S",
        topLine: 0,
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
    // Twice OSCILLATION_CYCLES: the report is owed by cycle 8 (~1.2s at the flat
    // REATTACH_PAUSE_MS cadence a delivering leg keeps the loop at), and the
    // rate limit — one report per OSCILLATION_LOG_INTERVAL_MS per loop — is what
    // keeps the second half of the run silent.
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
    // The reconvergence blip the unbounded-by-design argument exists to protect:
    // a chain rebuild lands mid-attach, costs a cycle or two, and recovers. Any
    // report here would be the false positive that trains operators to ignore
    // the real one.
    const cycles = await oscillate(2);
    expect(cycles).toBe(2);
    expect(lines).toEqual([]);
  }, 20_000);
});

/** The reducer's three obligations: a snapshot ASSIGNS (the fence's replay must
 *  not double rows), a delta refines in place, and a streamed append splices at
 *  the offset the writer stamped. */

import type {
  OrchestratorFrame,
  OrchestratorRow,
} from "@kolu/padi-client/orchestrator";
import { describe, expect, it } from "vitest";
import { applyFrame, EMPTY_TRANSCRIPT } from "./transcript";

const agentRow = (id: string, seq: number, text: string): OrchestratorRow => ({
  id,
  seq,
  since: "2026-01-01T00:00:00.000Z",
  kind: "agent",
  text,
});

const snapshot = (rows: OrchestratorRow[], seq = 1): OrchestratorFrame => ({
  kind: "snapshot",
  seq,
  rows,
});

const delta = (
  patch: Partial<Extract<OrchestratorFrame, { kind: "delta" }>>,
): OrchestratorFrame => ({
  kind: "delta",
  seq: 2,
  upserts: [],
  removes: [],
  appends: [],
  ...patch,
});

describe("applyFrame", () => {
  it("assigns on a snapshot rather than merging", () => {
    const first = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "x")]),
    );
    // What a reconnect delivers: the SAME row again, in a fresh snapshot.
    const second = applyFrame(first, snapshot([agentRow("a", 1, "x")], 7));
    expect(second.rows).toHaveLength(1);
    expect(second.seq).toBe(7);
  });

  it("orders a snapshot by seq, whatever order it arrived in", () => {
    const state = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("b", 2, "second"), agentRow("a", 1, "first")]),
    );
    expect(state.rows.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("upserts in place and inserts a new row at its seq", () => {
    const base = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "one"), agentRow("c", 3, "three")]),
    );
    const refined = applyFrame(
      base,
      delta({ upserts: [agentRow("a", 1, "ONE"), agentRow("b", 2, "two")] }),
    );
    expect(refined.rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(refined.rows[0]).toMatchObject({ text: "ONE" });
  });

  it("removes by id", () => {
    const base = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "one"), agentRow("b", 2, "two")]),
    );
    expect(applyFrame(base, delta({ removes: ["a"] })).rows).toHaveLength(1);
  });

  it("appends streamed prose at the stamped offset", () => {
    const base = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "Hel")]),
    );
    const grown = applyFrame(
      base,
      delta({ appends: [{ of: "a", at: 3, text: "lo" }] }),
    );
    expect(grown.rows[0]).toMatchObject({ text: "Hello" });
  });

  it("makes a re-delivered piece a no-op instead of a stutter", () => {
    const base = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "Hello")]),
    );
    const again = applyFrame(
      base,
      delta({ appends: [{ of: "a", at: 3, text: "lo" }] }),
    );
    expect(again.rows[0]).toMatchObject({ text: "Hello" });
  });

  it("ignores an append addressed to a row it does not have", () => {
    const base = applyFrame(
      EMPTY_TRANSCRIPT,
      snapshot([agentRow("a", 1, "x")]),
    );
    const after = applyFrame(
      base,
      delta({ appends: [{ of: "ghost", at: 0, text: "…" }] }),
    );
    expect(after.rows).toEqual(base.rows);
  });

  it("applies upserts before the appends that address them", () => {
    const state = applyFrame(
      EMPTY_TRANSCRIPT,
      delta({
        upserts: [agentRow("a", 1, "Hel")],
        appends: [{ of: "a", at: 3, text: "lo" }],
      }),
    );
    expect(state.rows[0]).toMatchObject({ text: "Hello" });
  });
});

/**
 * Unit tests for `makeAwarenessSink` — the per-terminal publish sink. The
 * load-bearing invariant (its docstring, and the `AwarenessSink` contract) is
 * **mutate the captured record synchronously, THEN publish** — the sensors read
 * `record.meta` back as their own prior state, so a sink that published without
 * mutating first would type-check and silently defeat the dedup / publish-if-
 * changed / recency gates. These pin that ordering directly (there was no
 * dedicated coverage before R9·lib moved the sink into the library).
 */

import { describe, expect, it } from "vitest";
import { makeAwarenessSink } from "./awarenessSink.ts";
import { type AwarenessValue, seedAwarenessValue } from "./schema.ts";
import type { AwarenessRecord } from "./sensors.ts";

const record = (cwd: string): AwarenessRecord => ({
  pid: 1,
  meta: seedAwarenessValue(cwd),
  currentAgent: null,
});

describe("makeAwarenessSink", () => {
  it("mutates the captured record.meta synchronously BEFORE publishing (persisted)", () => {
    const rec = record("/repo");
    const published: AwarenessValue[] = [];
    const sink = makeAwarenessSink({
      record: rec,
      // Snapshot at publish time so we can see the value AS PUBLISHED, not after.
      publish: (meta) => published.push({ ...meta }),
      readScreenText: async () => "",
    });

    sink.updateServerMetadata(rec, (m) => {
      m.cwd = "/moved";
      m.lastActivityAt = 7;
    });

    // Applied to the captured record…
    expect(rec.meta.cwd).toBe("/moved");
    expect(rec.meta.lastActivityAt).toBe(7);
    // …and the publish saw the ALREADY-mutated value — mutate ran first.
    expect(published).toHaveLength(1);
    expect(published[0]?.cwd).toBe("/moved");
    expect(published[0]?.lastActivityAt).toBe(7);
  });

  it("applies the live mutator to record.meta and publishes the same value", () => {
    const rec = record("/repo");
    let mutateArg: unknown;
    let publishArg: unknown;
    const sink = makeAwarenessSink({
      record: rec,
      publish: (meta) => {
        publishArg = meta;
      },
      readScreenText: async () => "",
    });

    sink.updateServerLiveMetadata(rec, (m) => {
      mutateArg = m;
      m.agent = null;
    });

    // The mutator is handed the captured record's meta, and publish gets the same
    // (now-mutated) object — the live half flows through the identical apply-then-
    // publish path as the persisted half.
    expect(mutateArg).toBe(rec.meta);
    expect(publishArg).toBe(rec.meta);
  });

  it("writes the CAPTURED record, ignoring the per-call record argument", () => {
    const captured = record("/captured");
    const other = record("/other");
    const sink = makeAwarenessSink({
      record: captured,
      publish: () => {},
      readScreenText: async () => "",
    });

    sink.updateServerMetadata(other as unknown as AwarenessRecord, (m) => {
      m.cwd = "/moved";
    });

    expect(captured.meta.cwd).toBe("/moved"); // the captured record is mutated
    expect(other.meta.cwd).toBe("/other"); // the argument is left untouched
  });

  it("passes readScreenText through unchanged", async () => {
    const sink = makeAwarenessSink({
      record: record("/repo"),
      publish: () => {},
      readScreenText: async (n) => `tail:${n}`,
    });
    expect(await sink.readScreenText?.(5)).toBe("tail:5");
  });
});

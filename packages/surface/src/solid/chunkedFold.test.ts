/** A fold over more rows than one memo may read: the published list is the
 *  rows' values in order, and no memo is judged wide on the way.
 *
 *  Both entries are driven at 1,000 rows — `foldEach`, which mints a row memo
 *  per key, and the `joinChunks` kernel under it, which reads a RANGE of an
 *  already-indexable source. The diagnostics drain must come back EMPTY at
 *  every grade, `info` included. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { createRoot, createStore, flush } from "solid-js";
import { expect, it } from "vitest";
import { foldEach, joinChunks } from "./chunkedFold";

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

it("folds 1000 rows of three leaves each into one list, with no wide memo", () => {
  takeSolidDiagnostics();
  const ids = Array.from({ length: 1000 }, (_, at) => `t${at}`);
  const [state, setState] = createStore<{
    keys: string[];
    rows: Record<string, { name: string; cols: number; rows: number }>;
  }>({
    keys: ids,
    rows: Object.fromEntries(
      ids.map((id, at) => [id, { name: id, cols: at, rows: 1 }]),
    ),
  });
  const folded = createRoot(() =>
    foldEach(
      "terminalSizes",
      () => state.keys,
      (id) => {
        const one = state.rows[id];
        return one === undefined
          ? undefined
          : `${one.name}:${one.cols}x${one.rows}`;
      },
    ),
  );
  flush();
  expect(folded()).toEqual(ids.map((id, at) => `${id}:${at}x1`));

  setState((s) => {
    const row = s.rows.t500;
    if (row !== undefined) row.cols = 7;
  });
  flush();
  expect(folded()[500]).toBe("t500:7x1");

  setState((s) => {
    s.keys.splice(10, 0, "fresh");
    s.rows.fresh = { name: "fresh", cols: 1, rows: 1 };
  });
  flush();
  expect(folded()).toHaveLength(1001);
  expect(folded()[10]).toBe("fresh:1x1");
  expect(folded()[11]).toBe("t10:10x1");
  expect(diagnostics()).toEqual([]);
});

it("joins 1000 positions read by range into one list, with no wide memo", () => {
  takeSolidDiagnostics();
  // The shape `health()` and the map's membership keyset have: no row memo at
  // all, a length and a reading of a range of an indexable source — here a
  // store array, whose every indexed read is a source of its own.
  const [state, setState] = createStore<{ slots: number[] }>({
    slots: Array.from({ length: 1000 }, (_, at) => at),
  });
  const joined = createRoot(() =>
    joinChunks<string>(
      "slotRange",
      () => state.slots.length,
      (start, end) => {
        const reading: string[] = [];
        for (let at = start; at < end; at++)
          reading.push(`s${at}:${state.slots[at]}`);
        return reading;
      },
    ),
  );
  flush();
  expect(joined()).toEqual(
    Array.from({ length: 1000 }, (_, at) => `s${at}:${at}`),
  );

  const was = joined();
  setState((s) => {
    s.slots[500] = 7;
  });
  flush();
  expect(joined()).toHaveLength(1000);
  expect(joined()[500]).toBe("s500:7");
  // The join published a new list, and every other position reads what it did.
  expect(joined()[499]).toBe(was[499]);
  expect(diagnostics()).toEqual([]);
});

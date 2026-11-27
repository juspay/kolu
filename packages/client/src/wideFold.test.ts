/** A fold over more rows than one memo may read: the published list is the
 *  rows' values in key order, and no memo is judged wide on the way. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { createRoot, createStore, flush } from "solid-js";
import { expect, it } from "vitest";
import { foldEach } from "./wideFold";

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

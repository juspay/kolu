/** HOW THE PRINTED-PORT INDEX IS WRITTEN — one terminal that keeps printing,
 *  on a fleet-sized index.
 *
 *  The index is a `createStore` keyed by terminal, and each pass used to write
 *  a terminal's row by assigning a fresh array over it. Solid's development
 *  build judges that `IMMUTABLE_UPDATE_IN_STORE` the moment the fresh array is
 *  mostly the old one — which is exactly the steady case here: a terminal that
 *  prints a THIRD distinct port replaces `[a, b]` with `[a, b, c]`, two of
 *  three rows unchanged. A new container wakes every reader of the row for the
 *  one entry that moved, and in the `solid-dev` lane the finding fails the run.
 *
 *  Driven through the REAL scanner (`./printedPortsScan.testlib.ts`): the
 *  production writer reading a real terminal buffer, so what is pinned here is
 *  how the index is written in the browser and not how a test writes it.
 *
 *  The fleet is 250 printing terminals, because the row that is appended to has
 *  to stay the only one that moves. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { TerminalId } from "kolu-common/surface";
import { createMemo, createRoot, flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { printedPortsOf } from "./printedPorts";
import {
  printingTerminal,
  runScans,
  stopScans,
} from "./printedPortsScan.testlib";

const TERMINALS = 250;
const ids = Array.from(
  { length: TERMINALS },
  (_, n) => `pp${n}` as TerminalId,
) as TerminalId[];
/** The terminal that keeps restarting its dev server on a new port. */
const SUBJECT = 7;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  stopScans();
  dispose?.();
  dispose = undefined;
  flush();
});

it("appends a terminal's third and fourth printed port without replacing its row", () => {
  takeSolidDiagnostics();
  const prints = ids.map((id) => printingTerminal(id));
  for (const [n, print] of prints.entries()) print(3000 + n);
  runScans();

  // A reader of the ROW, not of the index: it must see every append, which is
  // the property an in-place write has to keep.
  const row = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return createMemo(() => printedPortsOf(ids[SUBJECT] as TerminalId).join(), {
      name: "printedPortsWrites.row",
    });
  });

  expect([...printedPortsOf(ids[0] as TerminalId)]).toEqual([3000]);
  expect([...printedPortsOf(ids[TERMINALS - 1] as TerminalId)]).toEqual([3249]);
  expect(row()).toBe("3007");
  expect(diagnostics()).toEqual([]);

  // A second port — two rows, nothing in the old one to leave unchanged.
  prints[SUBJECT]?.(4001);
  runScans();
  expect([...printedPortsOf(ids[SUBJECT] as TerminalId)]).toEqual([3007, 4001]);
  expect(row()).toBe("3007,4001");
  expect(diagnostics()).toEqual([]);

  // The THIRD — two of three unchanged, which is where a spread copy is judged.
  prints[SUBJECT]?.(4002);
  runScans();
  expect([...printedPortsOf(ids[SUBJECT] as TerminalId)]).toEqual([
    3007, 4001, 4002,
  ]);
  expect(row()).toBe("3007,4001,4002");
  expect(diagnostics()).toEqual([]);

  // And the fourth, with the neighbours still holding their own one port.
  prints[SUBJECT]?.(4003);
  runScans();
  expect([...printedPortsOf(ids[SUBJECT] as TerminalId)]).toEqual([
    3007, 4001, 4002, 4003,
  ]);
  expect(row()).toBe("3007,4001,4002,4003");
  expect([...printedPortsOf(ids[SUBJECT - 1] as TerminalId)]).toEqual([3006]);
  expect([...printedPortsOf(ids[SUBJECT + 1] as TerminalId)]).toEqual([3008]);
  expect(diagnostics()).toEqual([]);
});

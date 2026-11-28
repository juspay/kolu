// @vitest-environment happy-dom
/**
 * THE ELIMINATION PROBE FOR CORVU'S RESIZABLE.
 *
 * The lane reports a `STRICT_READ_UNTRACKED` carrying neither `loc` nor
 * `ownerPath` — an effect APPLY arm reading a value that has no name either,
 * which `emitDiagnostic` cannot place because an apply arm enters no owner
 * (`@solidjs/signals` 2.0.4 `dev.js:1586-1654`). `@corvu-next/resizable` is
 * the only library on the desktop-only path with apply arms of its own
 * (`dist/index.jsx:529` writes aria attributes, `:540` calls a module
 * function), so this file mounts a REAL controlled `Resizable` — two panels
 * and a handle, `sizes` through kolu's own `controlledSizes`, the shape
 * `TerminalContent.tsx:157` and `codeSplit.ts:106` hand it — and judges what
 * it raises.
 *
 * It is an ELIMINATION probe: a clean result says the finding is not here,
 * which is only worth saying because the second test proves this instrument
 * raises exactly that shape when something does.
 */

import Resizable from "@corvu-next/resizable";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { render } from "@solidjs/web";
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { controlledSizes } from "./corvuResizable";

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

/** Findings the lane cannot name: no location, no owner path. */
function namelessStrictReads(): string[] {
  return takeSolidDiagnostics()
    .filter(
      (event) =>
        event.code === "STRICT_READ_UNTRACKED" &&
        event.loc === undefined &&
        event.ownerPath === undefined,
    )
    .map((event) => `${event.nodeName ?? "(unnamed)"}: ${event.message}`);
}

it("a controlled two-panel Resizable raises no location-less strict read", () => {
  const [expanded, setExpanded] = createSignal(false);
  // The exact shape the product hands Corvu: a memo with value equality over
  // the two fractions, recomputed from one reactive fact.
  const sizes = controlledSizes(() => (expanded() ? [0.6, 0.4] : [1, 0]));
  const reported: number[][] = [];

  const host = document.createElement("div");
  dispose = render(
    () => (
      <Resizable
        orientation="vertical"
        sizes={sizes()}
        onSizesChange={(next) => reported.push(next)}
      >
        <Resizable.Panel as="div" data-testid="panel-top" minSize={0.2} />
        <Resizable.Handle as="button" data-testid="handle" />
        <Resizable.Panel as="div" data-testid="panel-bottom" minSize={0} />
      </Resizable>
    ),
    host,
  );
  flush();

  // THE PANELS AND THE HANDLE ARE REAL. A Resizable that never registered its
  // panels runs none of the apply arms this file exists to judge.
  expect(host.querySelector("[data-testid='panel-top']")).toBeTruthy();
  expect(host.querySelector("[data-testid='panel-bottom']")).toBeTruthy();
  const handle = host.querySelector("[data-testid='handle']");
  expect(handle).toBeTruthy();
  // `:529`'s apply arm is what writes these, so their presence is the proof
  // that the arm ran at all.
  expect(handle?.getAttribute("aria-valuenow")).toBeTruthy();

  // A SECOND PUBLISH, so the arms run again rather than only at registration:
  // the controlled sizes change, which is the path a tile's expand takes.
  setExpanded(true);
  flush();
  expect(handle?.getAttribute("aria-valuenow")).toBeTruthy();

  expect(namelessStrictReads()).toEqual([]);
});

// THE PROBE'S OWN SENSITIVITY, in this file's own module graph: a clean
// elimination is worth nothing from an instrument that cannot raise the
// finding. An apply arm reading a signal that carries no name is exactly the
// shape — no `loc`, no `ownerPath`, and the constructor's default `nodeName`.
it("would catch a location-less strict read if the Resizable raised one", () => {
  const held = createRoot((disposeRoot) => {
    const unnamed = (() => createSignal(0))();
    const [source, setSource] = createSignal(0);
    createEffect(
      () => source(),
      () => {
        unnamed[0]();
      },
    );
    return { bump: () => setSource(1), disposeRoot };
  });
  flush();
  held.bump();
  flush();
  held.disposeRoot();

  expect(namelessStrictReads().length).toBeGreaterThan(0);
});

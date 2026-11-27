// @vitest-environment happy-dom

/** THE RENDERER, WITH THE DIALOG SHUT.
 *
 *  `DiagnosticInfo.wide.test.tsx` holds the dialog OPEN and hands every pane a
 *  CONSTANT renderer accessor, so the register's renderer leaf is written
 *  exactly once per terminal. Both of those hide the defect this file is about:
 *
 *   - the app-lifetime fold (`useTerminalDiagnostics.ts`'s `registered`) reads
 *     every registered terminal's renderer whether or not the dialog is
 *     mounted, so the leaf has a node — and a stamped write — in the state the
 *     wide test excludes;
 *   - one write cannot be a COPY: Solid grades a leaf an effect keeps in step
 *     with its own compute output only at the SECOND write of it
 *     (`@solidjs/signals` 2.0.4 `dev.attribution.js:1106-1108`), which is why
 *     this drives one terminal's renderer through THREE flips.
 *
 *  So: the real module store, the real `registerDiagnostics`, no dialog, and a
 *  renderer that moves the way the WebGL addon moves it in the field — budget
 *  eviction of a parked tile, a swipe, a split opening. After every flush the
 *  drain must be empty (`info` included) and the FOLD must already publish the
 *  new renderer, so a repair that silences the judge by going quiet fails here
 *  too. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import {
  getDiagnostics,
  type Renderer,
  registerDiagnostics,
} from "./useTerminalDiagnostics";

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

const ID = "renderer-flip" as TerminalId;

/** The one terminal's PUBLISHED renderer, off the app-lifetime fold — the same
 *  reading the Diagnostic dialog's dump and its Count row take. */
const published = (): Renderer | undefined =>
  getDiagnostics().find((entry) => entry.id === ID)?.renderer;

let unregister: (() => void) | undefined;
let dispose: (() => void) | undefined;
afterEach(() => {
  unregister?.();
  unregister = undefined;
  dispose?.();
  dispose = undefined;
  flush();
  takeSolidDiagnostics();
});

it("publishes a terminal's renderer across three flips with the dialog shut", () => {
  takeSolidDiagnostics();

  const setRenderer = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const [renderer, setIt] = createSignal<Renderer>("webgl");
    const [term] = createSignal({ cols: 80, rows: 24 });
    const [wanted] = createSignal<{ cols: number; rows: number } | null>({
      cols: 80,
      rows: 24,
    });
    unregister = registerDiagnostics(ID, {
      term,
      renderer,
      wanted,
      scrollLock: {
        locked: () => false,
        pendingChunks: () => 0,
        lastEvent: () => null,
      },
    });
    return setIt;
  });

  flush();
  expect(published()).toBe("webgl");
  expect(diagnostics()).toEqual([]);

  // The addon detaches, re-attaches, detaches again: three writes of the one
  // leaf, which is one more than a copy needs to be graded.
  for (const next of ["dom", "webgl", "dom"] as const) {
    setRenderer(next);
    flush();
    expect(published()).toBe(next);
    expect(diagnostics()).toEqual([]);
  }
});

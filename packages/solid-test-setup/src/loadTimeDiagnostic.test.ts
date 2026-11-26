/**
 * A diagnostic raised while a test file's OWN MODULES load is judged.
 *
 * Vitest evaluates the setup file, then the test module, then runs
 * `beforeEach`. kolu has module-scope owned scopes that compute at import
 * (`agents/useAgentDistro.ts`, `forwards/useForwards.ts`,
 * `kaval/useDaemonStatus.ts`, `canvas/dock/Dock.tsx` among them), so a finding
 * they provoke is raised BEFORE any test begins — and is seen only if the
 * engine was already installed when they ran. With a per-test hold alone it
 * is not: nothing is enabled yet, and the code cannot fire at all.
 *
 * This file's module scope is the provocation: the same spread-copy store
 * write `setup.test.ts` uses, here at import time. `takeSolidDiagnostics()`
 * is called at module scope too, so what the test asserts on is exactly what
 * the collector held before the first `beforeEach`.
 */

import { createStore } from "solid-js";
import { expect, it } from "vitest";
import { takeSolidDiagnostics } from "./setup.ts";

const [store, setStore] = createStore({
  panel: { collapsed: false, size: 10 },
});

setStore((draft) => {
  draft.panel = { ...draft.panel, size: 11 };
});

// Solid stages writes and runs the engine's checks on a flush; a macrotask
// tick drains the queue the way a frame does — the flush is the awaited
// event, and a zero-delay timer is the macrotask boundary it drains on, not
// a guessed delay. Top-level await, so the diagnostic is in hand before any
// test is registered.
const flushed = Promise.withResolvers<void>();
setTimeout(flushed.resolve, 0);
await flushed.promise;

const atLoad = takeSolidDiagnostics().map((event) => event.code);

it("judges a diagnostic raised while this file's modules loaded", () => {
  expect(store.panel.size).toBe(11);
  expect(atLoad).toContain("IMMUTABLE_UPDATE_IN_STORE");
});

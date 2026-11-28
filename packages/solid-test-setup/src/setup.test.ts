/**
 * What a test gets from this setup file, tested through the setup file itself
 * (`vitest.config.ts` loads `./src/setup.ts` as its own `setupFiles` entry).
 *
 * Two properties, each of which was once wrong:
 *
 *   - the attribution engine is held PER TEST, so a finding with a memory
 *     ("once per store path") can still fire in the second test of a file;
 *   - the wall-clock checks are off, so a test that waits on a real timer is
 *     not failed for the wait.
 */

import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
} from "solid-js";
import { expect, it } from "vitest";
import { takeSolidDiagnostics } from "./setup.ts";

/** Solid stages writes and runs effects on a flush; a macrotask tick drains
 *  the queue the way a frame does. */
function tick(ms = 0): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * The spread-copy store write `IMMUTABLE_UPDATE_IN_STORE` is about: one leaf
 * changes, and the whole object around it is replaced with a copy. Both tests
 * below write the SAME path, which is what makes the engine's once-per-path
 * memory visible.
 */
async function writeSpreadCopy(): Promise<ReadonlyArray<string>> {
  const [store, setStore] = createStore({
    panel: { collapsed: false, size: 10 },
  });
  setStore((draft) => {
    draft.panel = { ...draft.panel, size: 11 };
  });
  await tick();
  expect(store.panel.size).toBe(11);
  return takeSolidDiagnostics().map((event) => event.code);
}

it("raises IMMUTABLE_UPDATE_IN_STORE on a spread-copy store write", async () => {
  expect(await writeSpreadCopy()).toContain("IMMUTABLE_UPDATE_IN_STORE");
});

// The SAME write on the same path again. The engine reports a path once and
// forgets only when the engine is enabled afresh, so this test passes only
// because the previous test's hold was released and a new one taken.
it("raises it again in the next test of the same file", async () => {
  expect(await writeSpreadCopy()).toContain("IMMUTABLE_UPDATE_IN_STORE");
});

// A REAL timer on purpose: the subject is the engine's own wall clock
// (`SILENT_HOLD` fires when a write is held for 100ms), which reads
// `performance.now()` inside Solid and cannot be advanced from here.
it("judges nothing when a write waits 150 ms on async work", async () => {
  const [key, setKey] = createSignal(0);
  const landed: number[] = [];
  const slow = createMemo(async () => {
    const asked = key();
    await tick(150);
    return asked;
  });
  const dispose = createRoot((disposeRoot) => {
    // A RENDER effect, which is what JSX inserts a value with: the frame is
    // held for a paint consumer, and a write behind a pending async source is
    // a hold only because one is waiting to draw.
    createRenderEffect(
      () => slow(),
      (value) => {
        landed.push(value);
      },
    );
    return disposeRoot;
  });
  const landings = async (count: number) => {
    const until = Date.now() + 5000;
    while (landed.length < count && Date.now() < until) await tick();
  };

  try {
    // The first landing is an initial load, which no hold check judges:
    // nothing the user did went unanswered.
    await landings(1);
    takeSolidDiagnostics();
    // This write is the signature: a user's write held behind 150ms of async
    // work with nothing on screen acknowledging the wait.
    setKey(1);
    await landings(2);
    expect(landed).toEqual([0, 1]);
    expect(takeSolidDiagnostics().map((event) => event.code)).toEqual([]);
  } finally {
    dispose();
  }
});

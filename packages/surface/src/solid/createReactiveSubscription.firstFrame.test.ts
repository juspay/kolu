/** A FRESH INPUT'S FIRST FRAME IS A VALUE, NOT A CHANGE.
 *
 *  An input change opens a fresh subscription, so `updated`/`changed` must not
 *  report the new input's first frame as a change from the prior input's last
 *  one — the change-iff-fired law `createUpdatedTracker` holds for every
 *  subscription. The case that tests it is a stream that sends its first frame
 *  ON SUBSCRIBE: an Effect `Stream` runs synchronously to its first suspension,
 *  so that frame lands inside the apply arm, before anything the arm defers.
 *
 *  Three input changes, each opening a stream whose first frame is immediate.
 *  Every round asserts the published value, that neither channel fired, and an
 *  EMPTY diagnostics drain, `info` included. A frame sent later on the SAME
 *  input is a change, and is reported once. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { Stream } from "effect";
import { createRoot, createSignal, flush } from "solid-js";
import { expect, it } from "vitest";
import {
  type ControllableStream,
  controllableStream,
} from "./controllableStream.testlib";
import { createReactiveSubscription } from "./createReactiveSubscription";

const drained = (): string[] =>
  takeSolidDiagnostics().map((e) => `[${e.severity}] ${e.code} ${e.message}`);

async function settle(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  flush();
}

it("reports no change for a fresh input's immediate first frame, three times", async () => {
  takeSolidDiagnostics();

  const later = new Map<string, ControllableStream<string>>();
  const [input, setInput] = createSignal("A");
  const updates: Array<{ prev: string; next: string }> = [];
  let changes = 0;
  let value!: () => string | undefined;
  const dispose = createRoot((disposeRoot) => {
    const sub = createReactiveSubscription<string, string>(input, (current) => {
      const rest = controllableStream<string>();
      later.set(current, rest);
      // The first frame is there the moment the stream is subscribed.
      return Stream.concat(Stream.make(`${current}1`), rest.source);
    });
    const { updated, changed } = sub;
    if (updated === undefined || changed === undefined)
      throw new Error("a reactive subscription carries updated and changed");
    updated((change) => {
      updates.push(change);
    });
    changed(() => {
      changes += 1;
    });
    value = sub;
    return disposeRoot;
  });

  try {
    await settle();
    expect(value()).toBe("A1");
    expect(updates).toEqual([]);
    expect(changes).toBe(0);
    expect(drained()).toEqual([]);

    for (const next of ["B", "C", "D"]) {
      setInput(next);
      flush();
      await settle();
      expect(value()).toBe(`${next}1`);
      expect(updates).toEqual([]);
      expect(changes).toBe(0);
      expect(drained()).toEqual([]);
    }

    // A later frame on the same input IS a change, reported once.
    later.get("D")?.push("D2");
    await settle();
    expect(value()).toBe("D2");
    expect(updates).toEqual([{ prev: "D1", next: "D2" }]);
    expect(changes).toBe(1);
    expect(drained()).toEqual([]);
  } finally {
    dispose();
  }
});

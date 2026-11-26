/**
 * WHICH FINDINGS ARE ADVISORY, judged through the setup file itself.
 *
 * Exactly one is: an `EFFECT_RELAY_TEAR` Solid grades `info`. There `info` is
 * Solid's own word for "reported, not wrong" — the relay tear of a value
 * measured from outside the graph is the standing example, and Solid's repair
 * text for it says so: "the tear is the cost of measuring" (`@solidjs/signals`
 * 2.0.4 `dev.attribution.js:1222-1229`). A judge that fails on it fails a
 * scenario for a finding Solid itself calls advisory, which is what both of
 * kolu's judges used to do.
 *
 * `info` IS NOT A BLANKET PASS, which is what both judges used to make it:
 * Solid grades `EFFECT_WRITES_OWN_SOURCE` by cycle length (`links.length === 1
 * ? "warn" : "info"`, `dev.attribution.js:1054`), so a write cycle relayed
 * through two effects comes out `info` while Solid's own message says "derive
 * them in memos and drop the writes". Every code but `EFFECT_RELAY_TEAR`
 * therefore fails whatever its grade.
 *
 * Every finding here is REAL: the attribution engine grades them, nothing is
 * hand-built. The advisory one is deliberately left in the collector, so the
 * setup file's own `afterEach` is what judges it — that test passes only
 * because an `info` relay tear fails nothing.
 */

import { createEffect, createRoot, createSignal } from "solid-js";
import { expect, it } from "vitest";
import { isAdvisorySolidDiagnostic, takeSolidDiagnostics } from "./setup.ts";

/** Solid stages writes and runs the engine's checks on a flush; a macrotask
 *  tick drains the queue the way a frame does. */
function tick(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

/**
 * A RELAY TEAR OF A MEASUREMENT. The relay effect tracks `source` and, in its
 * apply arm, writes `measured` with a value that is NOT its compute output —
 * the shape of an effect reading `offsetWidth` once the element exists. The
 * victim reads both, so one write of `source` runs it twice: once with the
 * stale `measured`, once after the relay. Not derivable (nothing to turn into
 * a memo), so Solid grades the first sighting `info`.
 */
function measurementTear(): { run: () => void; dispose: () => void } {
  let outside = 0;
  return createRoot((dispose) => {
    const [source, setSource] = createSignal(0);
    const [measured, setMeasured] = createSignal(0);
    createEffect(
      () => source(),
      () => {
        setMeasured(++outside);
      },
    );
    createEffect(
      () => [source(), measured()],
      () => {},
    );
    // The root's body is an owned scope; the write that starts the flush is
    // the caller's, outside it.
    return { run: () => setSource(1), dispose };
  });
}

/**
 * A DERIVABLE RELAY TEAR. The relay writes its own compute output into a
 * signal nothing else writes, which is a memo written the long way round —
 * Solid grades that `warn` from its first sighting, and names the repair.
 */
function derivableTear(): { run: () => void; dispose: () => void } {
  return createRoot((dispose) => {
    const [source, setSource] = createSignal(0);
    const [doubled, setDoubled] = createSignal(0);
    createEffect(
      () => source() * 2,
      (value) => {
        setDoubled(value);
      },
    );
    createEffect(
      () => [source(), doubled()],
      () => {},
    );
    return { run: () => setSource(1), dispose };
  });
}

// The finding is LEFT for the setup's `afterEach`: this test passes only
// because an `info` grade fails nothing.
it("an info-grade finding does not fail the test that raised it", async () => {
  // FIRST, PROVE THE FINDING IS REAL and that Solid graded it `info`: taken,
  // so it is this assertion that judges it.
  const judged = measurementTear();
  await tick();
  judged.run();
  await tick();
  judged.dispose();
  const events = takeSolidDiagnostics();
  const tear = events.find((event) => event.code === "EFFECT_RELAY_TEAR");
  expect(tear?.severity).toBe("info");
  expect(events.every(isAdvisorySolidDiagnostic)).toBe(true);

  // NOW THE SAME FINDING AGAIN, from a second graph of its own so the
  // engine's once-per-relay memory does not swallow it — and LEFT in the
  // collector. The setup file's `afterEach` is what judges this one, and
  // this test passes only because an `info` grade fails nothing.
  const left = measurementTear();
  await tick();
  left.run();
  await tick();
  left.dispose();
});

it("a warn-grade finding is judged a failure", async () => {
  const { run, dispose } = derivableTear();
  await tick();
  run();
  await tick();
  dispose();
  // TAKEN, because this one WOULD fail the test — which is the assertion.
  const events = takeSolidDiagnostics();
  const tear = events.find((event) => event.code === "EFFECT_RELAY_TEAR");
  expect(tear?.severity).toBe("warn");
  expect(tear && isAdvisorySolidDiagnostic(tear)).toBe(false);
  // And the advisory grade is not a blanket pass: every event here fails.
  expect(events.filter(isAdvisorySolidDiagnostic)).toEqual([]);
});

/**
 * A WRITE CYCLE RELAYED THROUGH TWO EFFECTS. The first effect tracks `a` and
 * writes `b`; the second tracks `b` and writes `a`, so the first effect's own
 * write comes back to its inputs one hop later. Solid grades the cycle by its
 * length — two links, so `info` — while its message for exactly this shape
 * says "derive them in memos and drop the writes"
 * (`dev.attribution.js:1044-1054`). Derivable and wrong, graded `info`: the
 * class a judge that waves every `info` through lets past.
 */
function relayedCycle(): { run: () => void; dispose: () => void } {
  return createRoot((dispose) => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    createEffect(
      () => a(),
      (value) => {
        if (value < 3) setB(value + 1);
      },
    );
    createEffect(
      () => b(),
      (value) => {
        if (value < 3) setA(value + 1);
      },
    );
    return { run: () => setA(1), dispose };
  });
}

it("an info-grade finding of any other code is judged a failure", async () => {
  const { run, dispose } = relayedCycle();
  await tick();
  run();
  await tick();
  await tick();
  dispose();
  // TAKEN, because this one WOULD fail the test — which is the assertion.
  const events = takeSolidDiagnostics();
  const cycle = events.find(
    (event) => event.code === "EFFECT_WRITES_OWN_SOURCE",
  );
  expect(cycle?.severity).toBe("info");
  expect(cycle && isAdvisorySolidDiagnostic(cycle)).toBe(false);
  // Nothing here is advisory: only an info-graded relay tear ever is.
  expect(events.filter(isAdvisorySolidDiagnostic)).toEqual([]);
});

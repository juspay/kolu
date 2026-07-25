/**
 * The reactor's loop guard — a poll whose own re-read fires its own change edge.
 *
 * This is the shape that froze a production server. `everyMsOr(interval, edge)`
 * is a legal, useful fuse: re-read on a clock AND the moment something says the
 * value moved. A read that ANNOUNCES on that same edge closes the circle, and the
 * reactor executes it exactly as written — read → announce → tick → read — with
 * the event loop never yielding again. HTTP died, `SIGTERM` went unanswered, and
 * `SIGKILL` was the only way out.
 *
 * Two halves are needed to call it, and both matter:
 *
 *  - **Ticks arriving faster than the interval.** A fused source is SUPPOSED to
 *    re-read on an edge, so edges alone prove nothing.
 *  - **Value-equal results.** This is the discriminator that keeps a legitimate
 *    burst out of the trap: a source genuinely producing a run of DISTINCT values
 *    is doing its job, however fast the edges arrive. A cycle, by contrast, feeds
 *    itself — every lap re-reads the same world and produces the same answer, and
 *    that is what makes it a cycle rather than activity.
 *
 * A freeze becomes a stack trace naming the cell.
 */

import { describe, expect, it, vi } from "vitest";
import { everyMsOr, source } from "./reactor";

/** Drive a source through `derived.cell`'s connect path, as a served cell does.
 *
 *  The seed read runs BEFORE `install`, so a cycle cannot start during it — the
 *  edge has no subscriber yet. That mirrors production exactly: the freeze began
 *  at the first act that fired the edge, not at boot. So this waits for the
 *  install to land before a caller kicks anything. */
async function connect<T>(poll: ReturnType<typeof source<T>>) {
  const seen: T[] = [];
  const stop = await (
    poll as { connectPoll: (set: (v: T) => void) => Promise<() => void> }
  ).connectPoll((v) => seen.push(v));
  await new Promise((r) => setTimeout(r, 10));
  return { seen, stop };
}

describe("the reactor's self-tick loop guard", () => {
  it("CRASHES on a read that fires its own change edge — the production freeze", async () => {
    // The PRT2 wiring, in miniature: the read announces on the edge that
    // triggers the read. Before the guard this ran forever inside the event
    // loop; it must now fail loudly instead.
    const listeners = new Set<() => void>();
    const thrown: unknown[] = [];
    let reads = 0;

    const poll = source<number>({
      read: async () => {
        reads += 1;
        // The defect: announcing from inside the read.
        for (const tick of listeners) tick();
        // …and always the same answer, which is what makes it a cycle.
        return 7;
      },
      install: everyMsOr(60_000, (tick) => {
        listeners.add(tick);
        return () => listeners.delete(tick);
      }),
      label: "forwards",
      // Routed rather than thrown, ONLY so the suite can observe it. The default
      // is a real throw on its own turn, because an unbounded cycle has to be a
      // crash with a stack rather than a process that stops answering — the
      // guard fires and stops the loop either way.
      onLoop: (err) => thrown.push(err),
    });

    const { stop } = await connect(poll);
    // ONE external edge — the act that started it in production (a forward
    // opened). From here the read feeds itself.
    for (const tick of [...listeners]) tick();
    // The guard fires within a bounded number of laps rather than never.
    await vi.waitFor(() => expect(reads).toBeGreaterThan(2), {
      timeout: 2_000,
    });
    await new Promise((r) => setTimeout(r, 50));
    const settled = reads;
    await new Promise((r) => setTimeout(r, 50));
    expect(reads).toBe(settled); // it STOPPED — a loop would still be climbing
    expect(thrown).toHaveLength(1);
    stop?.();
  });

  it("names the cell in the error, so a freeze reads as a stack trace", async () => {
    const listeners = new Set<() => void>();
    const thrown: unknown[] = [];
    const poll = source<number>({
      read: async () => {
        for (const tick of listeners) tick();
        return 1;
      },
      install: everyMsOr(60_000, (tick) => {
        listeners.add(tick);
        return () => listeners.delete(tick);
      }),
      label: "forwards",
      onLoop: (err) => thrown.push(err),
    });
    const { stop } = await connect(poll);
    for (const tick of [...listeners]) tick();
    await vi.waitFor(() => expect(thrown.length).toBeGreaterThan(0), {
      timeout: 2_000,
    });
    expect(String(thrown[0])).toMatch(/forwards/);
    expect(String(thrown[0])).toMatch(/re-read/i);
    stop?.();
  });

  it("leaves a fused source producing DISTINCT values alone", async () => {
    // The discriminator, asserted as the thing it protects: rapid edges are
    // legitimate when the value is genuinely moving. Without the value-equality
    // condition this test is what a naive rate-only guard would break.
    const listeners = new Set<() => void>();
    const thrown: unknown[] = [];
    let n = 0;
    const poll = source<number>({
      read: async () => {
        n += 1;
        return n;
      },
      install: everyMsOr(60_000, (tick) => {
        listeners.add(tick);
        return () => listeners.delete(tick);
      }),
      label: "counter",
      onLoop: (err) => thrown.push(err),
    });
    const { stop } = await connect(poll);
    // Drive many rapid edges from OUTSIDE the read — a real burst.
    for (let i = 0; i < 20; i += 1) {
      for (const tick of listeners) tick();
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(thrown).toEqual([]);
    expect(n).toBeGreaterThan(1);
    stop?.();
  });

  it("leaves a QUIET fused source alone", async () => {
    // Value-equal reads are the normal steady state of a poll — they must not
    // trip anything on their own. Only equal reads driven by self-arriving
    // ticks are the cycle.
    const thrown: unknown[] = [];
    const poll = source<number>({
      read: async () => 42,
      install: everyMsOr(60_000, () => () => {}),
      label: "steady",
      onLoop: (err) => thrown.push(err),
    });
    const { stop } = await connect(poll);
    await new Promise((r) => setTimeout(r, 60));
    expect(thrown).toEqual([]);
    stop?.();
  });
});

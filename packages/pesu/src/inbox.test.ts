import { describe, expect, it } from "vitest";
import { Inbox } from "./inbox.ts";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe("Inbox — the write floor (FIFO, one turn in flight)", () => {
  it("runs jobs in FIFO order and never overlaps two", async () => {
    const inbox = new Inbox();
    const events: string[] = [];
    let running = 0;
    let maxConcurrent = 0;

    const job =
      (label: string): (() => Promise<void>) =>
      async () => {
        running++;
        maxConcurrent = Math.max(maxConcurrent, running);
        events.push(`start:${label}`);
        await tick();
        events.push(`end:${label}`);
        running--;
      };

    inbox.enqueue(job("a"));
    inbox.enqueue(job("b"));
    inbox.enqueue(job("c"));

    // Wait for the queue to drain.
    while (inbox.depth > 0) await tick();
    await tick();

    expect(maxConcurrent).toBe(1);
    expect(events).toEqual([
      "start:a",
      "end:a",
      "start:b",
      "end:b",
      "start:c",
      "end:c",
    ]);
  });

  it("keeps draining after a job throws (a caught error surfaces, the pump survives)", async () => {
    const errors: unknown[] = [];
    const inbox = new Inbox((e) => errors.push(e));
    const ran: string[] = [];

    inbox.enqueue(async () => {
      throw new Error("boom");
    });
    inbox.enqueue(async () => {
      ran.push("after");
    });

    while (inbox.depth > 0) await tick();
    await tick();

    expect(ran).toEqual(["after"]);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("boom");
  });

  it("a message enqueued while a turn runs waits its turn", async () => {
    const inbox = new Inbox();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    inbox.enqueue(async () => {
      order.push("first-start");
      await gate;
      order.push("first-end");
    });
    // Enqueued while the first is blocked in flight.
    inbox.enqueue(async () => {
      order.push("second");
    });

    await tick();
    expect(order).toEqual(["first-start"]); // second has NOT started
    release();
    while (inbox.depth > 0) await tick();
    await tick();
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });
});

import { describe, expect, it } from "vitest";
import type {
  HelperPtyEvent,
  HelperWatchEvent,
} from "kolu-common/helper-protocol";
import { createManager } from "./manager.ts";

describe("helper manager", () => {
  it("spawns a PTY and emits data events with monotonic seq", async () => {
    const events: (HelperPtyEvent | HelperWatchEvent)[] = [];
    const mgr = createManager((e) => events.push(e));
    const { ptyId, pid } = mgr.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf hello"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(ptyId).toMatch(/^[0-9a-f-]+$/);
    expect(pid).toBeGreaterThan(0);

    // Drain — wait for both the data event and the exit event.
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const tick = (): void => {
        const exitSeen = events.some(
          (e) => e.method === "exit" && e.params.ptyId === ptyId,
        );
        if (exitSeen || Date.now() - start > 2_000) resolve();
        else setTimeout(tick, 20);
      };
      tick();
    });

    const seqs = events
      .filter((e) => "params" in e && "seq" in e.params)
      .map((e) => (e.params as { seq: number }).seq);
    // Must be strictly increasing.
    for (let i = 1; i < seqs.length; i++) {
      const prev = seqs[i - 1];
      const cur = seqs[i];
      if (prev === undefined || cur === undefined) continue;
      expect(cur).toBeGreaterThan(prev);
    }
    mgr.shutdown();
  });

  it("replays only events with seq > sinceSeq", async () => {
    const events: (HelperPtyEvent | HelperWatchEvent)[] = [];
    const mgr = createManager((e) => events.push(e));
    const { ptyId } = mgr.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf a; printf b; printf c"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      env: { PATH: process.env.PATH ?? "" },
    });
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        if (events.some((e) => e.method === "exit")) resolve();
        else setTimeout(tick, 20);
      };
      tick();
    });

    // Replay with sinceSeq=0 must return everything in the ring buffer.
    const all = mgr.replay(ptyId, 0);
    expect(all.length).toBeGreaterThan(0);

    // Replay with sinceSeq = max(seq) must return nothing — no event has
    // a strictly-greater seq.
    const maxSeq = Math.max(
      ...all.map((e) => (e.params as { seq: number }).seq),
    );
    expect(mgr.replay(ptyId, maxSeq)).toEqual([]);
    mgr.shutdown();
  });

  it("dispose removes the PTY from list()", () => {
    const events: (HelperPtyEvent | HelperWatchEvent)[] = [];
    const mgr = createManager((e) => events.push(e));
    const { ptyId } = mgr.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 30"],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(mgr.list()).toHaveLength(1);
    mgr.dispose(ptyId);
    expect(mgr.list()).toHaveLength(0);
  });
});

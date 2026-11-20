import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { Effect } from "effect";
import { afterEach, expect, it } from "vitest";
import {
  createPtyHost,
  type PtyDataItem,
  type PtyHost,
  type PtyId,
} from "./ptyHost.ts";
import { type FrameStream, subscribeFrames } from "./streamFrame.testlib.ts";

const shellEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TERM: "xterm-256color",
};

const SILENT = ["-c", "while :; do sleep 0.05; done"];

const TRAP_READY = "TRAPREADY";

const HUGE_REPRINT_AFTER_A_PAUSE = [
  "-c",
  `trap 'sleep 0.35; head -c 200000 /dev/zero | tr "\\0" R' WINCH; printf ${TRAP_READY}; while :; do sleep 0.05; done`,
];

describeDaemon("PtyHost resized frame", () => {
  let live: PtyHost | undefined;

  afterEach(() => {
    live?.dispose();
    live = undefined;
  });

  function spawn(args: readonly string[]): { host: PtyHost; id: PtyId } {
    const host = createPtyHost({ log: silentLog });
    live = host;
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [...args],
      env: shellEnv,
      cwd: "/tmp",
      cols: 80,
      rows: 24,
    });
    return { host, id };
  }

  async function waitForScreen(
    host: PtyHost,
    id: PtyId,
    marker: string,
  ): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!host.getScreenText(id).includes(marker)) {
      if (Date.now() > deadline) {
        throw new Error(`pty ${id} never printed ${marker}`);
      }
      const tick = Promise.withResolvers<void>();
      setTimeout(() => tick.resolve(), 5);
      await tick.promise;
    }
  }

  async function drain(
    frames: FrameStream<PtyDataItem>,
    ms: number,
  ): Promise<{ items: PtyDataItem[]; drop: { _tag?: string } | undefined }> {
    const items: PtyDataItem[] = [];
    for (;;) {
      try {
        items.push(await frames.next(ms));
      } catch (err) {
        const tagged = err as { _tag?: string };
        return { items, drop: tagged._tag === undefined ? undefined : tagged };
      }
    }
  }

  it("tells every subscriber the new grid, not just the one that asked", async () => {
    const { host, id } = spawn(SILENT);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const a = subscribeFrames((yield* host.attach(id)).deltas);
          const b = subscribeFrames((yield* host.attach(id)).deltas);
          const third = yield* host.attach(id, {
            resizeTo: { cols: 100, rows: 30 },
          });
          expect(third.grid).toEqual({ cols: 100, rows: 30 });

          for (const frames of [a, b]) {
            const item = yield* Effect.promise(() => frames.next(2000));
            expect(item).toEqual({
              kind: "resized",
              grid: { cols: 100, rows: 30 },
            });
            frames.close();
          }
          const ownItems = subscribeFrames(third.deltas);
          const { items } = yield* Effect.promise(() => drain(ownItems, 250));
          expect(items).toEqual([]);
          ownItems.close();
        }),
      ),
    );
  });

  it("says nothing at all when the resize is a no-op", async () => {
    const { host, id } = spawn(SILENT);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas, grid } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          expect(host.resize(id, grid.cols, grid.rows)).toBe(true);
          const { items, drop } = yield* Effect.promise(() =>
            drain(frames, 250),
          );
          expect(items).toEqual([]);
          expect(drop).toBeUndefined();
          frames.close();
        }),
      ),
    );
  });

  it("delivers the new grid even when the repaint it provokes is withheld and discarded", async () => {
    const { host, id } = spawn(HUGE_REPRINT_AFTER_A_PAUSE);
    await waitForScreen(host, id, TRAP_READY);
    const { items, drop } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const frames = subscribeFrames((yield* host.attach(id)).deltas);
          host.resize(id, 100, 30);
          return yield* Effect.promise(() => drain(frames, 6000));
        }),
      ),
    );
    expect(items).toEqual([{ kind: "resized", grid: { cols: 100, rows: 30 } }]);
    expect(drop).toMatchObject({ _tag: "SubscriberInvalidated" });
  });

  it("tells a late subscriber its grid on the snapshot, with no stale resize behind it", async () => {
    const { host, id } = spawn(SILENT);
    expect(host.resize(id, 120, 45)).toBe(true);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const att = yield* host.attach(id);
          expect(att.grid).toEqual({ cols: 120, rows: 45 });
          const frames = subscribeFrames(att.deltas);
          const { items } = yield* Effect.promise(() => drain(frames, 250));
          expect(items).toEqual([]);
          frames.close();
        }),
      ),
    );
  });
});

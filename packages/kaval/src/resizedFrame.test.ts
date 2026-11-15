/**
 * The `resized` FRAME (kolu#2362, contract 9.0) — kaval telling every data
 * subscriber WHERE IN ITS BYTE STREAM the mirror changed size.
 *
 * The defect it closes is a divergence nobody could see: a viewer resized its
 * own terminal when its box moved, the mirror resized when the grid finally
 * reached the host, and every byte written in between was laid out for one grid
 * and parsed at the other. A viewer that resizes AT this frame has applied the
 * same events in the same order as the mirror, so the two screens cannot
 * disagree about a resize at all.
 *
 * What is asserted here is the PUBLISHER's half of that: the frame exists, it
 * carries the grid the mirror actually moved to, it reaches every subscriber
 * rather than only the one that asked, it is never withheld (even when the
 * repaint it provokes is), and a subscriber that attaches after the fact is told
 * its grid on the snapshot instead of being replayed a resize it never missed.
 * The CONSUMER's half — that applying it at that point keeps a pane's screen
 * equal to this mirror's — is `lockstepMirror.test.ts`, beside this one.
 *
 * These spawn real PTYs, so they live under the daemon gate like every other
 * `createPtyHost` suite (the #1375 fork bomb). REAL timers throughout, and
 * deliberately: the subject is a real child's SIGWINCH and the output it writes
 * in response, which a fake clock cannot produce — advancing one would only
 * prove that `setTimeout` fires. Nothing here waits a guessed duration: the
 * polls await a CONDITION (a marker on the mirror) with a deadline, and the
 * drains await a frame.
 */

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

/** Writes nothing at all, ever — so every item a subscriber receives is one
 *  this test caused. */
const SILENT = ["-c", "while :; do sleep 0.05; done"];

/** A child that installs a `SIGWINCH` trap must say when the trap is actually
 *  INSTALLED: a `resize()` issued before then is delivered with the default
 *  action and the trap never runs. */
const TRAP_READY = "TRAPREADY";

/** The AGENT's shape: a pause, then a reprint far larger than the byte budget
 *  (`MIN_DATA_BUDGET_CHARS`, 128 KiB), which makes the resize window decide its
 *  subscribers must re-sync. The size must still reach them first. */
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

  /** Everything a subscription delivered before it ended, and how it ended. */
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
          // Two plain viewers, neither of which asserts a size.
          const a = subscribeFrames((yield* host.attach(id)).deltas);
          const b = subscribeFrames((yield* host.attach(id)).deltas);
          // A THIRD viewer attaches at its own grid, which resizes the shared
          // pty under the other two — the last-attach-wins case that used to
          // reach them as nothing but reflowed bytes.
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
          // The attacher's own snapshot already reflects the resize, so it must
          // NOT also be told about it: that would be one event counted twice,
          // and a consumer applying both would resize a screen it just painted.
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
          // Nothing moved, so there is nothing to be told. A frame here would
          // make every viewer re-measure and repaint for no reason, on every
          // host switch and every mount-time re-publish.
          expect(items).toEqual([]);
          expect(drop).toBeUndefined();
          frames.close();
        }),
      ),
    );
  });

  it("delivers the new grid even when the repaint it provokes is withheld and discarded", async () => {
    // The window's job is to spare a viewer an agent's multi-megabyte reprint;
    // past the budget it gives up and re-syncs everyone instead. The SIZE must
    // not be held hostage to either decision — a viewer that is about to be
    // dropped still needs to know what shape the screen it re-fetches will be,
    // and a viewer whose repaint is merely delayed must not spend that delay
    // painting at the old size.
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
    // Exactly one item reached the viewer, and it is the size — the reprint was
    // withheld and then discarded in favour of a re-sync.
    expect(items).toEqual([{ kind: "resized", grid: { cols: 100, rows: 30 } }]);
    expect(drop).toMatchObject({
      _tag: "SubscriberOverflow",
      reason: "invalidated",
    });
  });

  it("tells a late subscriber its grid on the snapshot, with no stale resize behind it", async () => {
    const { host, id } = spawn(SILENT);
    expect(host.resize(id, 120, 45)).toBe(true);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Attaching AFTER the resize: the snapshot is serialized at the grid
          // the mirror is at now, so the frame is self-describing and there is
          // nothing left to replay. Replaying it would tell this subscriber to
          // resize to a size its own first frame already has.
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

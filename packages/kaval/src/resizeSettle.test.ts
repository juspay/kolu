/**
 * The RESIZE SETTLING WINDOW (kolu#2362) — kaval's answer to "viewing a
 * terminal makes it scroll through its whole scrollback".
 *
 * A real size change does two things here: it drops every data subscriber
 * through the existing overflow path, and it HOLDS any attach that arrives
 * while the program is redrawing. What a viewer gets for a resize is therefore
 * one snapshot of the SETTLED screen, instead of the 0.57–0.97 MB transcript
 * reprint an agent emits on SIGWINCH, streamed byte-for-byte.
 *
 * These spawn real PTYs, so they live under the daemon gate like every other
 * `createPtyHost` suite (the #1375 fork bomb). **Real timers are the subject
 * here, not an accident**: the window closes on the arrival times of a real
 * child's output, which a fake clock cannot produce — advancing it would only
 * prove that `setTimeout` fires. The assertions are therefore wide on purpose:
 * what is pinned is "the quiet path releases in roughly the quiet interval and
 * a PTY that never stops writing is held to roughly the cap", never either
 * constant to the millisecond.
 */

import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { Effect } from "effect";
import { afterEach, expect, it } from "vitest";
import { createPtyHost, type PtyHost, type PtyId } from "./ptyHost.ts";
import { subscribeFrames } from "./streamFrame.testlib.ts";

const shellEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TERM: "xterm-256color",
};

/** A PTY that writes nothing after spawn — so the settling window closes on the
 *  quiet interval. */
const SILENT = ["-c", "sleep 5"];
/** A PTY that writes every 50 ms forever — so every chunk re-arms the quiet
 *  timer and the window can only close at its hard cap. */
const CHATTY = ["-c", "while :; do printf x; sleep 0.05; done"];

describeDaemon("PtyHost resize settling window", () => {
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

  /** Open an attach and report how long it took to answer. The scope is closed
   *  immediately — the subject is WHEN the reading is taken, not the deltas
   *  that follow. */
  async function timeAttach(host: PtyHost, id: PtyId): Promise<number> {
    const started = Date.now();
    await Effect.runPromise(Effect.scoped(host.attach(id)));
    return Date.now() - started;
  }

  it("drops attached viewers on a real resize, through the overflow channel", async () => {
    const { host, id } = spawn(SILENT);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          // A real size change: what this subscriber holds was laid out for a
          // grid that no longer exists, and the repaint that follows is one it
          // should not have to watch arrive.
          host.resize(id, 100, 30);
          yield* Effect.promise(() =>
            expect(frames.next(3000)).rejects.toMatchObject({
              _tag: "SubscriberOverflow",
              reason: "invalidated",
            }),
          );
          frames.close();
        }),
      ),
    );
  });

  it("leaves viewers alone when the resize is a no-op", async () => {
    const { host, id } = spawn(SILENT);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas, grid } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          // Same dimensions: kaval does not SIGWINCH, does not reflow, and must
          // not invalidate anyone — a second viewer attaching at the size the
          // PTY already has costs nothing, which is what makes a host switch
          // free for every tile whose box did not move.
          expect(host.resize(id, grid.cols, grid.rows)).toBe(true);
          // Nothing arrives and nothing FAILS: the subscription is still live,
          // so the pull stalls rather than rejecting with an overflow.
          yield* Effect.promise(() =>
            expect(frames.next(250)).rejects.toThrow(/stall|timed out/i),
          );
          frames.close();
        }),
      ),
    );
    // …and an attach after a no-op resize is not held: there is no window.
    expect(await timeAttach(host, id)).toBeLessThan(250);
  });

  it("holds an attach until the resized PTY goes quiet", async () => {
    const { host, id } = spawn(SILENT);
    // Warm the mirror, so this is the plain case: an existing PTY, a new
    // viewer, and a grid that differs from the one the PTY holds.
    await timeAttach(host, id);
    const started = Date.now();
    host.resize(id, 100, 30);
    await timeAttach(host, id);
    const elapsed = Date.now() - started;
    // Released on SILENCE, not at the cap: a shell that has finished repainting
    // must not cost the viewer the whole mute window.
    expect(elapsed).toBeGreaterThanOrEqual(60);
    expect(elapsed).toBeLessThan(450);
  });

  it("releases a held attach at the cap when the PTY never goes quiet", async () => {
    const { host, id } = spawn(CHATTY);
    await timeAttach(host, id);
    const started = Date.now();
    host.resize(id, 100, 30);
    await timeAttach(host, id);
    const elapsed = Date.now() - started;
    // A progress spinner never stops writing; the hard cap is what keeps the
    // hold from becoming a hang.
    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(elapsed).toBeLessThan(1500);
  });

  it("releases a held attach when the PTY exits mid-settle", async () => {
    const { host, id } = spawn(CHATTY);
    await timeAttach(host, id);
    host.resize(id, 100, 30);
    const parked = Effect.runPromise(Effect.scoped(host.attach(id)));
    // One event-loop turn is enough for the attach fiber to reach its park —
    // `Effect.callback` is an async boundary — and it is a yield rather than a
    // guessed delay, so nothing here is timing-tuned.
    const turn = Promise.withResolvers<void>();
    setImmediate(() => turn.resolve());
    await turn.promise;
    const started = Date.now();
    host.kill(id, "SIGKILL");
    // The PTY is gone, so the honest answer is the one an attach to a gone PTY
    // has always given — never a fiber parked on a window that will not close,
    // and never a wait for the cap this PTY would otherwise have run out.
    await expect(parked).rejects.toMatchObject({ _tag: "PtyNotFound" });
    expect(Date.now() - started).toBeLessThan(450);
  });
});

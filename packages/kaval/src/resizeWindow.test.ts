/**
 * The RESIZE WINDOW (kolu#2362) — kaval's withhold-and-decide answer to
 * "viewing a terminal makes it scroll through its whole scrollback".
 *
 * A real size change opens a window. While it is open, parsed output is held
 * back rather than published; at close, what fits the byte budget is published
 * (nobody is reset) and anything larger becomes a re-sync through the existing
 * overflow path (one snapshot of the settled screen).
 *
 * The shape that matters is the AGENT's, and it is the reason the window does
 * not close on silence: measured on omp 18.18.8, a SIGWINCH produces a few KB
 * within ~4 ms, then **318–375 ms of silence**, and only then the whole
 * multi-megabyte reprint. {@link REPRINT_AFTER_A_PAUSE} is that shape in a
 * shell script, and it is the case a quiet-based window gets wrong.
 *
 * These spawn real PTYs, so they live under the daemon gate like every other
 * `createPtyHost` suite (the #1375 fork bomb). **Real timers are the subject
 * here, not an accident**: the window turns on the arrival times of a real
 * child's output, which a fake clock cannot produce — advancing it would only
 * prove that `setTimeout` fires. The assertions are wide on purpose.
 */

import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { Effect } from "effect";
import { afterEach, expect, it } from "vitest";
import { createPtyHost, type PtyHost, type PtyId } from "./ptyHost.ts";
import { type FrameStream, subscribeFrames } from "./streamFrame.testlib.ts";

const shellEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TERM: "xterm-256color",
};

/** Writes nothing at all, ever — the baseline for "the window is about the
 *  clock, not about output". */
const SILENT = ["-c", "while :; do sleep 0.05; done"];

/** The AGENT's shape: a little output, a ~350 ms pause, then a reprint far
 *  larger than the byte budget (`MIN_DATA_BUDGET_CHARS`, 128 KiB). The trap
 *  runs between loop iterations, so it starts within ~50 ms of the SIGWINCH. */
const REPRINT_AFTER_A_PAUSE = [
  "-c",
  "trap 'printf FIRSTBYTES; sleep 0.35; head -c 200000 /dev/zero | tr \"\\0\" R; printf REPRINTDONE' WINCH; while :; do sleep 0.05; done",
];

/** The PLAIN SHELL's shape: a repaint of a hundred bytes, after the same pause.
 *  It fits the budget, so its viewers must keep everything they had. */
const SMALL_REPAINT_AFTER_A_PAUSE = [
  "-c",
  "trap 'sleep 0.35; printf SMALLREPAINT' WINCH; while :; do sleep 0.05; done",
];

/** Everything a subscription delivered before it ended, and how it ended. A
 *  stream FAILURE carries a `_tag`; the testlib's deadline throws a plain
 *  `Error`, which is a stalled test rather than a drop. */
async function drain(
  frames: FrameStream<string>,
  ms: number,
): Promise<{ text: string; drop: { _tag?: string } | undefined }> {
  let text = "";
  for (;;) {
    try {
      text += await frames.next(ms);
    } catch (err) {
      const tagged = err as { _tag?: string };
      if (tagged._tag === undefined) return { text, drop: undefined };
      return { text, drop: tagged };
    }
  }
}

describeDaemon("PtyHost resize window", () => {
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

  /** Open an attach and report how long it took to answer. The scope closes at
   *  once — the subject is WHEN the reading is taken. */
  async function timeAttach(host: PtyHost, id: PtyId): Promise<number> {
    const started = Date.now();
    await Effect.runPromise(Effect.scoped(host.attach(id)));
    return Date.now() - started;
  }

  it("spares a viewer the agent's reprint, even though the agent pauses first", async () => {
    // THE case this window exists for. omp goes silent for ~350 ms after a
    // SIGWINCH and only then reprints its transcript, so a window that closed
    // on 100 ms of quiet would close BEFORE the reprint and forward all of it.
    const { host, id } = spawn(REPRINT_AFTER_A_PAUSE);
    const { text, drop } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          host.resize(id, 100, 30);
          return yield* Effect.promise(() => drain(frames, 6000));
        }),
      ),
    );
    // Not one byte of the repaint reached the viewer — not the first write
    // before the pause, and not the reprint after it.
    expect(text).not.toContain("FIRSTBYTES");
    expect(text).not.toContain("REPRINTDONE");
    expect(text).toBe("");
    // It is told to re-sync instead, through the channel that already means
    // exactly that.
    expect(drop).toMatchObject({
      _tag: "SubscriberOverflow",
      reason: "invalidated",
    });
    // …and the screen it then attaches to is the SETTLED one: the re-sync costs
    // one snapshot, and that snapshot already contains the reprint.
    const { snapshot } = await Effect.runPromise(
      Effect.scoped(host.attach(id)),
    );
    expect(snapshot).toContain("REPRINTDONE");
  });

  it("keeps a plain shell's viewers whole: the small repaint is delivered, not re-sent", async () => {
    // The regression the drop-everyone design had: a shell's repaint is a
    // hundred bytes, and resetting its viewer for that would cost it a
    // snapshot, its scrollback above the bounded window, its selection and its
    // scroll position. Under the budget, the window simply hands the bytes over.
    const { host, id } = spawn(SMALL_REPAINT_AFTER_A_PAUSE);
    const started = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          const t0 = Date.now();
          host.resize(id, 100, 30);
          let text = "";
          while (!text.includes("SMALLREPAINT")) {
            text += yield* Effect.promise(() => frames.next(4000));
          }
          frames.close();
          return t0;
        }),
      ),
    );
    // Delivered, and delivered LATE — withheld for the window rather than
    // forwarded as it arrived.
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
  });

  it("does not close on silence before the window's own span", async () => {
    // A silent PTY is the cheapest proof that the window is a CLOCK from the
    // resize, not a quiet detector: nothing arrives to extend it, and an attach
    // parked inside it still waits the full span.
    const { host, id } = spawn(SILENT);
    await timeAttach(host, id);
    host.resize(id, 100, 30);
    const parked = await timeAttach(host, id);
    expect(parked).toBeGreaterThanOrEqual(450);
    expect(parked).toBeLessThan(1500);
  });

  it("does not delay the attach that opens the window", async () => {
    // An attach whose own `resizeTo` opens a FRESH window subscribes and
    // serializes at once: nothing has been withheld yet, so first paint costs
    // what it always did.
    const { host, id } = spawn(SILENT);
    await timeAttach(host, id);
    const started = Date.now();
    await Effect.runPromise(
      Effect.scoped(host.attach(id, { resizeTo: { cols: 100, rows: 30 } })),
    );
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("leaves viewers alone when the resize is a no-op", async () => {
    const { host, id } = spawn(SILENT);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas, grid } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          // Same dimensions: kaval does not SIGWINCH, does not reflow, and opens
          // no window — which is what makes a host switch free for every tile
          // whose box did not move.
          expect(host.resize(id, grid.cols, grid.rows)).toBe(true);
          const { text, drop } = yield* Effect.promise(() =>
            drain(frames, 250),
          );
          expect(text).toBe("");
          expect(drop).toBeUndefined();
          frames.close();
        }),
      ),
    );
    expect(await timeAttach(host, id)).toBeLessThan(250);
  });

  it("releases a parked attach when the PTY exits mid-window", async () => {
    const { host, id } = spawn(SILENT);
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
    // and never a wait for the span this window would otherwise have run out.
    await expect(parked).rejects.toMatchObject({ _tag: "PtyNotFound" });
    expect(Date.now() - started).toBeLessThan(450);
  });
});

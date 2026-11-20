import { STREAM_RETRY_DELAY_MS } from "@kolu/surface/client";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
} from "@kolu/surface/heartbeat";
import { Duration, Effect, Schedule, Stream } from "effect";
import { toast } from "solid-sonner";
import { isDeclared, TERMINAL_NOT_FOUND } from "../rpc/declaredErrors";

/** How long to wait before re-subscribing after an abnormal end. Exported for
 *  `Terminal.tsx`'s `reassertWantedGrid`, which reopens at the same spacing. */
export const REATTACH_BACKOFF_MS = 300;

/** How long a CLEAN end waits for the tile's own exit facts to land before it
 *  calls that end unexpected. */
const EXIT_SETTLE_MS = REATTACH_BACKOFF_MS;

/** How many re-attaches a CLEAN end may buy in one EPISODE. */
const CLEAN_END_REATTACH_BUDGET = 1;

/** padi's post-reconvergence re-open ladder: `REATTACH_PAUSE_MS` doubled over
 *  `PLAIN_END_REOPEN_ATTEMPTS` (150 + 300 + 600), spent before padi has even
 *  asked kaval. Spelled out rather than imported — padi's `terminalEndpoint` is
 *  not a package entry point. */
const PADI_REOPEN_LADDER_MS = 150 + 300 + 600;

/** The point before which tearing an attach down would preempt the repairs it
 *  depends on: the heartbeat's worst-case half-open detection (one interval
 *  plus one timeout), one fence retry, and padi's ladder. */
const UPSTREAM_REPAIR_CEILING_MS =
  DEFAULT_HEARTBEAT_INTERVAL_MS +
  DEFAULT_HEARTBEAT_TIMEOUT_MS +
  STREAM_RETRY_DELAY_MS +
  PADI_REOPEN_LADDER_MS;

/** The room left above those repairs for the one term nothing here can bound:
 *  snapshot serialization, which scales with scrollback. */
const SNAPSHOT_SERIALIZATION_HEADROOM_MS = 17_950;

/** How long an attach attempt has to deliver its FIRST frame before the silence
 *  itself is the verdict. A CEILING, not a timeout: the re-attach it triggers
 *  abandons the snapshot in flight, so an honest first frame slower than this
 *  never lands.
 *
 *  Effect's `makeProtocolSocket` swallows pre-open SocketOpenError retries
 *  (leaving registered calls pending) and broadcasts the pinger's
 *  SocketReadError, so an established socket's ping timeout fails them —
 *  measured by packages/surface/src/links/socketRedialLaws.test.ts. */
const FIRST_FRAME_DEADLINE_MS =
  UPSTREAM_REPAIR_CEILING_MS + SNAPSHOT_SERIALIZATION_HEADROOM_MS;

/** How many re-attaches a SILENT open may buy in one EPISODE. */
const FIRST_FRAME_REATTACH_BUDGET = 1;

/** How many consecutive re-attach cycles may produce NO first frame before the
 *  loop says so out loud. */
const FRUITLESS_CYCLE_VERDICT = 200;

/** The re-attach spacing after a verdict. */
const DEMOTED_RETRY_MS = 30_000;

/** A clean stream end for a tile that has NOT been told its PTY exited, raised
 *  into the loop's own error channel. */
class AttachEndedWhileLive extends Error {
  constructor(label: string) {
    super(
      `${label}: the attach stream ended cleanly while the terminal is still live — re-attaching`,
    );
    this.name = "AttachEndedWhileLive";
  }
}

/** An attach attempt that OPENED and then said nothing at all. */
class AttachFirstFrameDeadline extends Error {
  constructor(label: string, deadlineMs: number) {
    super(
      `${label}: the attach stream opened but delivered no frame within ${deadlineMs}ms — re-attaching`,
    );
    this.name = "AttachFirstFrameDeadline";
  }
}

/** The tile facts this loop reads back before acting on an end. */
export interface AttachTileFacts {
  /** Does this tile KNOW its PTY is gone? An unknown answer reads as live. */
  hasExited: () => boolean;
}

/** The two recoverable stops this loop raises itself: channel 2, the one a
 *  re-attach follows. A `throw` out of `streamFn` or `onItem` is a defect and
 *  never reaches here. */
type AttachStop = AttachEndedWhileLive | AttachFirstFrameDeadline;

/** One EPISODE of re-attaching: the budgets a chain may spend before the loop
 *  says so out loud, and the spacing it falls back to once it has. An attempt
 *  that delivers a first frame has proved the chain end to end and REFILLS the
 *  episode, so nothing counted here can end a pane — only slow it down. */
function createAttachEpisode(label: string) {
  let cleanEndSpend = 0;
  let silentOpenSpend = 0;
  let fruitlessCycles = 0;
  let demoted = false;
  let spoken = false;

  const speak = (reason: string): Effect.Effect<void> =>
    Effect.sync(() => {
      demoted = true;
      if (spoken) return;
      spoken = true;
      console.error(
        `${label}: ${reason} — kolu keeps re-attaching, now every ${DEMOTED_RETRY_MS / 1_000}s instead of every ${REATTACH_BACKOFF_MS}ms`,
      );
      toast.error(
        `${label}: no output is reaching this pane. kolu is still retrying in the background.`,
        { id: `attach-stalled:${label}` },
      );
    });

  return {
    refill: (): void => {
      cleanEndSpend = 0;
      silentOpenSpend = 0;
      fruitlessCycles = 0;
      demoted = false;
      spoken = false;
    },
    spendCleanEnd: (): Effect.Effect<void> => {
      const said =
        cleanEndSpend >= CLEAN_END_REATTACH_BUDGET
          ? speak(
              `the attach stream ended cleanly ${cleanEndSpend + 1} times with the terminal still live — the chain is manufacturing stream ends`,
            )
          : Effect.void;
      cleanEndSpend++;
      return said;
    },
    spendSilentOpen: (): Effect.Effect<void> => {
      const said =
        silentOpenSpend >= FIRST_FRAME_REATTACH_BUDGET
          ? speak(
              `the attach stream opened silent ${silentOpenSpend + 1} times — the chain is delivering no frames (no first frame within ${FIRST_FRAME_DEADLINE_MS}ms)`,
            )
          : Effect.void;
      silentOpenSpend++;
      return said;
    },
    countFruitlessCycle: (): Effect.Effect<void> => {
      fruitlessCycles++;
      return fruitlessCycles >= FRUITLESS_CYCLE_VERDICT
        ? speak(
            `${fruitlessCycles} consecutive re-attach cycles have produced no first frame`,
          )
        : Effect.void;
    },
    retryDelayMs: (): number =>
      demoted ? DEMOTED_RETRY_MS : REATTACH_BACKOFF_MS,
  };
}

/** Consume a terminal-attach stream, re-subscribing after an abnormal end, a
 *  clean end the tile's own facts do not corroborate, or a silent open. Ends on
 *  the declared `TerminalNotFound`. */
export function consumeReattachingStream<T>(
  streamFn: () => Stream.Stream<T, unknown>,
  /** Consume the frame. A throw here is a defect. */
  onItem: (item: T) => void,
  onReattach: () => void,
  label: string,
  tile: AttachTileFacts,
): Effect.Effect<void, unknown> {
  const episode = createAttachEpisode(label);
  let attemptSawFrame = false;

  const classifyCleanEnd: Effect.Effect<void, AttachStop> = Effect.suspend(
    () => {
      if (tile.hasExited()) return Effect.void;
      return Effect.sleep(EXIT_SETTLE_MS).pipe(
        Effect.flatMap(() =>
          Effect.suspend(() => {
            if (tile.hasExited()) return Effect.void;
            return Effect.flatMap(episode.spendCleanEnd(), () =>
              Effect.fail(new AttachEndedWhileLive(label)),
            );
          }),
        ),
      );
    },
  );

  const silentOpenVerdict: Effect.Effect<never, AttachStop> = Effect.suspend(
    () =>
      Effect.flatMap(episode.spendSilentOpen(), () =>
        Effect.fail(
          new AttachFirstFrameDeadline(label, FIRST_FRAME_DEADLINE_MS),
        ),
      ),
  );

  const oneAttempt = Effect.suspend(() => {
    attemptSawFrame = false;
    const consume = Stream.runForEach(Stream.suspend(streamFn), (item) =>
      Effect.sync(() => {
        if (!attemptSawFrame) {
          attemptSawFrame = true;
          episode.refill();
        }
        onItem(item);
      }),
    );
    const firstFrameWatch = Effect.sleep(FIRST_FRAME_DEADLINE_MS).pipe(
      Effect.flatMap(() =>
        attemptSawFrame ? Effect.never : silentOpenVerdict,
      ),
    );
    return Effect.raceFirst(consume, firstFrameWatch);
  });

  return oneAttempt.pipe(
    Effect.flatMap(() => classifyCleanEnd),
    Effect.catch((err) =>
      isDeclared(err, TERMINAL_NOT_FOUND)
        ? Effect.sync(() => {
            console.info(`${label}: the terminal is gone — attach loop ended`);
          })
        : Effect.fail(err),
    ),
    Effect.tapError(() =>
      Effect.suspend(() =>
        attemptSawFrame ? Effect.void : episode.countFruitlessCycle(),
      ),
    ),
    Effect.tapError((err) =>
      Effect.sync(() => {
        console.warn(`${label}: re-attaching`, err);
        try {
          onReattach();
        } catch (resetErr) {
          console.error(
            `${label}: the pre-re-attach reset threw — re-attaching anyway`,
            resetErr,
          );
        }
      }),
    ),
    Effect.retry(
      Schedule.spaced(REATTACH_BACKOFF_MS).pipe(
        Schedule.modifyDelay(() =>
          Effect.sync(() => Duration.millis(episode.retryDelayMs())),
        ),
      ),
    ),
  );
}

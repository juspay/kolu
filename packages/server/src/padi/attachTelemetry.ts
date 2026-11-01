/**
 * Terminal-attach telemetry — the journald line that says what a host switch
 * cost on the wire.
 *
 * Switching the active host tears every tile down and mounts the new host's
 * terminals from scratch; each tile opens a `terminalAttach` stream whose first
 * frame is a serialized screen snapshot (up to `SNAPSHOT_SCROLLBACK` lines of
 * scrollback), relayed from that host's padi — over ssh for a remote host. So a
 * switch IS a burst of attach subscriptions on one host, and the questions an
 * operator asks afterwards ("why did naiveintent take so long to paint?") are
 * questions about that burst: how many attaches, how big the snapshots were,
 * how long the host took to answer the first and the last of them, and how
 * many the client gave up on before an answer came (a tile that re-measured
 * its grid interrupts its attach and opens another — a second round the user
 * waits for twice). None of that was logged: kolu-server's padi re-serve logs
 * link life (connects, faults) and nothing per subscription.
 *
 * This wraps ONE host's per-entry dispatch (the `mirror` arm of
 * `entryDispatch`) and observes `terminalAttach` subscriptions as they pass:
 * each is stamped at subscribe, at its first frame, and at its end. Attaches
 * that open within {@link ATTACH_BURST_QUIET_MS} of each other on the same host
 * fold into one burst, which is reported as ONE `info` line once the host has
 * answered (or ended) every attach in it — or at {@link ATTACH_BURST_CAP_MS},
 * whichever is first, so a host that never answers is still reported, with the
 * unanswered count on the line. A lone attach (a single new terminal) is a
 * burst of one and reports at `debug`, so the `info` channel carries switches
 * and restores, not every tile ever opened. Per-attach first frames ride
 * `debug` too, for the per-terminal breakdown when a burst line points at a
 * problem.
 *
 * Observation only: frames pass through untouched, the wrapper never
 * subscribes or interrupts upstream on its own, and a non-attach tag is handed
 * to the wrapped dispatch unchanged. The snapshot size is measured in UTF-16
 * code units of the serialized VT text (`data.length`), the number xterm
 * parses — ASCII-heavy, so bytes in all but name.
 */

import type { Logger } from "@kolu/log";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { Cause, Effect, type Exit, Stream } from "effect";

/** The entry-member tag a terminal attach arrives at the per-host dispatch under
 *  (`serveHostMap` has already stripped the map envelope). */
export const TERMINAL_ATTACH_TAG = "surface/terminalAttach/get";

/** Attaches opening within this long of the previous one on the same host are
 *  one burst. A switch to a 20-tile host opens its attaches over ~100 ms, and
 *  a tile that re-measures reopens 300 ms later (`REATTACH_BACKOFF_MS`), so a
 *  gap this wide keeps a whole switch — second rounds included — in one line. */
export const ATTACH_BURST_QUIET_MS = 1500;

/** The longest a burst waits for its last first-frame before reporting anyway.
 *  Past this the line reports what came and how many attaches never answered. */
export const ATTACH_BURST_CAP_MS = 30_000;

export interface AttachTelemetryOptions {
  /** The host, in the canonical `encodeHostKey` spelling the other padi log
   *  lines carry, so one `grep` collects a host's whole story. */
  host: string;
  log: Logger;
  /** Millisecond clock; `Date.now` outside tests. */
  now?: () => number;
  quietMs?: number;
  capMs?: number;
}

interface AttachRecord {
  terminalId: string;
  openedAt: number;
  firstFrameAt: number | undefined;
  firstFrameKind: string | undefined;
  snapshotChars: number;
  endedAt: number | undefined;
  endedBy: "end" | "failure" | "interrupt" | undefined;
}

interface Burst {
  startedAt: number;
  lastOpenedAt: number;
  attaches: AttachRecord[];
  /** Set once no attach has opened for `quietMs`. */
  quiet: boolean;
  quietTimer: ReturnType<typeof setTimeout> | undefined;
  capTimer: ReturnType<typeof setTimeout>;
}

const answered = (a: AttachRecord): boolean =>
  a.firstFrameAt !== undefined || a.endedAt !== undefined;

const terminalIdOf = (payload: unknown): string => {
  if (typeof payload === "object" && payload !== null && "id" in payload) {
    const id = (payload as { id: unknown }).id;
    if (typeof id === "string") return id;
  }
  return "?";
};

const frameFacts = (
  frame: unknown,
): { kind: string | undefined; chars: number } => {
  if (typeof frame !== "object" || frame === null) {
    return { kind: undefined, chars: 0 };
  }
  const f = frame as { kind?: unknown; data?: unknown };
  return {
    kind: typeof f.kind === "string" ? f.kind : undefined,
    chars: typeof f.data === "string" ? f.data.length : 0,
  };
};

const quantiles = (
  xs: readonly number[],
): { min: number; median: number; max: number } | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return {
    min: s[0] as number,
    median: s[Math.floor((s.length - 1) / 2)] as number,
    max: s[s.length - 1] as number,
  };
};

/** Wrap one host's dispatch so its `terminalAttach` subscriptions are timed and
 *  reported per burst. Every other tag passes straight through. */
export function withAttachTelemetry(
  dispatch: SurfaceDispatch,
  opts: AttachTelemetryOptions,
): SurfaceDispatch {
  const now = opts.now ?? Date.now;
  const quietMs = opts.quietMs ?? ATTACH_BURST_QUIET_MS;
  const capMs = opts.capMs ?? ATTACH_BURST_CAP_MS;
  let burst: Burst | undefined;

  const report = (b: Burst, why: "answered" | "cap"): void => {
    const t = now();
    const firstFrames = b.attaches.filter((a) => a.firstFrameAt !== undefined);
    const snapshots = firstFrames.filter(
      (a) => a.firstFrameKind === "snapshot",
    );
    const unanswered = b.attaches.filter((a) => !answered(a));
    const endedBeforeFrame = b.attaches.filter(
      (a) => a.firstFrameAt === undefined && a.endedAt !== undefined,
    );
    const line = {
      host: opts.host,
      attaches: b.attaches.length,
      terminals: new Set(b.attaches.map((a) => a.terminalId)).size,
      snapshots: snapshots.length,
      snapshotChars: snapshots.reduce((n, a) => n + a.snapshotChars, 0),
      firstFrameMs: quantiles(
        firstFrames.map((a) => (a.firstFrameAt as number) - a.openedAt),
      ),
      interruptedBeforeFrame: endedBeforeFrame.filter(
        (a) => a.endedBy === "interrupt",
      ).length,
      failedBeforeFrame: endedBeforeFrame.filter((a) => a.endedBy === "failure")
        .length,
      endedBeforeFrame: endedBeforeFrame.filter((a) => a.endedBy === "end")
        .length,
      unanswered: unanswered.length,
      openedOverMs: b.lastOpenedAt - b.startedAt,
      settledMs:
        why === "cap"
          ? null
          : Math.max(
              0,
              ...b.attaches.map(
                (a) => (a.firstFrameAt ?? a.endedAt ?? t) - b.startedAt,
              ),
            ),
      reportedAfterMs: t - b.startedAt,
      why,
    };
    (b.attaches.length > 1 ? opts.log.info : opts.log.debug).call(
      opts.log,
      line,
      "terminal attach burst",
    );
  };

  const close = (why: "answered" | "cap"): void => {
    if (burst === undefined) return;
    const b = burst;
    burst = undefined;
    if (b.quietTimer !== undefined) clearTimeout(b.quietTimer);
    clearTimeout(b.capTimer);
    report(b, why);
  };

  const maybeClose = (): void => {
    if (burst === undefined || !burst.quiet) return;
    if (burst.attaches.every(answered)) close("answered");
  };

  const armQuiet = (b: Burst): void => {
    if (b.quietTimer !== undefined) clearTimeout(b.quietTimer);
    b.quietTimer = setTimeout(() => {
      b.quietTimer = undefined;
      b.quiet = true;
      maybeClose();
    }, quietMs);
  };

  const open = (terminalId: string): AttachRecord => {
    const t = now();
    if (burst === undefined) {
      burst = {
        startedAt: t,
        lastOpenedAt: t,
        attaches: [],
        quiet: false,
        quietTimer: undefined,
        capTimer: setTimeout(() => close("cap"), capMs),
      };
    }
    const b = burst;
    const rec: AttachRecord = {
      terminalId,
      openedAt: t,
      firstFrameAt: undefined,
      firstFrameKind: undefined,
      snapshotChars: 0,
      endedAt: undefined,
      endedBy: undefined,
    };
    b.attaches.push(rec);
    b.lastOpenedAt = t;
    b.quiet = false;
    armQuiet(b);
    return rec;
  };

  const onFrame = (rec: AttachRecord, frame: unknown): void => {
    if (rec.firstFrameAt !== undefined) return;
    const t = now();
    const { kind, chars } = frameFacts(frame);
    rec.firstFrameAt = t;
    rec.firstFrameKind = kind;
    rec.snapshotChars = kind === "snapshot" ? chars : 0;
    opts.log.debug(
      {
        host: opts.host,
        terminalId: rec.terminalId,
        kind,
        snapshotChars: rec.snapshotChars,
        firstFrameMs: t - rec.openedAt,
      },
      "terminal attach: first frame",
    );
    maybeClose();
  };

  const onExit = (
    rec: AttachRecord,
    exit: Exit.Exit<unknown, unknown>,
  ): void => {
    if (rec.endedAt !== undefined) return;
    rec.endedAt = now();
    rec.endedBy =
      exit._tag === "Success"
        ? "end"
        : Cause.hasInterruptsOnly(exit.cause)
          ? "interrupt"
          : "failure";
    maybeClose();
  };

  return {
    unary: dispatch.unary,
    stream: (tag, payload) =>
      tag !== TERMINAL_ATTACH_TAG
        ? dispatch.stream(tag, payload)
        : // Per SUBSCRIBE, not per stream value: a retry re-subscribes and is a
          // fresh attach on the wire, so it gets its own record.
          Stream.suspend(() => {
            const rec = open(terminalIdOf(payload));
            return dispatch.stream(tag, payload).pipe(
              Stream.tap((frame) => Effect.sync(() => onFrame(rec, frame))),
              Stream.onExit((exit) => Effect.sync(() => onExit(rec, exit))),
            );
          }),
  };
}

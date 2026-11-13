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
 * WHAT AN ATTACHMENT COSTS AFTER ITS FIRST FRAME. A burst line closes within a
 * second or two of the switch that opened it, while the attachments it reports
 * live for minutes, so the bytes they go on to carry cannot ride it. Each
 * attachment therefore reports ONCE MORE, at its END, as `terminal attach:
 * end` — a `debug` sibling of the per-attach first-frame line, named so that
 * one `grep 'terminal attach'` collects a terminal's whole story: the snapshot
 * it opened with, the `deltaChars` it forwarded afterwards, and its
 * `skipAheads`, the `snapshot` frames AFTER the first. Each of those is kaval
 * dropping a viewer that fell behind and re-syncing it from a fresh screen, so
 * it names a replay this viewer skipped rather than read — the one number that
 * separates "this attachment was cheap" from "this attachment was cheap
 * because the host gave up on it".
 *
 * DID VIEWING RESIZE ANYTHING. A `terminalAttach` subscribe MAY carry a
 * `resizeTo`, and that resizes the PTY: looking at a terminal can reshape it,
 * and every other viewer eats the reflow. Three causes ask for a grid at this
 * hop and the line keeps them apart: `attach` (an ordinary open), `foreign`
 * (the same open, re-asserted by the client's foreign-grid watcher — the attach
 * input's own `cause` key is what says which), and `publish` (a deliberate
 * `lifecycle.resize` from a pane). Only a REAL resize counts: kaval no-ops a
 * resize to the size a PTY already has, so counting every `resizeTo` would
 * report a host switch's 14 no-op re-assertions as 14 resizes. This wrapper
 * never sees kaval's answer, so it remembers the last grid ASKED FOR per
 * terminal and counts a cause only when the request differs from it. The first
 * observation of a terminal is consequently a baseline and not a resize — the
 * wrapper does not know what the PTY was before it was watching, and an honest
 * unknown beats a fabricated count. The tally rides the burst line (what this
 * host's viewing cost during that burst, which is the question a host switch
 * raises) and the per-attachment end line (the terminal's cumulative count), so
 * the bytes and the resizes that caused them are read together.
 *
 * Observation only: frames pass through untouched, the wrapper never subscribes
 * or interrupts upstream on its own, the `lifecycle.resize` it counts is
 * forwarded unchanged and its answer is never read, and every other tag —
 * stream or unary — is handed to the wrapped dispatch as it arrived. Sizes are
 * measured in UTF-16 code units of the serialized VT text (`data.length`), the
 * number xterm parses — ASCII-heavy, so bytes in all but name; the snapshot's
 * characters and the deltas' are the same measure, taken the same way.
 */

import type { Logger } from "@kolu/log";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { Cause, Effect, type Exit, Stream } from "effect";

/** The entry-member tag a terminal attach arrives at the per-host dispatch under
 *  (`serveHostMap` has already stripped the map envelope). */
export const TERMINAL_ATTACH_TAG = "surface/terminalAttach/get";

/** The entry-member tag a deliberate grid publish arrives under. `lifecycle` is
 *  a PROCEDURE namespace, so its wire tag is the same `<prefix><member>/<verb>`
 *  algebra `surfaceTag` mints the attach stream's at, with the map envelope
 *  likewise already stripped. */
export const LIFECYCLE_RESIZE_TAG = "surface/lifecycle/resize";

/** How many terminals' grids one host's wrapper remembers. A host shows tens of
 *  tiles at once but MINTS terminal ids forever — every create, every restore —
 *  so the map grows with the host's history, not with its screen, and a server
 *  that runs for weeks would grow it without limit. This is `ptyHost.ts`'s
 *  `MAX_EXIT_TOMBSTONES` bound in the same shape and for the same reason: a
 *  tiny per-entry record, kept for far more terminals than any session holds,
 *  dropped least-recently-OBSERVED first. Eviction costs exactly one
 *  re-baselined terminal — its next grid reads as a first observation and is
 *  not counted — and the entry that goes is the terminal nobody has attached to
 *  or resized in 512 others, which is the cheapest baseline on the host to
 *  lose. */
const MAX_TRACKED_TERMINALS = 512;

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

/** A terminal's grid, as this wrapper reads one off a wire payload. */
interface Grid {
  cols: number;
  rows: number;
}

/** Who asked a PTY to change shape. `attach` and `foreign` are the two readings
 *  of one wire event — a `terminalAttach` subscribe carrying `resizeTo` — told
 *  apart by the attach input's `cause` key; `publish` is a `lifecycle.resize`
 *  call, a pane publishing its grid on purpose rather than as a side effect of
 *  being looked at. */
type ResizeCause = "attach" | "foreign" | "publish";

type ResizeTally = { [C in ResizeCause]: number };

const noTally = (): ResizeTally => ({ attach: 0, foreign: 0, publish: 0 });

interface TerminalResizes {
  /** The last grid this wrapper saw ASKED FOR, by any cause — never kaval's
   *  answer, which this hop does not get. `undefined` until the first
   *  observation, which is the baseline (see the header). */
  grid: Grid | undefined;
  /** Real resizes counted for this terminal since the wrapper first saw it. */
  tally: ResizeTally;
}

interface AttachRecord {
  terminalId: string;
  openedAt: number;
  firstFrameAt: number | undefined;
  firstFrameKind: string | undefined;
  snapshotChars: number;
  /** Characters forwarded in `delta` frames over this attachment's whole life,
   *  in the UTF-16 code units `snapshotChars` is measured in. */
  deltaChars: number;
  /** `snapshot` frames seen. The first is the attachment's own; every further
   *  one is an overflow re-sync, so the end line reports `snapshots - 1`. */
  snapshots: number;
  /** The terminal's resize counters, bound at open and held by REFERENCE — so
   *  an attachment outliving its map entry's eviction still reports the
   *  counters it was counting into, rather than a fresh row of zeroes. */
  resizes: TerminalResizes;
  endedAt: number | undefined;
  endedBy: "end" | "failure" | "interrupt" | undefined;
}

interface Burst {
  startedAt: number;
  lastOpenedAt: number;
  attaches: AttachRecord[];
  /** Real resizes this host saw while the burst was open, by cause. */
  resizes: ResizeTally;
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

/** A `{ cols, rows }` read off whatever shape carries it — the attach input's
 *  `resizeTo`, or `lifecycle.resize`'s own input, which spells the two beside
 *  the id. Defensive in the same key as {@link terminalIdOf}: this hop relays
 *  wire payloads it does not decode, so a shape it cannot read is no grid
 *  rather than a crash in a telemetry wrapper. */
const gridIn = (value: unknown): Grid | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const g = value as { cols?: unknown; rows?: unknown };
  return typeof g.cols === "number" && typeof g.rows === "number"
    ? { cols: g.cols, rows: g.rows }
    : undefined;
};

/** Which cause an attach's `resizeTo` counts under. The client marks a
 *  foreign-grid re-assert with `cause: "foreign"`; everything else reads as the
 *  ordinary open it is indistinguishable from — including a peer that strips
 *  the optional key, which is every client older than the contract that added
 *  it. That degradation is the whole reason the key needs no version bump. */
const attachCauseOf = (payload: unknown): ResizeCause => {
  if (typeof payload === "object" && payload !== null && "cause" in payload) {
    if (payload.cause === "foreign") return "foreign";
  }
  return "attach";
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
 *  reported per burst, and the PTY resizes its calls ask for are counted by
 *  cause. Every other tag passes straight through. */
export function withAttachTelemetry(
  dispatch: SurfaceDispatch,
  opts: AttachTelemetryOptions,
): SurfaceDispatch {
  const now = opts.now ?? Date.now;
  const quietMs = opts.quietMs ?? ATTACH_BURST_QUIET_MS;
  const capMs = opts.capMs ?? ATTACH_BURST_CAP_MS;
  let burst: Burst | undefined;
  /** Per-terminal last-asked grid and resize counters, bounded by
   *  {@link MAX_TRACKED_TERMINALS}. */
  const terminals = new Map<string, TerminalResizes>();

  /** A terminal's record, created on first sight and touched for LRU order. */
  const terminalResizes = (terminalId: string): TerminalResizes => {
    const found = terminals.get(terminalId);
    if (found !== undefined) {
      // Re-inserting is what makes the bound least-recently-OBSERVED rather
      // than oldest-created: a `Map.set` over a key that is already there keeps
      // its original position, so a terminal somebody has watched all day would
      // age out ahead of one created later and never looked at again.
      terminals.delete(terminalId);
      terminals.set(terminalId, found);
      return found;
    }
    const fresh: TerminalResizes = { grid: undefined, tally: noTally() };
    terminals.set(terminalId, fresh);
    if (terminals.size > MAX_TRACKED_TERMINALS) {
      const oldest = terminals.keys().next().value;
      if (oldest !== undefined) terminals.delete(oldest);
    }
    return fresh;
  };

  /** Note a grid somebody asked a terminal to be at, counting `cause` only when
   *  the request CHANGES the grid — kaval no-ops the rest, and the first grid a
   *  terminal is seen at is a baseline rather than a resize (see the header's
   *  "DID VIEWING RESIZE ANYTHING"). */
  const noteGrid = (
    rec: TerminalResizes,
    grid: Grid,
    cause: ResizeCause,
  ): void => {
    const prev = rec.grid;
    rec.grid = grid;
    if (prev === undefined) return;
    if (prev.cols === grid.cols && prev.rows === grid.rows) return;
    rec.tally[cause] += 1;
    // A resize with no burst open — a pane publishing its grid while nobody is
    // attaching — is counted for the terminal and rides its next end line. The
    // burst line reports its own window and stays honest about the rest.
    if (burst !== undefined) burst.resizes[cause] += 1;
  };

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
      /** Real PTY resizes this host saw while the burst was open, by cause —
       *  the "did viewing resize anything" half of the line. */
      resizes: { ...b.resizes },
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

  const open = (payload: unknown): AttachRecord => {
    const t = now();
    if (burst === undefined) {
      burst = {
        startedAt: t,
        lastOpenedAt: t,
        attaches: [],
        resizes: noTally(),
        quiet: false,
        quietTimer: undefined,
        capTimer: setTimeout(() => close("cap"), capMs),
      };
    }
    const b = burst;
    const terminalId = terminalIdOf(payload);
    const resizes = terminalResizes(terminalId);
    const rec: AttachRecord = {
      terminalId,
      openedAt: t,
      firstFrameAt: undefined,
      firstFrameKind: undefined,
      snapshotChars: 0,
      deltaChars: 0,
      snapshots: 0,
      resizes,
      endedAt: undefined,
      endedBy: undefined,
    };
    b.attaches.push(rec);
    b.lastOpenedAt = t;
    b.quiet = false;
    armQuiet(b);
    // The grid is noted only AFTER the burst exists, so an attach that opens
    // one is counted on the line that burst goes on to report. An attach
    // carrying no `resizeTo` is an observe-only viewer: it asks for nothing, so
    // it moves no grid and can never be the cause of a resize.
    const asked =
      typeof payload === "object" && payload !== null && "resizeTo" in payload
        ? gridIn(payload.resizeTo)
        : undefined;
    if (asked !== undefined) noteGrid(resizes, asked, attachCauseOf(payload));
    return rec;
  };

  const onFrame = (rec: AttachRecord, frame: unknown): void => {
    const { kind, chars } = frameFacts(frame);
    // Counted on EVERY frame, not just the first: these two are the
    // attachment's running cost, and they are reported when it ends.
    if (kind === "delta") rec.deltaChars += chars;
    else if (kind === "snapshot") rec.snapshots += 1;
    if (rec.firstFrameAt !== undefined) return;
    const t = now();
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
    const t = now();
    rec.endedAt = t;
    rec.endedBy =
      exit._tag === "Success"
        ? "end"
        : Cause.hasInterruptsOnly(exit.cause)
          ? "interrupt"
          : "failure";
    opts.log.debug(
      {
        host: opts.host,
        terminalId: rec.terminalId,
        snapshotChars: rec.snapshotChars,
        deltaChars: rec.deltaChars,
        // The attachment's OWN opening snapshot is not a skip; every further
        // one re-synced this viewer after kaval dropped it.
        skipAheads: Math.max(0, rec.snapshots - 1),
        // The TERMINAL's cumulative count, not this attachment's share: the
        // bytes above and the resizes that caused them read together.
        resizes: { ...rec.resizes.tally },
        livedMs: t - rec.openedAt,
        endedBy: rec.endedBy,
      },
      "terminal attach: end",
    );
    maybeClose();
  };

  return {
    unary: (tag, payload) =>
      tag !== LIFECYCLE_RESIZE_TAG
        ? dispatch.unary(tag, payload)
        : // Per CALL, not per construction: `unary` answers a LAZY Effect, and
          // one nobody runs is a resize nobody asked for. The call itself is
          // forwarded untouched and its answer is never read.
          Effect.suspend(() => {
            const asked = gridIn(payload);
            if (asked !== undefined) {
              const rec = terminalResizes(terminalIdOf(payload));
              noteGrid(rec, asked, "publish");
            }
            return dispatch.unary(tag, payload);
          }),
    stream: (tag, payload) =>
      tag !== TERMINAL_ATTACH_TAG
        ? dispatch.stream(tag, payload)
        : // Per SUBSCRIBE, not per stream value: a retry re-subscribes and is a
          // fresh attach on the wire, so it gets its own record.
          Stream.suspend(() => {
            const rec = open(payload);
            return dispatch.stream(tag, payload).pipe(
              Stream.tap((frame) => Effect.sync(() => onFrame(rec, frame))),
              Stream.onExit((exit) => Effect.sync(() => onExit(rec, exit))),
            );
          }),
  };
}

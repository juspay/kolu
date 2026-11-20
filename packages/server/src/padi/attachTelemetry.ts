import type { Logger } from "@kolu/log";
import {
  ATTACH_CAUSES,
  type PadiSurfaceSpec,
  padiSurface,
} from "@kolu/padi-client/surface";
import { surfaceTag } from "@kolu/surface/define";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { Cause, Effect, type Exit, Stream } from "effect";

const ATTACH_MEMBER = "terminalAttach" satisfies keyof NonNullable<
  PadiSurfaceSpec["streams"]
>;
const LIFECYCLE_MEMBER = "lifecycle" satisfies keyof NonNullable<
  PadiSurfaceSpec["procedures"]
>;
const RESIZE_VERB = "resize" satisfies keyof NonNullable<
  PadiSurfaceSpec["procedures"]
>["lifecycle"];

export const TERMINAL_ATTACH_TAG = surfaceTag(
  padiSurface.tagPrefix,
  ATTACH_MEMBER,
  "get",
);

export const LIFECYCLE_RESIZE_TAG = surfaceTag(
  padiSurface.tagPrefix,
  LIFECYCLE_MEMBER,
  RESIZE_VERB,
);

const MAX_TRACKED_TERMINALS = 512;

export const ATTACH_BURST_QUIET_MS = 1500;

export const ATTACH_BURST_CAP_MS = 30_000;

export interface AttachTelemetryOptions {
  host: string;
  log: Logger;
  now?: () => number;
  quietMs?: number;
  capMs?: number;
}

interface Grid {
  cols: number;
  rows: number;
}

const RESIZE_CAUSES = [...ATTACH_CAUSES, "publish"] as const;

type ResizeCause = (typeof RESIZE_CAUSES)[number];

type ResizeTally = { [C in ResizeCause]: number };

const noTally = (): ResizeTally => ({ attach: 0, foreign: 0, publish: 0 });

interface TerminalResizes {
  grid: Grid | undefined;
  tally: ResizeTally;
}

interface AttachRecord {
  terminalId: string;
  openedAt: number;
  firstFrameAt: number | undefined;
  firstFrameKind: string | undefined;
  snapshotChars: number;
  deltaChars: number;
  snapshots: number;
  resizesServedToThisViewer: number;
  terminalResizeTally: TerminalResizes;
  endedAt: number | undefined;
  endedBy: "end" | "failure" | "interrupt" | undefined;
}

interface Group<T> {
  startedAt: number;
  lastAt: number;
  items: T[];
  quiet: boolean;
  quietTimer: ReturnType<typeof setTimeout> | undefined;
  capTimer: ReturnType<typeof setTimeout>;
}

interface Grouping<T> {
  open(): boolean;
  add(item: T): void;
  settled(): void;
}

const idleTimeout = (
  fn: () => void,
  ms: number,
): ReturnType<typeof setTimeout> => {
  const timer = setTimeout(fn, ms) as ReturnType<typeof setTimeout> & {
    unref?: () => void;
  };
  timer.unref?.();
  return timer;
};

interface GroupingOptions<T> {
  now: () => number;
  quietMs: number;
  capMs: number;
  ready?: (items: readonly T[]) => boolean;
  report: (g: Group<T>, why: "quiet" | "cap") => void;
}

const createGrouping = <T>(o: GroupingOptions<T>): Grouping<T> => {
  let group: Group<T> | undefined;
  const close = (why: "quiet" | "cap"): void => {
    if (group === undefined) return;
    const done = group;
    group = undefined;
    clearTimeout(done.quietTimer);
    clearTimeout(done.capTimer);
    o.report(done, why);
  };
  const settled = (): void => {
    if (group === undefined || !group.quiet) return;
    if (o.ready?.(group.items) ?? true) close("quiet");
  };
  return {
    open: () => group !== undefined,
    add(item: T) {
      const t = o.now();
      group ??= {
        startedAt: t,
        lastAt: t,
        items: [],
        quiet: false,
        quietTimer: undefined,
        capTimer: idleTimeout(() => close("cap"), o.capMs),
      };
      const g = group;
      g.items.push(item);
      g.lastAt = t;
      g.quiet = false;
      clearTimeout(g.quietTimer);
      g.quietTimer = idleTimeout(() => {
        g.quietTimer = undefined;
        g.quiet = true;
        settled();
      }, o.quietMs);
    },
    settled,
  };
};

interface LruMap<K, V> {
  getOrCreate(key: K, make: () => V): V;
}

const lruMap = <K, V>(max: number): LruMap<K, V> => {
  const entries = new Map<K, V>();
  return {
    getOrCreate(key, make) {
      const found = entries.get(key);
      if (found !== undefined) {
        entries.delete(key);
        entries.set(key, found);
        return found;
      }
      const fresh = make();
      entries.set(key, fresh);
      if (entries.size > max) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      return fresh;
    },
  };
};

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

const gridIn = (value: unknown): Grid | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const g = value as { cols?: unknown; rows?: unknown };
  return typeof g.cols === "number" && typeof g.rows === "number"
    ? { cols: g.cols, rows: g.rows }
    : undefined;
};

const attachCauseOf = (payload: unknown): ResizeCause => {
  if (typeof payload === "object" && payload !== null && "cause" in payload) {
    const named = ATTACH_CAUSES.find((c) => c === payload.cause);
    if (named !== undefined) return named;
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

export function withAttachTelemetry(
  dispatch: SurfaceDispatch,
  opts: AttachTelemetryOptions,
): SurfaceDispatch {
  const now = opts.now ?? Date.now;
  const quietMs = opts.quietMs ?? ATTACH_BURST_QUIET_MS;
  const capMs = opts.capMs ?? ATTACH_BURST_CAP_MS;
  const terminals = lruMap<string, TerminalResizes>(MAX_TRACKED_TERMINALS);

  const terminalResizes = (terminalId: string): TerminalResizes =>
    terminals.getOrCreate(terminalId, () => ({
      grid: undefined,
      tally: noTally(),
    }));

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
    if (bursts.open()) burstResizes[cause] += 1;
  };

  let burstResizes = noTally();

  const report = (b: Group<AttachRecord>, why: "quiet" | "cap"): void => {
    const t = now();
    const attaches = b.items;
    const firstFrames = attaches.filter((a) => a.firstFrameAt !== undefined);
    const snapshots = firstFrames.filter(
      (a) => a.firstFrameKind === "snapshot",
    );
    const unanswered = attaches.filter((a) => !answered(a));
    const endedBeforeFrame = attaches.filter(
      (a) => a.firstFrameAt === undefined && a.endedAt !== undefined,
    );
    const line = {
      host: opts.host,
      attaches: attaches.length,
      terminals: new Set(attaches.map((a) => a.terminalId)).size,
      snapshots: snapshots.length,
      snapshotChars: snapshots.reduce((n, a) => n + a.snapshotChars, 0),
      resizes: { ...burstResizes },
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
      openedOverMs: b.lastAt - b.startedAt,
      settledMs:
        why === "cap"
          ? null
          : Math.max(
              0,
              ...attaches.map(
                (a) => (a.firstFrameAt ?? a.endedAt ?? t) - b.startedAt,
              ),
            ),
      reportedAfterMs: t - b.startedAt,
      why: why === "cap" ? "cap" : "answered",
    };
    (attaches.length > 1 ? opts.log.info : opts.log.debug).call(
      opts.log,
      line,
      "terminal attach burst",
    );
  };

  const endedResizes = (ended: readonly AttachRecord[]): ResizeTally => {
    const total = noTally();
    for (const tracked of new Set(ended.map((a) => a.terminalResizeTally))) {
      for (const cause of RESIZE_CAUSES) total[cause] += tracked.tally[cause];
    }
    return total;
  };

  const reportEnds = (g: Group<AttachRecord>, why: "quiet" | "cap"): void => {
    const t = now();
    opts.log.info(
      {
        host: opts.host,
        ends: g.items.length,
        terminals: new Set(g.items.map((a) => a.terminalId)).size,
        snapshotChars: g.items.reduce((n, a) => n + a.snapshotChars, 0),
        deltaChars: g.items.reduce((n, a) => n + a.deltaChars, 0),
        skipAheads: g.items.reduce(
          (n, a) => n + Math.max(0, a.snapshots - 1),
          0,
        ),
        resizes: endedResizes(g.items),
        servedResizes: g.items.reduce(
          (n, a) => n + a.resizesServedToThisViewer,
          0,
        ),
        livedMs: quantiles(
          g.items.map((a) => (a.endedAt as number) - a.openedAt),
        ),
        endedOverMs: g.lastAt - g.startedAt,
        reportedAfterMs: t - g.startedAt,
        why,
      },
      "terminal attach: ends",
    );
  };

  const bursts = createGrouping<AttachRecord>({
    now,
    quietMs,
    capMs,
    ready: (attaches) => attaches.every(answered),
    report,
  });
  const ends = createGrouping<AttachRecord>({
    now,
    quietMs,
    capMs,
    report: reportEnds,
  });

  const open = (payload: unknown): AttachRecord => {
    const t = now();
    if (!bursts.open()) burstResizes = noTally();
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
      resizesServedToThisViewer: 0,
      terminalResizeTally: resizes,
      endedAt: undefined,
      endedBy: undefined,
    };
    bursts.add(rec);
    const asked =
      typeof payload === "object" && payload !== null && "resizeTo" in payload
        ? gridIn(payload.resizeTo)
        : undefined;
    if (asked !== undefined) noteGrid(resizes, asked, attachCauseOf(payload));
    return rec;
  };

  const onFrame = (rec: AttachRecord, frame: unknown): void => {
    const { kind, chars } = frameFacts(frame);
    if (kind === "delta") rec.deltaChars += chars;
    else if (kind === "snapshot") rec.snapshots += 1;
    else if (kind === "resized") rec.resizesServedToThisViewer += 1;
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
    bursts.settled();
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
        skipAheads: Math.max(0, rec.snapshots - 1),
        resizes: { ...rec.terminalResizeTally.tally },
        servedResizes: rec.resizesServedToThisViewer,
        livedMs: t - rec.openedAt,
        endedBy: rec.endedBy,
      },
      "terminal attach: end",
    );
    ends.add(rec);
    bursts.settled();
  };

  return {
    unary: (tag, payload) =>
      tag !== LIFECYCLE_RESIZE_TAG
        ? dispatch.unary(tag, payload)
        : Effect.suspend(() => {
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
        : Stream.suspend(() => {
            const rec = open(payload);
            return dispatch.stream(tag, payload).pipe(
              Stream.tap((frame) => Effect.sync(() => onFrame(rec, frame))),
              Stream.onExit((exit) => Effect.sync(() => onExit(rec, exit))),
            );
          }),
  };
}

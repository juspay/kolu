/**
 * padi's process-memory read — the poll READ behind padi's DERIVED `processMemory`
 * surface cell (padi's OWN RSS + its kaval daemon's). The cell is
 * `derived.cell(source({ read: pollRead(samplePadiMemory), install }))` in
 * `servePadi.ts`: the reactor owns the T+0 seed, the non-overlap guard, and
 * later-read log-skip-continue that the hand-rolled sampler used to spell by
 * hand, and `pollRead` is padi's ONE run edge into that deliberately
 * Promise-shaped `read`.
 *
 * padi owns kaval now (it supervises the kaval PROCESS), so padi is the source of
 * the rail's per-host memory readout — the axis kolu-server's in-process sampler
 * served before the W2.2 cutover. Every tick asks the baked osfacts binary for the
 * exact padi pid and, when connected, the pid retained on kaval's endpoint-owned
 * connection identity. One `snapshot --pids … --mem` replaces both padi's
 * self-measurement and the old RPC hop into kaval. The target is captured before
 * the read and verified against that same endpoint afterward, so a recycle can
 * never publish the prior generation's RSS. An honestly absent/raced-away
 * kaval remains `absent`; unreadable RSS and binary/contract failures surface as
 * the distinct `error` arm. kolu-server folds this reading into the rail's cell;
 * the client never subscribes to it directly.
 *
 * The cadence matches the retired kolu-server sampler (5s) — memory is slow-moving,
 * so a coarser tick than the client's 1s heap read is plenty live.
 */

import { Effect } from "effect";
import {
  bakedOsFactsBin,
  isOsfactsClientError,
  snapshotPids,
  type SnapshotSourceErrorRow,
  type SnapshotReading,
  type UnreadableRow,
} from "osfacts-client";
import { match } from "ts-pattern";
import { log } from "./log.ts";
import {
  currentKavalProcessTarget,
  type KavalProcessTarget,
} from "./ptyHost/index.ts";
import type { PadiProcessMemory, ProcessRss } from "./vocab.ts";

/** Cadence of padi's process-memory readout — the SAME 5s the retired kolu-server
 *  sampler used. Coarser than the client's 1s heap tick: memory is slow-moving, so
 *  a 5s poll is plenty live without chattering at the daemon. */
export const MEMORY_SAMPLE_INTERVAL_MS = 5_000;

function kavalTargetStillCurrent(target: KavalProcessTarget): boolean {
  const current = currentKavalProcessTarget();
  return (
    current !== undefined &&
    current.pid === target.pid &&
    current.startedAt === target.startedAt
  );
}

type RssEvidence =
  | { readonly kind: "ok"; readonly rssBytes: number }
  | {
      readonly kind: "unreadable";
      readonly unreadable: UnreadableRow;
      readonly sourceErrors: SnapshotSourceErrorRow[];
    }
  | {
      readonly kind: "source-error";
      readonly sourceErrors: SnapshotSourceErrorRow[];
    }
  | { readonly kind: "missing" };

function rssEvidence(reading: SnapshotReading, pid: number): RssEvidence {
  const row = reading.memory.find((value) => value.pid === pid);
  if (row !== undefined) return { kind: "ok", rssBytes: row.rssBytes };

  const unreadable = reading.unreadable.find(
    (value) => value.pid === pid && value.facet === "mem",
  );
  const sourceErrors = reading.errors.filter((value) => value.facet === "mem");
  if (unreadable !== undefined) {
    return { kind: "unreadable", unreadable, sourceErrors };
  }
  if (sourceErrors.length > 0) return { kind: "source-error", sourceErrors };
  return { kind: "missing" };
}

function padiRss(evidence: RssEvidence, pid: number): ProcessRss {
  return match<RssEvidence, ProcessRss>(evidence)
    .with({ kind: "ok" }, ({ rssBytes }) => ({ status: "ok", rssBytes }))
    .with({ kind: "unreadable" }, ({ unreadable, sourceErrors }) => {
      log.error(
        {
          pid,
          processName: "padi",
          unreadable,
          sourceErrors,
        },
        "padi osfacts RSS read failed",
      );
      return { status: "error" };
    })
    .with({ kind: "source-error" }, ({ sourceErrors }) => {
      log.error(
        { pid, processName: "padi", sourceErrors },
        "padi osfacts RSS read failed",
      );
      return { status: "error" };
    })
    .with({ kind: "missing" }, () => {
      log.error({ pid, processName: "padi" }, "padi osfacts RSS fact missing");
      return { status: "error" };
    })
    .exhaustive();
}

function kavalRss(evidence: RssEvidence, pid: number): ProcessRss {
  return match<RssEvidence, ProcessRss>(evidence)
    .with({ kind: "ok" }, ({ rssBytes }) => ({ status: "ok", rssBytes }))
    .with({ kind: "unreadable" }, ({ unreadable, sourceErrors }) => {
      if (unreadable.errno === "ESRCH" || unreadable.errno === "ENOENT") {
        return { status: "absent" };
      }
      log.error(
        {
          pid,
          processName: "kaval",
          unreadable,
          sourceErrors,
        },
        "kaval osfacts RSS read failed",
      );
      return { status: "error" };
    })
    .with({ kind: "source-error" }, ({ sourceErrors }) => {
      log.error(
        { pid, processName: "kaval", sourceErrors },
        "kaval osfacts RSS read failed",
      );
      return { status: "error" };
    })
    .with({ kind: "missing" }, () => {
      log.error(
        { pid, processName: "kaval" },
        "kaval osfacts RSS fact missing",
      );
      return { status: "error" };
    })
    .exhaustive();
}

/** Take one osfacts reading for padi and the endpoint's connected kaval. The
 * endpoint target is captured as one immutable connection identity, then
 * checked again after the process read; a disconnected/replaced target is
 * honest absence, never the prior generation's RSS or an unreadability error.
 *
 * The poll READ of
 *  padi's derived `processMemory` cell
 *  (`servePadi.ts`: `derived.cell(source({ read: pollRead(samplePadiMemory), install }))`).
 *  The reactor owns the loop the hand-rolled sampler used to: the T+0 seed read,
 *  the non-overlap guard, and later-read log-skip-continue — so this is just the
 *  pure read, and `MEMORY_SAMPLE_INTERVAL_MS` is the caller-owned cadence.
 *
 * A VALUE, not a function: the Effect is a lazy description, so re-running it is
 * what "sample again" means and there is nothing for a call to do first. It also
 * makes the capture-then-recheck real — the target is read INSIDE the
 * description, once per run, so a sample never carries a pid resolved at
 * construction.
 *
 * **TOTAL by type.** The reactor's poll source wants a value on every tick, and
 * this read's declared failures are exactly `osfacts-client`'s three, so the one
 * `Effect.catch` below is the whole error fold and the result channel is
 * `never`. It is deliberately NOT a tag list: naming the three tags here would
 * be a second copy of the client's union that could fall out of step with it,
 * and it would be the same instanceof-shaped guard the Promise version needed
 * only because a rejection had no type. Anything the client did NOT declare —
 * a bug in the fold, an OOM — stays a DEFECT and takes the tick down loudly,
 * which is exactly what the old `if (!(err instanceof …)) throw err` bought. */
export const samplePadiMemory: Effect.Effect<PadiProcessMemory> =
  Effect.suspend(() => {
    const kavalTarget = currentKavalProcessTarget();
    const pids =
      kavalTarget === undefined
        ? [process.pid]
        : [process.pid, kavalTarget.pid];
    /** Re-asked AFTER the read lands, never before: the whole point is that a
     *  kaval replaced mid-read is absent, not stale. */
    const kavalStillCurrent = (): boolean =>
      kavalTarget !== undefined && kavalTargetStillCurrent(kavalTarget);
    // The bake resolves INSIDE the description, on the same error channel as
    // the spawn it feeds. `bakedOsFactsBin` is on the client's sync island and
    // THROWS an `OsfactsSpawnError` — so an unbaked KOLU_OSFACTS_BIN reads as
    // the same per-tick `error` arm it always did (the old `try` block held
    // this call for exactly that reason), rather than becoming a defect that
    // takes the cell down. The guard is the client's own rather than a
    // re-derived instanceof list, and re-throwing what it rejects is how the
    // impossible branch stays a DEFECT instead of being laundered into a
    // typed failure it is not.
    const readMemory = Effect.flatMap(
      Effect.try({
        try: () => bakedOsFactsBin("KOLU_OSFACTS_BIN"),
        catch: (err) => {
          if (isOsfactsClientError(err)) return err;
          throw err;
        },
      }),
      (bin) => snapshotPids(bin, pids, { mem: true }),
    );
    return Effect.catch(
      Effect.map(
        readMemory,
        (reading: SnapshotReading): PadiProcessMemory => ({
          padi: padiRss(rssEvidence(reading, process.pid), process.pid),
          kaval:
            kavalTarget !== undefined && kavalStillCurrent()
              ? kavalRss(rssEvidence(reading, kavalTarget.pid), kavalTarget.pid)
              : { status: "absent" },
        }),
      ),
      (err) =>
        Effect.sync((): PadiProcessMemory => {
          log.error({ err, pids }, "osfacts memory snapshot failed");
          return {
            padi: { status: "error" },
            kaval: kavalStillCurrent()
              ? { status: "error" }
              : { status: "absent" },
          };
        }),
    );
  });

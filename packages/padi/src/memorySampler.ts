/**
 * padi's process-memory read — the poll READ behind padi's DERIVED `processMemory`
 * surface cell (padi's OWN RSS + its kaval daemon's). The cell is
 * `derived.cell(source({ read: samplePadiMemory, install }))` in `servePadi.ts`:
 * the reactor owns the T+0 seed, the non-overlap guard, and later-read
 * log-skip-continue that the hand-rolled sampler used to spell by hand.
 *
 * padi owns kaval now (it supervises the kaval PROCESS), so padi is the source of
 * the rail's per-host memory readout — the axis kolu-server's in-process sampler
 * served before the W2.2 cutover. Every tick asks the baked osfacts binary for the
 * exact padi pid and, when connected, the pid retained on kaval's endpoint-owned
 * connection identity. One `snapshot --pids … --mem` replaces both padi's
 * self-measurement and the old RPC hop into kaval. The target is captured before
 * the async read and verified against that same endpoint afterward, so a recycle
 * can never publish the prior generation's RSS. An honestly absent/raced-away
 * kaval remains `absent`; unreadable RSS and binary/contract failures surface as
 * the distinct `error` arm. kolu-server folds this reading into the rail's cell;
 * the client never subscribes to it directly.
 *
 * The cadence matches the retired kolu-server sampler (5s) — memory is slow-moving,
 * so a coarser tick than the client's 1s heap read is plenty live.
 */

import {
  bakedOsFactsBin,
  OsfactsClientError,
  type SnapshotReading,
  type SnapshotSourceErrorRow,
  snapshotPids,
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
 * checked again after the async process read; a disconnected/replaced target is
 * honest absence, never the prior generation's RSS or an unreadability error.
 *
 * The poll READ of
 *  padi's derived `processMemory` cell
 *  (`servePadi.ts`: `derived.cell(source({ read: samplePadiMemory, install }))`).
 *  The reactor owns the loop the hand-rolled sampler used to: the T+0 seed read,
 *  the non-overlap guard, and later-read log-skip-continue — so this is just the
 *  pure read, and `MEMORY_SAMPLE_INTERVAL_MS` is the caller-owned cadence. */
export async function samplePadiMemory(): Promise<PadiProcessMemory> {
  const kavalTarget = currentKavalProcessTarget();
  const kavalPid = kavalTarget?.pid;
  const pids = kavalPid === undefined ? [process.pid] : [process.pid, kavalPid];
  let reading: SnapshotReading;
  try {
    reading = await snapshotPids(bakedOsFactsBin("KOLU_OSFACTS_BIN"), pids, {
      mem: true,
    });
  } catch (err) {
    if (!(err instanceof OsfactsClientError)) throw err;
    log.error({ err, pids }, "osfacts memory snapshot failed");
    const kavalStillCurrent =
      kavalTarget !== undefined && kavalTargetStillCurrent(kavalTarget);
    return {
      padi: { status: "error" },
      kaval: kavalStillCurrent ? { status: "error" } : { status: "absent" },
    };
  }
  const kavalStillCurrent =
    kavalTarget !== undefined && kavalTargetStillCurrent(kavalTarget);
  return {
    padi: padiRss(rssEvidence(reading, process.pid), process.pid),
    kaval: kavalStillCurrent
      ? kavalRss(rssEvidence(reading, kavalTarget.pid), kavalTarget.pid)
      : { status: "absent" },
  };
}

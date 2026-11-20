import type { PadiProcessMemory, ProcessRss } from "@kolu/padi-client/surface";
import { Effect } from "effect";
import {
  bakedOsFactsBin,
  isOsfactsClientError,
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

export const samplePadiMemory: Effect.Effect<PadiProcessMemory> =
  Effect.suspend(() => {
    const kavalTarget = currentKavalProcessTarget();
    const pids =
      kavalTarget === undefined
        ? [process.pid]
        : [process.pid, kavalTarget.pid];
    const kavalStillCurrent = (): boolean =>
      kavalTarget !== undefined && kavalTargetStillCurrent(kavalTarget);
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

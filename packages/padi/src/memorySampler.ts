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
 * exact padi pid and, when connected, the pid from kaval's pid-first gate. One
 * `snapshot --pids … --mem` replaces both padi's self-measurement and the old RPC
 * hop into kaval. An honestly absent/raced-away kaval remains `absent`; unreadable
 * RSS and binary/contract failures surface as the distinct `error` arm; gate
 * invariant failures reject the read and reach the cell's declared error policy.
 * kolu-server folds this reading into the rail's cell; the client never subscribes
 * to it directly.
 *
 * The cadence matches the retired kolu-server sampler (5s) — memory is slow-moving,
 * so a coarser tick than the client's 1s heap read is plenty live.
 */

import { readGateIdentity } from "@kolu/surface-daemon";
import {
  bakedOsFactsBin,
  OsfactsClientError,
  snapshotPids,
  type SnapshotReading,
} from "osfacts-client";
import { log } from "./log.ts";
import {
  getLocalSocketPath,
  readDaemonStatus,
} from "./ptyHost/daemonStatus.ts";
import { kavalGatePath } from "./ptyHost/localDriver.ts";
import type { PadiProcessMemory, ProcessRss } from "./vocab.ts";
import { encodeHostLocation, LOCAL_LOCATION } from "./vocab.ts";

/** Cadence of padi's process-memory readout — the SAME 5s the retired kolu-server
 *  sampler used. Coarser than the client's 1s heap tick: memory is slow-moving, so
 *  a 5s poll is plenty live without chattering at the daemon. */
export const MEMORY_SAMPLE_INTERVAL_MS = 5_000;

function connectedKavalPid(): number | undefined {
  if (
    readDaemonStatus(encodeHostLocation(LOCAL_LOCATION))?.state !== "connected"
  ) {
    return undefined;
  }

  const socketPath = getLocalSocketPath();
  if (socketPath === undefined) {
    throw new Error("connected kaval has no recorded socket path");
  }
  const gatePath = kavalGatePath(socketPath);
  const gate = readGateIdentity(gatePath);
  switch (gate.kind) {
    case "ok":
      return gate.pid;
    case "absent":
      throw new Error(`connected kaval gate is absent at ${gatePath}`);
    case "malformed":
      throw new Error(`connected kaval gate is malformed at ${gatePath}`);
    case "unreadable":
      throw new Error(
        `connected kaval gate is unreadable at ${gatePath} — refusing to sample an unproven pid`,
      );
    default:
      return gate satisfies never;
  }
}

function processRss(
  reading: SnapshotReading,
  pid: number,
  processName: "padi" | "kaval",
): ProcessRss {
  const row = reading.memory.find((value) => value.pid === pid);
  if (row !== undefined) return { status: "ok", rssBytes: row.rssBytes };

  const unreadable = reading.unreadable.find(
    (value) => value.pid === pid && value.facet === "mem",
  );
  if (
    processName === "kaval" &&
    (unreadable?.errno === "ESRCH" || unreadable?.errno === "ENOENT")
  ) {
    return { status: "absent" };
  }
  const sourceErrors = reading.errors.filter((value) => value.facet === "mem");
  if (unreadable !== undefined || sourceErrors.length > 0) {
    log.error(
      { pid, processName, unreadable, sourceErrors },
      `${processName} osfacts RSS read failed`,
    );
    return { status: "error" };
  }
  throw new Error(`osfacts returned no RSS fact for ${processName} pid ${pid}`);
}

/** Take one osfacts reading for padi and its connected kaval. The poll READ of
 *  padi's derived `processMemory` cell
 *  (`servePadi.ts`: `derived.cell(source({ read: samplePadiMemory, install }))`).
 *  The reactor owns the loop the hand-rolled sampler used to: the T+0 seed read,
 *  the non-overlap guard, and later-read log-skip-continue — so this is just the
 *  pure read, and `MEMORY_SAMPLE_INTERVAL_MS` is the caller-owned cadence. */
export async function samplePadiMemory(): Promise<PadiProcessMemory> {
  const kavalPid = connectedKavalPid();
  const pids = kavalPid === undefined ? [process.pid] : [process.pid, kavalPid];
  let reading: SnapshotReading;
  try {
    reading = await snapshotPids(bakedOsFactsBin("KOLU_OSFACTS_BIN"), pids, {
      mem: true,
    });
  } catch (err) {
    if (!(err instanceof OsfactsClientError)) throw err;
    log.error({ err, pids }, "osfacts memory snapshot failed");
    return {
      padi: { status: "error" },
      kaval:
        kavalPid === undefined ? { status: "absent" } : { status: "error" },
    };
  }
  return {
    padi: processRss(reading, process.pid, "padi"),
    kaval:
      kavalPid === undefined
        ? { status: "absent" }
        : processRss(reading, kavalPid, "kaval"),
  };
}

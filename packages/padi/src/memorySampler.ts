/**
 * padi's process-memory read — the poll READ behind padi's DERIVED `processMemory`
 * surface cell (padi's OWN RSS + its kaval daemon's). The cell is
 * `derived.cell(source({ read: samplePadiMemory, install }))` in `servePadi.ts`:
 * the reactor owns the T+0 seed, the non-overlap guard, and later-read
 * log-skip-continue that the hand-rolled sampler used to spell by hand.
 *
 * padi owns kaval now (it supervises the kaval PROCESS), so padi is the source of
 * the rail's per-host memory readout — the axis kolu-server's in-process sampler
 * served before the W2.2 cutover. Every tick it reads its OWN resident-set size
 * (`process.memoryUsage().rss`, always available — it is measuring itself) and
 * polls kaval's RSS over `system.processMemory` EXACTLY as kolu-server's old
 * sampler did: only when the daemon is connected (else the honest `absent`), and a
 * poll that throws on a BELIEVED-connected daemon is surfaced as the distinct
 * `error` state, never collapsed into the same `absent` shape as "no daemon".
 * kolu-server folds this reading into the rail's cell; the client never subscribes
 * to it directly.
 *
 * The cadence matches the retired kolu-server sampler (5s) — memory is slow-moving,
 * so a coarser tick than the client's 1s heap read is plenty live.
 */

import { log } from "./log.ts";
import { dirname, join } from "node:path";
import { readGateIdentity } from "@kolu/surface-daemon";
import { snapshotPids } from "osfacts-client";
import { KAVAL_GATE_FILE } from "kaval";
import {
  getLocalSocketPath,
  readDaemonStatus,
} from "./ptyHost/daemonStatus.ts";
import { osfactsBinPath } from "./ports/scan.ts";
import type {
  KavalProcessRss,
  PadiProcessMemory,
  ProcessRss,
} from "./vocab.ts";
import { encodeHostLocation, LOCAL_LOCATION } from "./vocab.ts";

/** Cadence of padi's process-memory readout — the SAME 5s the retired kolu-server
 *  sampler used. Coarser than the client's 1s heap tick: memory is slow-moving, so
 *  a 5s poll is plenty live without chattering at the daemon. */
export const MEMORY_SAMPLE_INTERVAL_MS = 5_000;

/** Poll kaval's RSS as the honest four-way. `absent` when there is no connected
 *  daemon to measure (the expected "no value", read off the daemon-status store —
 *  never a thrown poll against a down daemon); `ok` when a connected daemon
 *  answered `system.processMemory`; `error` when a BELIEVED-connected daemon's poll
 *  threw; `gate-format-unsupported` when a surviving older daemon's gate is present
 *  but not in this build's identity format. That arm refuses the legacy pid while
 *  giving the client a typed restart-needed explanation. */
export interface MemorySamplerDeps {
  selfRss: () => number;
  connectedKaval: () =>
    | { kind: "absent" }
    | { kind: "pid"; pid: number }
    | { kind: "gate-format-unsupported" };
  samplePidRss: (pid: number) => Promise<number>;
}

function connectedKaval(): ReturnType<MemorySamplerDeps["connectedKaval"]> {
  if (
    readDaemonStatus(encodeHostLocation(LOCAL_LOCATION))?.state !== "connected"
  ) {
    return { kind: "absent" };
  }
  const socketPath = getLocalSocketPath();
  if (socketPath === undefined) {
    throw new Error("connected kaval has no recorded socket path");
  }
  const gate = readGateIdentity(join(dirname(socketPath), KAVAL_GATE_FILE));
  if (gate.kind === "unsupported-format") {
    return { kind: "gate-format-unsupported" };
  }
  if (gate.kind !== "ok") {
    throw new Error(`connected kaval gate is ${gate.kind}`);
  }
  return { kind: "pid", pid: gate.identity.pid };
}

async function samplePidRss(pid: number): Promise<number> {
  const reading = await snapshotPids(osfactsBinPath(), [pid], { mem: true });
  const row = reading.memory.find((value) => value.pid === pid);
  if (row === undefined) {
    const unreadable = reading.unreadable.find(
      (value) => value.pid === pid && value.facet === "mem",
    );
    throw new Error(
      unreadable === undefined
        ? `osfacts returned no RSS for kaval pid ${pid}`
        : `osfacts could not read kaval pid ${pid} RSS (${unreadable.errno})`,
    );
  }
  return row.rssBytes;
}

const defaultDeps: MemorySamplerDeps = {
  selfRss: () => process.memoryUsage().rss,
  connectedKaval,
  samplePidRss,
};

async function pollKavalRss(deps: MemorySamplerDeps): Promise<KavalProcessRss> {
  try {
    const connected = deps.connectedKaval();
    if (connected.kind === "absent") return { status: "absent" };
    if (connected.kind === "gate-format-unsupported") {
      return { status: "gate-format-unsupported" };
    }
    return {
      status: "ok",
      rssBytes: await deps.samplePidRss(connected.pid),
    };
  } catch (err) {
    log.error({ err }, "kaval osfacts RSS read failed");
    return { status: "error" };
  }
}

/** Take one reading — padi's own RSS (always `ok`, it measures itself) plus
 *  kaval's honest three-way. The poll READ of padi's derived `processMemory` cell
 *  (`servePadi.ts`: `derived.cell(source({ read: samplePadiMemory, install }))`).
 *  The reactor owns the loop the hand-rolled sampler used to: the T+0 seed read,
 *  the non-overlap guard, and later-read log-skip-continue — so this is just the
 *  pure read, and `MEMORY_SAMPLE_INTERVAL_MS` is the caller-owned cadence. */
export async function samplePadiMemory(
  _signal?: AbortSignal,
  deps: MemorySamplerDeps = defaultDeps,
): Promise<PadiProcessMemory> {
  const padi: ProcessRss = {
    status: "ok",
    rssBytes: deps.selfRss(),
  };
  const kaval = await pollKavalRss(deps);
  return { padi, kaval };
}

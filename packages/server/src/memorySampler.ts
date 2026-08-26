/**
 * The server's process-memory read — the poll READ behind kolu-server's DERIVED
 * `processMemory` surface cell that feeds the chrome bar's rail.
 *
 * The cell is `derived.cell(source({ read: () => sampleServerMemory(readPadiMemory),
 * install }))` in `index.ts`: the reactor owns the T+0 seed, the non-overlap guard,
 * and the later-read log-skip-continue that the retired hand-rolled sampler used to
 * spell by hand. This module is just the pure read.
 *
 * Every read takes kolu-server's OWN resident-set size (`process.memoryUsage().rss`,
 * always available — it's measuring itself) and FOLDS IN padi's `{ padi, kaval }`
 * reading, read off the re-served padi surface. The client adds its own JS-heap
 * figure locally (off `performance.memory`), so it never rides this cell.
 *
 * W2.2 shape: kaval runs behind padi now, so kolu-server never polls kaval directly.
 * padi owns the per-host readout — one baked osfacts `--mem` snapshot samples padi
 * and its connected kaval, publishing the honest three-way pair on
 * `padiSurface.processMemory`. This read folds that pair (`readPadiMemory`) into all
 * three processes on ONE value so the rail reads a single source. When padi is down
 * the reading is `null`,
 * and both `padi`/`kaval` fold as `absent` — the honest "no process to measure",
 * never a fake zero.
 *
 * Memory churns byte-by-byte, but the rail renders whole megabytes. The cell's
 * whole-MB `equals` (`processMemoryMbEqual`, the dedup that drops every read which
 * doesn't move a displayed MB) is declared at the spec (`kolu-common/surface`), the
 * one wire dedup point for the derived member.
 */

import type { PadiProcessMemory } from "@kolu/padi-client/surface";
import type { ProcessMemory } from "kolu-common/surface";

/** Take one reading — kolu-server's own RSS (always present, it measures itself)
 *  plus padi's folded-in `{ padi, kaval }` pair. The poll READ of kolu-server's
 *  derived `processMemory` cell. A `null` padi reading (padi down / unreadable)
 *  folds both as the honest `absent`, never a fake zero; padi's honest three-way is
 *  passed through verbatim, so an `error` kaval poll stays distinct from `absent`. */
export async function sampleServerMemory(
  /** padi's `{ padi, kaval }` reading off the re-served padi surface, or `null` when
   *  padi is down / unreadable (both then fold as `absent`). */
  readPadiMemory: () => Promise<PadiProcessMemory | null>,
): Promise<ProcessMemory> {
  const padiMem = await readPadiMemory();
  return {
    serverRssBytes: process.memoryUsage().rss,
    padi: padiMem?.padi ?? { status: "absent" },
    kaval: padiMem?.kaval ?? { status: "absent" },
  };
}

/** Cadence of the rail's readout. Coarser than the client's 1s heap tick — memory
 *  is slow-moving and the MB-dedup keeps stable spans off the wire, so a 5s poll is
 *  plenty live without chattering at every connected client. The `unref`'d interval
 *  hygiene (a live sampler never holds the process open) lives in the reactor's
 *  `everyMs`, which the cell's fused `install` reads. */
export const MEMORY_SAMPLE_INTERVAL_MS = 5_000;

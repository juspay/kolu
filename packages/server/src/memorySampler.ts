import type { PadiProcessMemory } from "@kolu/padi-client/surface";
import type { ProcessMemory } from "kolu-common/surface";

export async function sampleServerMemory(
  readPadiMemory: () => Promise<PadiProcessMemory | null>,
): Promise<ProcessMemory> {
  const padiMem = await readPadiMemory();
  return {
    serverRssBytes: process.memoryUsage().rss,
    padi: padiMem?.padi ?? { status: "absent" },
    kaval: padiMem?.kaval ?? { status: "absent" },
  };
}

export const MEMORY_SAMPLE_INTERVAL_MS = 5_000;

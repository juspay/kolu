import type { WaitState } from "@kolu/padi-client/terminalVocab";
import type { WaitPlan } from "./verbs/wait.ts";

const DEBRIEF_BUCKETS = [
  "awaiting",
  "waiting",
] as const satisfies readonly WaitState[];

export const DEBRIEF_UNTIL = DEBRIEF_BUCKETS.join(",");

export const DEBRIEF_PLAN: WaitPlan = {
  condition: { kind: "agent", targets: new Set<string>(DEBRIEF_BUCKETS) },
  describe: DEBRIEF_BUCKETS.join("/"),
};

export const DEBRIEF_QUIET_MS = 15_000;

export const DEBRIEF_TAIL_LINES = 40;

export const DEBRIEF_EXPANSION = `kolu wait <id> --until ${DEBRIEF_UNTIL} --settled ${DEBRIEF_QUIET_MS} --snapshot ${DEBRIEF_TAIL_LINES}`;

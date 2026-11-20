import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AGENT_VOCABS } from "kolu-agents";
import { stageRenamedBash } from "./renamed-bash.ts";

export interface PresenceStandIn {
  readonly kind: string;
  readonly basename: string;
}

export function registeredStandIns(): PresenceStandIn[] {
  return Object.entries(AGENT_VOCABS).map(([kind, vocab]) => ({
    kind,
    basename: vocab.cli.basename,
  }));
}

const UP_HALVES = ["agent-stand-in", "-is-up"] as const;
const GONE_HALVES = ["agent-stand-in", "-is-gone"] as const;
export const STAND_IN_UP_MARKER = UP_HALVES.join("");
export const STAND_IN_GONE_MARKER = GONE_HALVES.join("");

const assembleSoTheEchoedCommandNeverHoldsIt = (
  shellVar: string,
  halves: readonly [string, string],
): string =>
  `${shellVar}="${halves[0]}"; ${shellVar}="$${shellVar}""${halves[1]}"`;

export function standInUpLine(kind: string): string {
  return `${STAND_IN_UP_MARKER} ${kind}`;
}

export function standInGoneLine(kind: string): string {
  return `${STAND_IN_GONE_MARKER} ${kind}`;
}

export function stageStandInBins(standIns: readonly PresenceStandIn[]): {
  dir: string;
  bins: Record<string, string>;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-presence-bins-"));
  const staged = stageRenamedBash(
    dir,
    standIns.map((s) => s.basename),
  );
  const bins: Record<string, string> = {};
  for (const { kind, basename } of standIns) bins[kind] = staged[basename];
  return { dir, bins };
}

export function presenceMockPayload(opts: {
  kind: string;
  settleFlag: string;
}): string {
  const assembleUp = assembleSoTheEchoedCommandNeverHoldsIt("u", UP_HALVES);
  const assembleGone = assembleSoTheEchoedCommandNeverHoldsIt("g", GONE_HALVES);
  const painter =
    `( b=1; while [ ! -f "${opts.settleFlag}" ]; do ` +
    `printf "%s%s %s\\n" "stand-in-boot " "$b" "${opts.kind}"; ` +
    "b=$((b+1)); sleep 1; done ) & ";
  const cases = [
    `settle) touch "${opts.settleFlag}" ;;`,
    "quit) break ;;",
    "*) : ;;",
  ].join(" ");
  return [
    `mkdir -p "${path.dirname(opts.settleFlag)}"`,
    assembleUp,
    assembleGone,
    `printf "%s %s\\n" "$u" "${opts.kind}"`,
    `${painter}while IFS= read -r cmd; do case "$cmd" in ${cases} esac; done`,
    ":",
    `printf "%s %s\\n" "$g" "${opts.kind}"`,
  ].join(" ; ");
}

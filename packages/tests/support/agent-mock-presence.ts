/** The REGISTRY-DRIVEN presence stand-in: one fake binary per registered agent,
 *  named by that agent's own CLI grammar.
 *
 *  Presence is minted by padi from the FOREGROUND ALONE — its sensors match the
 *  foreground process's basename against the registry's CLI grammar — so the
 *  thing that proves it for an agent is a process whose `/proc/<pid>/comm` is
 *  that agent's binary name and which writes NOTHING: no session file, no
 *  breadcrumb, no sidecar. Every agent in `AGENT_VOCABS` gets the same
 *  stand-in; the list and each stand-in's NAME come from the registry at
 *  runtime ({@link registeredStandIns} reads `vocab.cli.basename`), so an eighth
 *  agent is covered the day it is registered, with no edit here and none in the
 *  feature file.
 *
 *  Why its own module rather than a parameter on `agent-mock-omp.ts`: the omp
 *  fake is faithful to omp — it writes omp's breadcrumb the way omp writes it,
 *  and materializes omp's JSONL at its first prompt. This one is faithful to
 *  NOTHING but the kernel fact under test, and that is the point: if it wrote
 *  so much as a crumb, the value on the record could come from an adapter
 *  reading it rather than from the foreground.
 *
 *  The binaries themselves are copies of `bash` renamed to each basename, the
 *  same trick `hooks.ts` plays for the per-agent fakes — a compound payload
 *  (never a bare `exec`) keeps bash as the pty's foreground process, so comm
 *  reads the agent's name for as long as the stand-in is resident. */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AGENT_VOCABS } from "kolu-agents";

/** One registered agent's stand-in identity: the wire `kind` the tile chrome
 *  renders, and the binary NAME its CLI grammar declares. */
export interface PresenceStandIn {
  readonly kind: string;
  readonly basename: string;
}

/** Every registered agent, as a stand-in to bring up. Derived from the registry
 *  — never a hand list — so the scenario's breadth is the registry's breadth. */
export function registeredStandIns(): PresenceStandIn[] {
  return Object.entries(AGENT_VOCABS).map(([kind, vocab]) => ({
    kind,
    basename: vocab.cli.basename,
  }));
}

/** The stand-in process's own output markers, each assembled INSIDE bash from
 *  two halves (see the payload) so the whole string never appears in the
 *  command line the shell echoes when the scenario types it. A marker the echo
 *  could satisfy is a start-guard that passes against a binary that never ran
 *  (dev/skills/e2e-testing). Both are printed with the agent's kind appended,
 *  so a wait during the sixth agent's bring-up cannot be satisfied by the
 *  first's line still sitting in the scrollback. */
const UP_HALVES = ["agent-stand-in", "-is-up"] as const;
const GONE_HALVES = ["agent-stand-in", "-is-gone"] as const;
/** Printed once, as the stand-in becomes resident. */
export const STAND_IN_UP_MARKER = UP_HALVES.join("");
/** Printed as the loop breaks on `quit`, immediately before the process exits —
 *  the agent leaving the foreground, which is how a presence ends. */
export const STAND_IN_GONE_MARKER = GONE_HALVES.join("");

/** The line each stand-in waits for — the marker with its kind, which only the
 *  process itself can print. */
export function standInUpLine(kind: string): string {
  return `${STAND_IN_UP_MARKER} ${kind}`;
}

export function standInGoneLine(kind: string): string {
  return `${STAND_IN_GONE_MARKER} ${kind}`;
}

/** Stage one renamed copy of `bash` per registered agent under a scenario-owned
 *  directory, and hand back the absolute paths keyed by kind. The copy — rather
 *  than a symlink or a wrapper script — is what makes the kernel's
 *  `/proc/<pid>/comm` (and darwin's KERN_PROC_PATHNAME) read the agent's name,
 *  which is the single input padi's sensor gets. */
export function stageStandInBins(standIns: readonly PresenceStandIn[]): {
  dir: string;
  bins: Record<string, string>;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-presence-bins-"));
  const bash = execSync("command -v bash", { encoding: "utf8" }).trim();
  const bins: Record<string, string> = {};
  for (const { kind, basename } of standIns) {
    const target = path.join(dir, basename);
    // Two kinds could, in principle, declare the same basename; copying twice
    // is harmless and keeps this loop a plain map over the registry.
    fs.copyFileSync(bash, target);
    fs.chmodSync(target, 0o755);
    bins[kind] = target;
  }
  return { dir, bins };
}

/** The stand-in's payload: paint a line a second until the scenario says
 *  `settle`, then sit on stdin until it says `quit`.
 *
 *  The paint is the `starting` half's WITNESS — it holds padi's quiet window
 *  (~5s) open, so `starting` is a state the scenario ENDS rather than one it
 *  races; the painter is a plain `&` job of this same non-interactive bash, so
 *  it shares the pty's foreground process group and comm still reads the
 *  agent's name. When the flag file lands the painter exits, the screen goes
 *  quiet, and the presence settles to `fresh`.
 *
 *  Nothing else touches the filesystem: the ONE file written is the settle flag
 *  inside the scenario's own temp dir, which no adapter looks at. The isolated
 *  `HOME`/`XDG_*` the harness installs stays empty for this agent, which is the
 *  whole claim — presence with no session anywhere.
 *
 *  Quoting: the caller wraps this in single quotes, so the payload uses only
 *  double quotes inside, and every backslash below is literal bash. */
export function presenceMockPayload(opts: {
  kind: string;
  /** Paint until this flag file appears (the `settle` verb touches it). */
  settleFlag: string;
}): string {
  const assembleUp = `u="${UP_HALVES[0]}"; u="$u""${UP_HALVES[1]}"`;
  const assembleGone = `g="${GONE_HALVES[0]}"; g="$g""${GONE_HALVES[1]}"`;
  const painter =
    `( b=1; while [ ! -f "${opts.settleFlag}" ]; do ` +
    `printf "%s%s %s\\n" "stand-in-boot " "$b" "${opts.kind}"; ` +
    "b=$((b+1)); sleep 1; done ) & ";
  const cases = [
    `settle) touch "${opts.settleFlag}" ;;`,
    "quit) break ;;",
    // A stand-in is never prompted by this scenario; anything else is ignored
    // rather than echoed, so there is no channel by which a stray keystroke
    // could look like a conversation.
    "*) : ;;",
  ].join(" ");
  return [
    `mkdir -p "${path.dirname(opts.settleFlag)}"`,
    assembleUp,
    assembleGone,
    `printf "%s %s\\n" "$u" "${opts.kind}"`,
    // The read loop rides on the same list element as the painter's `&` job
    // rather than after a `;` bash would refuse.
    `${painter}while IFS= read -r cmd; do case "$cmd" in ${cases} esac; done`,
    ":",
    `printf "%s %s\\n" "$g" "${opts.kind}"`,
  ].join(" ; ");
}

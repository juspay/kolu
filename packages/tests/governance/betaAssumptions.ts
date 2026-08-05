/**
 * The beta-behavior assumption registry — review finding C3.
 *
 * A few sites do not depend on Effect's API, which the compiler checks, but on
 * its BEHAVIOR, which nothing checks: a ping interval, whether a child fiber's
 * failure reaches its parent, what a schema does with a key that is present but
 * must not be. Each was MEASURED against one beta build. A beta bump can change
 * any of them silently — the code still compiles, the tests around it still
 * describe the old world, and the reasoning that justified the value is quietly
 * false.
 *
 * So each such site carries a marker in its own comment:
 *
 *     BETA-ASSUMPTION(<tag>): <the one-line assumption>
 *
 * where `<tag>` is the pin's prerelease tag (`beta.102` for `4.0.0-beta.102`),
 * taken from the pnpm catalog — the same single version `effectPin` gates. The
 * gate is that every marker's tag equals the CURRENT pin's. Bumping the pin
 * therefore turns every one of these sites red until someone re-measures the
 * behavior and re-stamps the marker. That is the whole mechanism: the bump
 * cannot land without the re-verification.
 *
 * The known sites are listed below as a FLOOR, not an enumeration — a marker
 * anywhere in `packages/` is gated, and the list only stops the three that
 * motivated the registry from being deleted along with their markers.
 *
 * `packages/tests/governance` is not scanned: this file and its test name the
 * marker in prose and in fixtures, and a scanner that indicts its own
 * documentation is a scanner people delete.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** One marker occurrence. */
export interface BetaAssumption {
  /** Repo-relative path, POSIX separators. */
  readonly path: string;
  /** 1-based line number. */
  readonly line: number;
  /** The version tag inside the parentheses. */
  readonly tag: string;
  /** The assumption stated on the marker's own line. */
  readonly text: string;
}

const MARKER = /BETA-ASSUMPTION\(([^)\n]*)\):[ \t]*([^\n]*)/g;

/** The shortest assumption worth writing down; below this the marker says
 *  nothing a re-verifier could check. */
const MIN_ASSUMPTION_CHARS = 30;

/** The pin's prerelease tag — what a marker stamps. `4.0.0-beta.102` →
 *  `beta.102`; a stable `4.0.0` stamps itself, so leaving beta also trips every
 *  marker, which is the point. */
export function assumptionTag(version: string): string {
  const dash = version.indexOf("-");
  return dash === -1 ? version : version.slice(dash + 1);
}

/** Every marker in `source`, with 1-based line numbers. */
export function findBetaAssumptions(source: string): BetaAssumption[] {
  const out: BetaAssumption[] = [];
  for (const match of source.matchAll(MARKER)) {
    out.push({
      path: "",
      line: source.slice(0, match.index).split("\n").length,
      tag: match[1] ?? "",
      text: (match[2] ?? "").trim(),
    });
  }
  return out;
}

/** The sites the registry exists for. A floor: each must still carry at least
 *  one marker, so a marker cannot be dropped along with the reasoning it
 *  guards. */
export const BETA_ASSUMPTION_SITES: readonly string[] = [
  "packages/padi/src/vocab.ts",
  "packages/surface-daemon-supervisor/src/probeDaemonIdentity.ts",
  "packages/surface/src/frameLimit.ts",
  "packages/surface/src/mirrorRemoteSurface.ts",
  // The reactor's ENGINE seam (juspay/kolu#2101 G6). Three assumptions live here,
  // one per Atom behavior the bridge's correctness rests on: no implicit batching
  // (plus the stampede regime), rebuild-on-the-writer's-stack (and what a throwing
  // callback therefore costs), and a dual-edge write keeping its dependency. Each
  // marker names the law in `reactorEngineLaws.test.ts` that MEASURES it, so a
  // bump's re-verification is "run that law", not "read the code and hope".
  // beta.103's notes rewrote precisely this module and nothing re-measured it —
  // a production freeze was then diagnosed without being able to rule it in or
  // out, which is the gap this row closes.
  "packages/surface/src/reactor.ts",
];

const SKIPPED = new Set(["node_modules", "dist", ".astro"]);

/** Named in prose and in fixtures — see the doorstep note. */
const SKIPPED_TREE = "packages/tests/governance";

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

/** Every marker under `packages/` — production, tests and examples alike. */
export function collectBetaAssumptions(repoRoot: string): BetaAssumption[] {
  const files: string[] = [];
  walk(path.join(repoRoot, "packages"), files);
  const out: BetaAssumption[] = [];
  for (const full of files.sort()) {
    const file = path.relative(repoRoot, full).split(path.sep).join("/");
    if (file.startsWith(`${SKIPPED_TREE}/`)) continue;
    for (const hit of findBetaAssumptions(readFileSync(full, "utf8"))) {
      out.push({ ...hit, path: file });
    }
  }
  return out;
}

/** Throw unless every marker is stamped with the current pin's tag, states an
 *  assumption, and every known site still carries one. */
export function validateBetaAssumptions(
  found: readonly BetaAssumption[],
  version: string,
  sites: readonly string[] = BETA_ASSUMPTION_SITES,
): void {
  const tag = assumptionTag(version);
  const problems: string[] = [];
  for (const hit of found) {
    if (hit.tag !== tag) {
      problems.push(
        `  ${hit.path}:${hit.line} is stamped ${hit.tag}, but the pin is now ${version}. Re-measure the behavior it claims, then stamp it ${tag}: ${hit.text}`,
      );
    }
    if (hit.text.length < MIN_ASSUMPTION_CHARS) {
      problems.push(
        `  ${hit.path}:${hit.line} states no assumption a re-verifier could check.`,
      );
    }
  }
  const marked = new Set(found.map((hit) => hit.path));
  for (const site of sites) {
    if (!marked.has(site)) {
      problems.push(
        `  ${site} carries no BETA-ASSUMPTION marker. If the behavior it depended on stopped mattering, drop the site from BETA_ASSUMPTION_SITES in the same change.`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Effect beta-behavior assumptions are out of date (C3):\n${problems.join("\n")}`,
    );
  }
}

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface BetaAssumption {
  readonly path: string;
  readonly line: number;
  readonly tag: string;
  readonly text: string;
}

const MARKER = /BETA-ASSUMPTION\(([^)\n]*)\):[ \t]*([^\n]*)/g;

const VERSION_REF = /effect@([0-9][^\s`,:)"']*)/g;

const MIN_ASSUMPTION_CHARS = 30;

export function assumptionTag(version: string): string {
  const dash = version.indexOf("-");
  return dash === -1 ? version : version.slice(dash + 1);
}

export interface EffectVersionRef {
  readonly path: string;
  readonly line: number;
  readonly version: string;
}

export function findEffectVersionRefs(source: string): EffectVersionRef[] {
  const out: EffectVersionRef[] = [];
  for (const match of source.matchAll(VERSION_REF)) {
    out.push({
      path: "",
      line: source.slice(0, match.index).split("\n").length,
      version: match[1] ?? "",
    });
  }
  return out;
}

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

export const BETA_ASSUMPTION_SITES: readonly string[] = [
  "packages/client/src/terminal/reattachingStream.ts",
  "packages/padi-client/src/vocab.ts",
  "packages/surface-daemon-supervisor/src/probeDaemonIdentity.ts",
  "packages/surface/src/frameLimit.ts",
  "packages/surface/src/keepAlive.ts",
  "packages/surface/src/links/deliveryLanes.ts",
  "packages/surface/src/links/undecodableFrames.ts",
  "packages/surface/src/links/websocket.ts",
  "packages/surface/src/mirrorRemoteSurface.ts",
  "packages/surface/src/reactor.ts",
];

const SKIPPED = new Set(["node_modules", "dist", ".astro"]);

const SKIPPED_TREE = "packages/tests/governance";

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

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

export function collectEffectVersionRefs(repoRoot: string): EffectVersionRef[] {
  const files: string[] = [];
  walk(path.join(repoRoot, "packages"), files);
  const out: EffectVersionRef[] = [];
  for (const full of files.sort()) {
    const file = path.relative(repoRoot, full).split(path.sep).join("/");
    if (file.startsWith(`${SKIPPED_TREE}/`)) continue;
    for (const hit of findEffectVersionRefs(readFileSync(full, "utf8"))) {
      out.push({ ...hit, path: file });
    }
  }
  return out;
}

export function validateBetaAssumptions(
  found: readonly BetaAssumption[],
  version: string,
  sites: readonly string[] = BETA_ASSUMPTION_SITES,
  versionRefs: readonly EffectVersionRef[] = [],
): void {
  const tag = assumptionTag(version);
  const problems: string[] = [];
  for (const ref of versionRefs) {
    if (ref.version !== version) {
      problems.push(
        `  ${ref.path}:${ref.line} cites effect@${ref.version}, but the pin is now ${version}. This is the EVIDENCE under a marker: re-measure against ${version} and update the prose (or drop the version from it), so a re-stamped marker never cites a measurement nobody took.`,
      );
    }
  }
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

/**
 * The Effect pin's agreement gate — review finding A2.
 *
 * One Effect version is spelled in three CATEGORIES of place, and they must all
 * say the same thing:
 *
 * 1. the pnpm catalog (`pnpm-workspace.yaml`) — what every workspace-local
 *    member resolves through;
 * 2. root `pnpm.overrides` (`package.json`) — what collapses transitive
 *    resolution to one copy;
 * 3. the LITERAL specs in the `@kolu/surface*` manifests.
 *
 * **Why (3) exists at all.** `catalog:` is workspace-local. drishti and odu
 * vendor the `packages/surface*` DIRECTORIES from a content-addressed pin and
 * install their `dependencies` from their own workspace, where kolu's catalog
 * does not exist — so a `catalog:` spec there is unresolvable for the consumer
 * that matters most. Those manifests spell the version literally, and the rest
 * of the workspace must not: a literal anywhere else is a fourth place to forget.
 * The gate enforces BOTH directions — a vendored manifest owes a literal equal
 * to the catalog's, every other manifest owes exactly `catalog:`.
 *
 * **Why the sites are DISCOVERED, not listed.** A hardcoded list of the nine
 * files is the enumeration-without-a-counter problem the finding named: a tenth
 * pin site appears, nobody edits the list, and the gate passes while the
 * versions have split. So the walk finds every `package.json` in the tree and
 * every effect-family dependency in it. A new manifest, a new `@effect/*`
 * package, a new dependency section — each joins the gate by existing.
 *
 * A package name that appears in a manifest but has no catalog AND override
 * entry fails too: those two are how a version stays single, and a family
 * member outside them resolves on its own.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

/** A single spelling of an effect-family version. */
export interface EffectPin {
  /** Repo-relative path, POSIX separators. */
  readonly path: string;
  /** Which block inside that file — `catalog`, `pnpm.overrides`, a dep section. */
  readonly where: string;
  /** The effect-family package name. */
  readonly pkg: string;
  /** The version spec exactly as written. */
  readonly spec: string;
}

/** `effect` and everything published alongside it under the `@effect` scope. */
export function isEffectFamily(pkg: string): boolean {
  return pkg === "effect" || pkg.startsWith("@effect/");
}

/** The manifests whose version must be spelled LITERALLY: the `@kolu/surface*`
 *  package roots, which external consumers vendor as directories. `example`
 *  trees below them are not vendored and are excluded by the `[^/]*`. */
const VENDORED_MANIFEST = /^packages\/surface[^/]*\/package\.json$/;

/** True for a manifest an external consumer installs outside kolu's workspace. */
export function isVendoredManifest(relPath: string): boolean {
  return VENDORED_MANIFEST.test(relPath);
}

const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

interface Manifest {
  readonly [key: string]: unknown;
}

function record(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, string> = {};
  for (const [key, spec] of Object.entries(value as Record<string, unknown>)) {
    if (typeof spec === "string") out[key] = spec;
  }
  return out;
}

/** The effect-family specs a manifest declares, across every dep section. */
export function manifestPins(relPath: string, manifest: Manifest): EffectPin[] {
  const out: EffectPin[] = [];
  for (const where of DEP_SECTIONS) {
    for (const [pkg, spec] of Object.entries(record(manifest[where]))) {
      if (isEffectFamily(pkg)) out.push({ path: relPath, where, pkg, spec });
    }
  }
  return out;
}

/** The effect-family entries of root `pnpm.overrides`. Scoped overrides
 *  (`a>b`) name a resolution PATH rather than a package and are left alone. */
export function overridePins(relPath: string, manifest: Manifest): EffectPin[] {
  const overrides = record(
    (manifest as { pnpm?: { overrides?: unknown } }).pnpm?.overrides,
  );
  const out: EffectPin[] = [];
  for (const [pkg, spec] of Object.entries(overrides)) {
    if (isEffectFamily(pkg)) {
      out.push({ path: relPath, where: "pnpm.overrides", pkg, spec });
    }
  }
  return out;
}

/** The effect-family entries of the pnpm catalog. */
export function catalogPins(relPath: string, yamlText: string): EffectPin[] {
  const parsed = parseYaml(yamlText) as { catalog?: unknown };
  const out: EffectPin[] = [];
  for (const [pkg, spec] of Object.entries(record(parsed.catalog))) {
    if (isEffectFamily(pkg)) {
      out.push({ path: relPath, where: "catalog", pkg, spec });
    }
  }
  return out;
}

/** Trees whose manifests kolu does not own or does not ship. `osfacts-client` is
 *  grafted in from another repo's pin (nix/workspace.nix) and is not committed
 *  here, so its manifest is not ours to police. */
const SKIPPED = new Set([
  "node_modules",
  "dist",
  ".git",
  ".direnv",
  ".logs",
  "apm_modules",
  "osfacts-client",
]);

function walkManifests(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkManifests(full, out);
    else if (entry === "package.json") out.push(full);
  }
}

/** Every spelling of an effect-family version in the tree — catalog, overrides,
 *  and every `package.json` anywhere below the repo root. */
export function collectEffectPins(repoRoot: string): EffectPin[] {
  const pins: EffectPin[] = [
    ...catalogPins(
      "pnpm-workspace.yaml",
      readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"),
    ),
  ];
  const files: string[] = [];
  walkManifests(repoRoot, files);
  for (const full of files.sort()) {
    const rel = path.relative(repoRoot, full).split(path.sep).join("/");
    const manifest = JSON.parse(readFileSync(full, "utf8")) as Manifest;
    if (rel === "package.json") pins.push(...overridePins(rel, manifest));
    pins.push(...manifestPins(rel, manifest));
  }
  return pins;
}

const CATALOG_REF = "catalog:";

function describe(pin: EffectPin): string {
  return `${pin.path} (${pin.where}) ${pin.pkg}: ${pin.spec}`;
}

/**
 * Throw unless every pin site agrees, and return the one version they agree on.
 *
 * The returned version is the repo's single answer to "which Effect is this?" —
 * `betaAssumptions` keys its marker tags off it, so a bump moves both gates at
 * once.
 */
export function validateEffectPins(pins: readonly EffectPin[]): string {
  const problems: string[] = [];
  const catalog = pins.filter((pin) => pin.where === "catalog");
  if (catalog.length === 0) {
    throw new Error(
      "pnpm-workspace.yaml declares no effect-family catalog entry — the catalog IS the version.",
    );
  }
  const versions = new Set(catalog.map((pin) => pin.spec));
  if (versions.size > 1) {
    throw new Error(
      `the pnpm catalog spells more than one Effect version — every @effect/* package must resolve to the same version as \`effect\`:\n${catalog
        .map((pin) => `  ${describe(pin)}`)
        .join("\n")}`,
    );
  }
  const version = catalog[0]?.spec ?? "";
  if (version === CATALOG_REF || version.length === 0) {
    throw new Error(`the pnpm catalog holds a non-version spec: ${version}`);
  }
  const catalogued = new Set(catalog.map((pin) => pin.pkg));

  const overrides = pins.filter((pin) => pin.where === "pnpm.overrides");
  const overridden = new Set(overrides.map((pin) => pin.pkg));
  for (const pin of overrides) {
    if (pin.spec !== version) {
      problems.push(
        `  ${describe(pin)} — must be ${version}, the catalog's version.`,
      );
    }
    if (!catalogued.has(pin.pkg)) {
      problems.push(
        `  ${describe(pin)} — overridden but absent from the catalog; add it there too.`,
      );
    }
  }
  for (const pkg of catalogued) {
    if (!overridden.has(pkg)) {
      problems.push(
        `  package.json (pnpm.overrides) ${pkg} — catalogued but not overridden, so a transitive copy can resolve on its own.`,
      );
    }
  }

  let vendoredLiterals = 0;
  for (const pin of pins) {
    if (pin.where === "catalog" || pin.where === "pnpm.overrides") continue;
    if (!catalogued.has(pin.pkg)) {
      problems.push(
        `  ${describe(pin)} — no catalog entry for ${pin.pkg}; add one (and an override) so its version stays single.`,
      );
      continue;
    }
    if (isVendoredManifest(pin.path)) {
      if (pin.spec === version) {
        vendoredLiterals += 1;
      } else {
        problems.push(
          `  ${describe(pin)} — a vendored @kolu/surface* manifest must spell the literal ${version}; \`catalog:\` is workspace-local and does not resolve for drishti/odu.`,
        );
      }
    } else if (pin.spec !== CATALOG_REF) {
      problems.push(
        `  ${describe(pin)} — must be \`${CATALOG_REF}\`; only the vendored @kolu/surface* manifests spell a literal version.`,
      );
    }
  }
  if (vendoredLiterals === 0) {
    problems.push(
      "  no vendored @kolu/surface* manifest spells a literal version — the external-consumer pins have vanished.",
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Effect pin sites disagree (A2). The catalog says ${version}:\n${problems.join("\n")}`,
    );
  }
  return version;
}

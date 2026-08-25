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
 * 3. the LITERAL specs in the manifests that must resolve OUTSIDE this
 *    workspace — everything an external consumer vendors, and the grafted
 *    `osfacts-client`.
 *
 * **Why (3) exists at all.** `catalog:` is workspace-local, and two kinds of
 * manifest here are read somewhere kolu's catalog does not exist:
 *
 *   - **vendored OUT.** drishti and odu vendor the `packages/surface*`
 *     DIRECTORIES from a content-addressed pin, and olai vendors
 *     `packages/padi-client` (juspay/kolu#2216); each installs those
 *     directories' `dependencies` from its own workspace, so a `catalog:` spec
 *     there is unresolvable for the consumer that matters most.
 *   - **grafted IN.** `osfacts-client` is juspay/osfacts' `client-ts/`, copied
 *     into the tree from the npins pin (`nix/workspace.nix`, and the justfile's
 *     working-tree twin). Its manifest is authored in THAT repo's workspace,
 *     which has no kolu catalog to resolve against either — so it owes a
 *     literal for the mirror-image reason.
 *
 * The rest of the workspace must not spell one: a literal anywhere else is a
 * fourth place to forget. The gate enforces BOTH directions — a manifest that
 * owes a literal owes one equal to the catalog's, every other manifest owes
 * exactly `catalog:`.
 *
 * **Why the sites are DISCOVERED, not listed.** A hardcoded list of the nine
 * files is the enumeration-without-a-counter problem the finding named: a tenth
 * pin site appears, nobody edits the list, and the gate passes while the
 * versions have split. So the walk finds every `package.json` in the tree and
 * every effect-family dependency in it. A new manifest, a new `@effect/*`
 * package, a new dependency section — each joins the gate by existing.
 *
 * **The same rule applies to WHICH manifests owe a literal.** Vendoring is a
 * package-DIRECTORY act, but what it costs is the whole transitive
 * `dependencies` closure of that directory — so `@kolu/padi-client` arriving in
 * olai brought `@kolu/terminal-vocab`, `kolu-transcript-core` and the
 * integrations with it, none of which anyone would have thought to list. Which
 * directories are vendored, and what their closure costs, is `vendorEntries.ts`'s
 * subject, not this file's — this gate takes the answer as data (the `vendored`
 * set every function below is handed) and polices Effect versions against it.
 *
 * A package name that appears in a manifest but has no catalog AND override
 * entry fails too: those two are how a version stays single, and a family
 * member outside them resolves on its own.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
// Effect's own YAML parser, not the `yaml` package: this file's inputs are
// machine-generated (pnpm-workspace.yaml), the workspace already depends on
// Effect here, and using it drops a dependency rather than adding one. Both
// parsers were run over the real inputs before the swap — deep-equal, and
// faster. `unstable/` is Effect's pre-1.0-stability namespace, which is the
// same bet this whole repo already makes on `unstable/rpc` for its wire.
//
// NOT a general recommendation: `@kolu/solid-markdown` deliberately keeps the
// `yaml` package, because its input is USER-authored front matter and this
// parser diverges there (multi-line plain scalars, cyclic anchors, a ` #`
// comment after an apostrophe). Machine-generated input only.
import { Yaml } from "effect/unstable/encoding";

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

/** The manifest grafted in from the `osfacts` pin — juspay/osfacts'
 *  `client-ts/package.json`, which is authored and installed in THAT repo's
 *  workspace. Not `startsWith`: only the graft ROOT is the manifest we mean. */
export function isGraftedManifest(relPath: string): boolean {
  return relPath === "osfacts-client/package.json";
}

/** Why a manifest owes a LITERAL version rather than `catalog:` — the phrase the
 *  gate's message uses, so a failure explains itself instead of naming a rule.
 *  `null` for the ordinary workspace member, which owes `catalog:`. */
export function literalReason(
  relPath: string,
  vendored: ReadonlySet<string>,
): string | null {
  if (vendored.has(relPath))
    return "in a vendored package's dependency closure; `catalog:` is workspace-local and does not resolve for the repo that copies these directories (drishti/odu, olai)";
  if (isGraftedManifest(relPath))
    return "the manifest grafted from the `osfacts` pin; it is authored in juspay/osfacts' own workspace, where kolu's catalog does not exist";
  return null;
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
  const parsed = Yaml.parse(yamlText) as { catalog?: unknown };
  const out: EffectPin[] = [];
  for (const [pkg, spec] of Object.entries(record(parsed.catalog))) {
    if (isEffectFamily(pkg)) {
      out.push({ path: relPath, where: "catalog", pkg, spec });
    }
  }
  return out;
}

/** Trees with no manifest of kolu's to police — build output, VCS and tool
 *  state. `osfacts-client` is deliberately NOT here any more: it is grafted from
 *  the `osfacts` pin rather than committed, but the client now DECLARES an
 *  effect dependency, and a graft whose Effect disagreed with this workspace's
 *  would put two copies in one process — exactly the split this gate exists to
 *  refuse. Not ours to author is not the same as not ours to check. */
const SKIPPED = new Set([
  "node_modules",
  "dist",
  ".git",
  ".direnv",
  ".logs",
  "apm_modules",
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
export function validateEffectPins(
  pins: readonly EffectPin[],
  vendored: ReadonlySet<string>,
): string {
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
    const reason = literalReason(pin.path, vendored);
    if (reason !== null) {
      if (pin.spec === version) {
        if (vendored.has(pin.path)) vendoredLiterals += 1;
      } else {
        problems.push(
          `  ${describe(pin)} — must spell the literal ${version}: it is ${reason}.`,
        );
      }
    } else if (pin.spec !== CATALOG_REF) {
      problems.push(
        `  ${describe(pin)} — must be \`${CATALOG_REF}\`; only the manifests read outside this workspace spell a literal version.`,
      );
    }
  }
  // Only the VENDORED literals are required to exist: those files are committed
  // here, so their disappearance is a kolu edit and a real regression. The
  // grafted manifest is a copy of another repo's file that a bare checkout has
  // not materialised yet, and osfacts is free to stop depending on Effect — so
  // it is policed WHEN PRESENT rather than demanded. (A graft that failed to
  // happen at all fails the `pnpm install` this gate runs after, loudly.)
  if (vendoredLiterals === 0) {
    problems.push(
      "  no vendored manifest spells a literal version — the external-consumer pins have vanished.",
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Effect pin sites disagree (A2). The catalog says ${version}:\n${problems.join("\n")}`,
    );
  }
  return version;
}

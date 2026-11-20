import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Yaml } from "effect/encoding";

export interface EffectPin {
  readonly path: string;
  readonly where: string;
  readonly pkg: string;
  readonly spec: string;
}

export function isEffectFamily(pkg: string): boolean {
  return pkg === "effect" || pkg.startsWith("@effect/");
}

export function literalReason(
  relPath: string,
  vendored: ReadonlySet<string>,
  grafted: ReadonlySet<string>,
): string | null {
  if (grafted.has(relPath))
    return "a manifest grafted from an npins pin; it is authored in that repo's own workspace, where kolu's catalog does not exist";
  if (vendored.has(relPath))
    return "in a vendored package's dependency closure; `catalog:` is workspace-local and does not resolve for the repo that copies these directories (drishti/odu, olai)";
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

export function manifestPins(relPath: string, manifest: Manifest): EffectPin[] {
  const out: EffectPin[] = [];
  for (const where of DEP_SECTIONS) {
    for (const [pkg, spec] of Object.entries(record(manifest[where]))) {
      if (isEffectFamily(pkg)) out.push({ path: relPath, where, pkg, spec });
    }
  }
  return out;
}

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

const SKIPPED = new Set(["node_modules", "dist", ".git", ".direnv", ".logs"]);

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

function nonSymlinkEntries(dir: string): DirEntry[] {
  const out: DirEntry[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    out.push({ name, path: full, isDirectory: stat.isDirectory() });
  }
  return out;
}

function walkManifests(dir: string, out: string[]): void {
  for (const entry of nonSymlinkEntries(dir)) {
    if (SKIPPED.has(entry.name)) continue;
    if (entry.isDirectory) walkManifests(entry.path, out);
    else if (entry.name === "package.json") out.push(entry.path);
  }
}

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

export function validateEffectPins(
  pins: readonly EffectPin[],
  vendored: ReadonlySet<string>,
  grafted: ReadonlySet<string>,
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
    const reason = literalReason(pin.path, vendored, grafted);
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

/**
 * The Effect pin gate's own gate. The gate is only worth anything if a NEW pin
 * site cannot slip past it, so each test here is a way a version could split:
 * a catalog that says two things, an override left behind at the old version, a
 * vendored manifest that switched to `catalog:` (unresolvable for drishti/odu),
 * a literal that crept into an ordinary member, and a family package that has
 * neither catalog nor override entry backing it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogPins,
  type EffectPin,
  isEffectFamily,
  isGraftedManifest,
  isVendoredManifest,
  literalReason,
  manifestPins,
  overridePins,
  validateEffectPins,
} from "./effectPin";

const V = "4.0.0-beta.102";

const catalog = (...pkgs: string[]): EffectPin[] =>
  pkgs.map((pkg) => ({
    path: "pnpm-workspace.yaml",
    where: "catalog",
    pkg,
    spec: V,
  }));

const overrides = (...pkgs: string[]): EffectPin[] =>
  pkgs.map((pkg) => ({
    path: "package.json",
    where: "pnpm.overrides",
    pkg,
    spec: V,
  }));

const vendored: EffectPin = {
  path: "packages/surface/package.json",
  where: "dependencies",
  pkg: "effect",
  spec: V,
};

const grafted: EffectPin = {
  path: "osfacts-client/package.json",
  where: "dependencies",
  pkg: "effect",
  spec: V,
};

const member: EffectPin = {
  path: "packages/padi/package.json",
  where: "dependencies",
  pkg: "effect",
  spec: "catalog:",
};

/** The vendored set as DATA — what `vendoredManifests(repoRoot)` would have
 *  walked, stated here so these pins exercise the rule without reading the tree.
 *  A closure member (`@kolu/terminal-vocab`) is included deliberately: what
 *  vendoring costs is the whole `dependencies` closure of the copied directory,
 *  not just its root. */
const VENDORED = new Set([
  "packages/surface/package.json",
  "packages/surface-daemon-supervisor/package.json",
  "packages/padi-client/package.json",
  "packages/terminal-vocab/package.json",
]);

const agreeing = (...extra: EffectPin[]): EffectPin[] => [
  ...catalog("effect"),
  ...overrides("effect"),
  vendored,
  member,
  ...extra,
];

test("the family is `effect` plus the whole @effect scope, nothing else", () => {
  assert.ok(isEffectFamily("effect"));
  assert.ok(isEffectFamily("@effect/platform-node"));
  assert.ok(!isEffectFamily("effect-ts-helpers"));
  assert.ok(!isEffectFamily("@effectful/core"));
});

test("the vendored set is a package's whole dependency closure, and nothing else", () => {
  assert.ok(isVendoredManifest("packages/surface/package.json", VENDORED));
  assert.ok(
    isVendoredManifest(
      "packages/surface-daemon-supervisor/package.json",
      VENDORED,
    ),
  );
  // A closure member of a vendored entry owes a literal too — it is installed
  // from the consumer's workspace exactly as the entry is.
  assert.ok(
    isVendoredManifest("packages/terminal-vocab/package.json", VENDORED),
  );
  // An example tree below a vendored package is not itself vendored, and
  // neither is the daemon @kolu/padi-client was carved OUT of.
  assert.ok(
    !isVendoredManifest("packages/surface/example/package.json", VENDORED),
  );
  assert.ok(!isVendoredManifest("packages/padi/package.json", VENDORED));
});

test("a manifest's pins are read from every dependency section", () => {
  const pins = manifestPins("packages/x/package.json", {
    dependencies: { effect: V, "solid-js": "^1.9.0" },
    devDependencies: { "@effect/vitest": "catalog:" },
    peerDependencies: { "@effect/platform-node": "catalog:" },
  });
  assert.deepEqual(
    pins.map((pin) => `${pin.where}/${pin.pkg}`),
    [
      "dependencies/effect",
      "devDependencies/@effect/vitest",
      "peerDependencies/@effect/platform-node",
    ],
  );
});

test("a scoped override names a resolution path, not a package, and is skipped", () => {
  const pins = overridePins("package.json", {
    pnpm: { overrides: { effect: V, "some-pkg>effect": V, qs: "^6" } },
  });
  assert.deepEqual(
    pins.map((pin) => pin.pkg),
    ["effect"],
  );
});

test("the catalog is read out of pnpm-workspace.yaml", () => {
  const pins = catalogPins(
    "pnpm-workspace.yaml",
    [
      "catalog:",
      `  effect: ${V}`,
      `  "@effect/vitest": ${V}`,
      "  yaml: 2.8.3",
    ].join("\n"),
  );
  assert.deepEqual(
    pins.map((pin) => pin.pkg),
    ["effect", "@effect/vitest"],
  );
});

test("an agreeing tree passes and hands back the one version", () => {
  assert.equal(validateEffectPins(agreeing(), VENDORED), V);
});

test("a catalog that says two things fails before anything else is judged", () => {
  assert.throws(
    () =>
      validateEffectPins(
        [
          ...catalog("effect"),
          {
            path: "pnpm-workspace.yaml",
            where: "catalog",
            pkg: "@effect/vitest",
            spec: "4.0.0-beta.101",
          },
        ],
        VENDORED,
      ),
    /more than one Effect version/,
  );
});

test("an override left at the old version fails", () => {
  assert.throws(
    () =>
      validateEffectPins(
        [
          ...catalog("effect"),
          {
            path: "package.json",
            where: "pnpm.overrides",
            pkg: "effect",
            spec: "4.0.0-beta.101",
          },
          vendored,
        ],
        VENDORED,
      ),
    /pnpm\.overrides.*must be 4\.0\.0-beta\.102/s,
  );
});

test("a catalogued package with no override fails — a transitive copy could resolve alone", () => {
  assert.throws(
    () =>
      validateEffectPins(
        [
          ...catalog("effect", "@effect/vitest"),
          ...overrides("effect"),
          vendored,
        ],
        VENDORED,
      ),
    /@effect\/vitest — catalogued but not overridden/,
  );
});

test("a vendored manifest that switched to `catalog:` fails — it does not resolve for drishti/odu", () => {
  assert.throws(
    () =>
      validateEffectPins(
        [
          ...catalog("effect"),
          ...overrides("effect"),
          { ...vendored, spec: "catalog:" },
        ],
        VENDORED,
      ),
    /must spell the literal 4\.0\.0-beta\.102: it is in a vendored package's dependency closure/,
  );
});

test("only the graft ROOT is grafted — a path merely under it is not", () => {
  assert.ok(isGraftedManifest("osfacts-client/package.json"));
  assert.ok(!isGraftedManifest("osfacts-client/example/package.json"));
  assert.ok(!isGraftedManifest("packages/padi/package.json"));
});

test("each literal-owing manifest gives its OWN reason, and a member gives none", () => {
  // The two reasons are mirror images and must not be conflated: one manifest
  // is vendored OUT of this workspace, the other is grafted IN from another.
  assert.match(
    literalReason("packages/surface/package.json", VENDORED) ?? "",
    /drishti\/odu, olai/,
  );
  assert.match(
    literalReason("osfacts-client/package.json", VENDORED) ?? "",
    /juspay\/osfacts' own workspace/,
  );
  assert.equal(literalReason("packages/padi/package.json", VENDORED), null);
});

test("the grafted osfacts-client manifest is policed, not skipped", () => {
  // It used to be excluded outright — the client was zero-dependency, so there
  // was nothing to disagree about. It declares `effect` now, and a graft on a
  // different Effect than this workspace would put two copies in one process.
  assert.equal(validateEffectPins(agreeing(grafted), VENDORED), V);
  assert.throws(
    () =>
      validateEffectPins(
        agreeing({ ...grafted, spec: "4.0.0-beta.101" }),
        VENDORED,
      ),
    /osfacts-client\/package\.json.*must spell the literal 4\.0\.0-beta\.102/s,
  );
});

test("the grafted manifest owes a LITERAL — `catalog:` does not resolve in osfacts' workspace", () => {
  assert.throws(
    () =>
      validateEffectPins(agreeing({ ...grafted, spec: "catalog:" }), VENDORED),
    /osfacts-client\/package\.json.*grafted from the `osfacts` pin/s,
  );
});

test("an ABSENT graft still passes — the vendored literals are the required ones", () => {
  // A bare checkout has not materialised `osfacts-client/` yet, and osfacts is
  // free to stop depending on Effect. Neither is a version split.
  assert.equal(validateEffectPins(agreeing(), VENDORED), V);
});

test("a stale literal in a vendored manifest fails against the catalog", () => {
  assert.throws(
    () =>
      validateEffectPins(
        [
          ...catalog("effect"),
          ...overrides("effect"),
          { ...vendored, spec: "4.0.0-beta.101" },
        ],
        VENDORED,
      ),
    /packages\/surface\/package\.json/,
  );
});

test("a literal that crept into an ordinary member fails — that is a fourth place to forget", () => {
  assert.throws(
    () => validateEffectPins(agreeing({ ...member, spec: V }), VENDORED),
    /packages\/padi\/package\.json.*must be `catalog:`/s,
  );
});

test("a range in an ordinary member fails just as hard as a literal", () => {
  assert.throws(
    () => validateEffectPins(agreeing({ ...member, spec: "^4.0.0" }), VENDORED),
    /must be `catalog:`/,
  );
});

test("a family package with no catalog entry fails, wherever it is declared", () => {
  assert.throws(
    () =>
      validateEffectPins(
        agreeing({
          path: "packages/padi/package.json",
          where: "dependencies",
          pkg: "@effect/experimental",
          spec: "catalog:",
        }),
        VENDORED,
      ),
    /no catalog entry for @effect\/experimental/,
  );
});

test("losing every vendored literal fails — the external-consumer pins would be gone", () => {
  assert.throws(
    () =>
      validateEffectPins(
        [...catalog("effect"), ...overrides("effect"), member],
        VENDORED,
      ),
    /external-consumer pins have vanished/,
  );
});

test("no catalog at all is a hard stop, not a pass", () => {
  assert.throws(
    () => validateEffectPins([vendored], VENDORED),
    /declares no effect-family catalog entry/,
  );
});

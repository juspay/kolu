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
  isVendoredManifest,
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

const member: EffectPin = {
  path: "packages/padi/package.json",
  where: "dependencies",
  pkg: "effect",
  spec: "catalog:",
};

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

test("only a surface package ROOT is vendored — its example tree is not", () => {
  assert.ok(isVendoredManifest("packages/surface/package.json"));
  assert.ok(
    isVendoredManifest("packages/surface-daemon-supervisor/package.json"),
  );
  assert.ok(!isVendoredManifest("packages/surface/example/package.json"));
  assert.ok(!isVendoredManifest("packages/padi/package.json"));
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
  assert.equal(validateEffectPins(agreeing()), V);
});

test("a catalog that says two things fails before anything else is judged", () => {
  assert.throws(
    () =>
      validateEffectPins([
        ...catalog("effect"),
        {
          path: "pnpm-workspace.yaml",
          where: "catalog",
          pkg: "@effect/vitest",
          spec: "4.0.0-beta.101",
        },
      ]),
    /more than one Effect version/,
  );
});

test("an override left at the old version fails", () => {
  assert.throws(
    () =>
      validateEffectPins([
        ...catalog("effect"),
        {
          path: "package.json",
          where: "pnpm.overrides",
          pkg: "effect",
          spec: "4.0.0-beta.101",
        },
        vendored,
      ]),
    /pnpm\.overrides.*must be 4\.0\.0-beta\.102/s,
  );
});

test("a catalogued package with no override fails — a transitive copy could resolve alone", () => {
  assert.throws(
    () =>
      validateEffectPins([
        ...catalog("effect", "@effect/vitest"),
        ...overrides("effect"),
        vendored,
      ]),
    /@effect\/vitest — catalogued but not overridden/,
  );
});

test("a vendored manifest that switched to `catalog:` fails — it does not resolve for drishti/odu", () => {
  assert.throws(
    () =>
      validateEffectPins([
        ...catalog("effect"),
        ...overrides("effect"),
        { ...vendored, spec: "catalog:" },
      ]),
    /vendored @kolu\/surface\* manifest must spell the literal/,
  );
});

test("a stale literal in a vendored manifest fails against the catalog", () => {
  assert.throws(
    () =>
      validateEffectPins([
        ...catalog("effect"),
        ...overrides("effect"),
        { ...vendored, spec: "4.0.0-beta.101" },
      ]),
    /packages\/surface\/package\.json/,
  );
});

test("a literal that crept into an ordinary member fails — that is a fourth place to forget", () => {
  assert.throws(
    () => validateEffectPins(agreeing({ ...member, spec: V })),
    /packages\/padi\/package\.json.*must be `catalog:`/s,
  );
});

test("a range in an ordinary member fails just as hard as a literal", () => {
  assert.throws(
    () => validateEffectPins(agreeing({ ...member, spec: "^4.0.0" })),
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
      ),
    /no catalog entry for @effect\/experimental/,
  );
});

test("losing every vendored literal fails — the external-consumer pins would be gone", () => {
  assert.throws(
    () =>
      validateEffectPins([
        ...catalog("effect"),
        ...overrides("effect"),
        member,
      ]),
    /external-consumer pins have vanished/,
  );
});

test("no catalog at all is a hard stop, not a pass", () => {
  assert.throws(
    () => validateEffectPins([vendored]),
    /declares no effect-family catalog entry/,
  );
});

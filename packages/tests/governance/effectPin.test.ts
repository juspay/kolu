/**
 * The Effect pin gate's own gate. The gate is only worth anything if a NEW pin
 * site cannot slip past it, so each test here is a way a version could split:
 * a catalog that says two things, an override left behind at the old version, a
 * vendored manifest that switched to `catalog:` (unresolvable for drishti/odu),
 * a literal that crept into an ordinary member, and a family package that has
 * neither catalog nor override entry backing it.
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  catalogPins,
  type EffectPin,
  isEffectFamily,
  literalReason,
  manifestPins,
  overridePins,
  validateEffectPins,
} from "./effectPin";
import { vendoredManifests } from "./vendorEntries";

/** `packages/tests/governance/` → the repo root. */
const REPO_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);

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

const vendoredPin: EffectPin = {
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

/** The GRAFTED set as DATA too — what the emitted `nix/consumer-closure.json`
 *  answers with, stated here so these pins exercise the rule without reading the
 *  artifact. Both grafts are named on purpose: the gate answers for the SET
 *  (a caller that spells one manifest by hand is how the odu trio went
 *  unpoliced), which is also why neither parameter has a default. */
const GRAFTED = new Set([
  "osfacts-client/package.json",
  "odu/service-client/package.json",
]);

/** Every test below hands `validateEffectPins` the vendored AND grafted sets as
 *  DATA, so none of them touches the tree. This spares each call site from
 *  repeating the two constants. */
const validate = (pins: readonly EffectPin[]): string =>
  validateEffectPins(pins, VENDORED, GRAFTED);

const agreeing = (...extra: EffectPin[]): EffectPin[] => [
  ...catalog("effect"),
  ...overrides("effect"),
  vendoredPin,
  member,
  ...extra,
];

test("the family is `effect` plus the whole @effect scope, nothing else", () => {
  assert.ok(isEffectFamily("effect"));
  assert.ok(isEffectFamily("@effect/platform-node"));
  assert.ok(!isEffectFamily("effect-ts-helpers"));
  assert.ok(!isEffectFamily("@effectful/core"));
});

test("the vendored set is an entry's whole dependency closure, walked off the real tree", () => {
  // The claim is about the CLOSURE, so it is made against the live walk rather
  // than a set literal: `@kolu/terminal-vocab` is nobody's vendored ENTRY — it is
  // reached only through `@kolu/padi-client`'s manifest — and it owes a literal
  // anyway, because a consumer installs it from its own workspace exactly as it
  // installs the entry. `@kolu/padi` is the daemon the client was carved OUT of,
  // and its absence is the whole point of the carve.
  const vendored = vendoredManifests(REPO_ROOT);
  assert.ok(vendored.has("packages/terminal-vocab/package.json"));
  assert.ok(!vendored.has("packages/padi/package.json"));
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
  assert.equal(validate(agreeing()), V);
});

test("a catalog that says two things fails before anything else is judged", () => {
  assert.throws(
    () =>
      validate([
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
      validate([
        ...catalog("effect"),
        {
          path: "package.json",
          where: "pnpm.overrides",
          pkg: "effect",
          spec: "4.0.0-beta.101",
        },
        vendoredPin,
      ]),
    /pnpm\.overrides.*must be 4\.0\.0-beta\.102/s,
  );
});

test("a catalogued package with no override fails — a transitive copy could resolve alone", () => {
  assert.throws(
    () =>
      validate([
        ...catalog("effect", "@effect/vitest"),
        ...overrides("effect"),
        vendoredPin,
      ]),
    /@effect\/vitest — catalogued but not overridden/,
  );
});

test("a vendored manifest that switched to `catalog:` fails — it does not resolve for drishti/odu", () => {
  assert.throws(
    () =>
      validate([
        ...catalog("effect"),
        ...overrides("effect"),
        { ...vendoredPin, spec: "catalog:" },
      ]),
    /must spell the literal 4\.0\.0-beta\.102: it is in a vendored package's dependency closure/,
  );
});

test("each literal-owing manifest gives its OWN reason, and a member gives none", () => {
  // The two reasons are mirror images and must not be conflated: one manifest
  // is vendored OUT of this workspace, the other is grafted IN from another.
  // The graft sentence names the graft rather than one pin, because the set it
  // is answering for comes from `nix/consumer-closure.json` — `osfacts-client`
  // and the `@odu/*` trio get the same reason, and neither tells a reader to
  // edit a manifest kolu does not own.
  assert.match(
    literalReason("packages/surface/package.json", VENDORED, GRAFTED) ?? "",
    /drishti\/odu, olai/,
  );
  assert.match(
    literalReason("osfacts-client/package.json", VENDORED, GRAFTED) ?? "",
    /grafted from an npins pin/,
  );
  assert.match(
    literalReason("odu/service-client/package.json", VENDORED, GRAFTED) ?? "",
    /grafted from an npins pin/,
  );
  assert.equal(
    literalReason("packages/padi/package.json", VENDORED, GRAFTED),
    null,
  );
});

test("the grafted osfacts-client manifest is policed, not skipped", () => {
  // It used to be excluded outright — the client was zero-dependency, so there
  // was nothing to disagree about. It declares `effect` now, and a graft on a
  // different Effect than this workspace would put two copies in one process.
  assert.equal(validate(agreeing(grafted)), V);
  assert.throws(
    () => validate(agreeing({ ...grafted, spec: "4.0.0-beta.101" })),
    /osfacts-client\/package\.json.*must spell the literal 4\.0\.0-beta\.102/s,
  );
});

test("the grafted manifest owes a LITERAL — `catalog:` does not resolve in ITS workspace", () => {
  // The sentence names the GRAFT, not one pin: the set is read from
  // `nix/consumer-closure.json`, so the odu trio gets the same reason as
  // `osfacts-client` (and kolu is never told to edit a manifest it does not own).
  assert.throws(
    () => validate(agreeing({ ...grafted, spec: "catalog:" })),
    /osfacts-client\/package\.json.*grafted from an npins pin/s,
  );
});

test("an ABSENT graft still passes — the vendored literals are the required ones", () => {
  // A bare checkout has not materialised `osfacts-client/` yet, and osfacts is
  // free to stop depending on Effect. Neither is a version split.
  assert.equal(validate(agreeing()), V);
});

test("a stale literal in a vendored manifest fails against the catalog", () => {
  assert.throws(
    () =>
      validate([
        ...catalog("effect"),
        ...overrides("effect"),
        { ...vendoredPin, spec: "4.0.0-beta.101" },
      ]),
    /packages\/surface\/package\.json/,
  );
});

test("a literal that crept into an ordinary member fails — that is a fourth place to forget", () => {
  assert.throws(
    () => validate(agreeing({ ...member, spec: V })),
    /packages\/padi\/package\.json.*must be `catalog:`/s,
  );
});

test("a range in an ordinary member fails just as hard as a literal", () => {
  assert.throws(
    () => validate(agreeing({ ...member, spec: "^4.0.0" })),
    /must be `catalog:`/,
  );
});

test("a family package with no catalog entry fails, wherever it is declared", () => {
  assert.throws(
    () =>
      validate(
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
    () => validate([...catalog("effect"), ...overrides("effect"), member]),
    /external-consumer pins have vanished/,
  );
});

test("no catalog at all is a hard stop, not a pass", () => {
  assert.throws(
    () => validate([vendoredPin]),
    /declares no effect-family catalog entry/,
  );
});

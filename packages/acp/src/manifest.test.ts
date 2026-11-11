/**
 * The package's manifest, as claims a test can hold.
 *
 * The boundary this package IS used to be checked by comments — "nothing above
 * this line spells `session/update`", "a value neither owns, agreed by
 * comment" — and a comment checks nothing. A literal manifest file would be
 * foreign in this tree, so the declaration is spelled the way every other
 * claim here is: as tests over the sources, red the moment a word crosses in
 * either direction.
 *
 * Two readings of an import, because each misses what the other sees:
 *
 *   - {@link specifiersOf} finds every SPECIFIER by position — a quoted name
 *     after `from`, after a bare `import`, inside a dynamic `import(…)` or a
 *     `require(…)` — so a multi-line `import type { … }` is seen (this tree's
 *     dominant style, and the one an import-statement regex is blind to). It
 *     can only over-include — prose in a comment spelling one of those forms
 *     is seen too — and over-inclusion fails CLOSED for a boundary claim;
 *   - the TypeScript emitter's own reading, which ELIDES type-only imports —
 *     which is exactly the instrument for "types only": a specifier that
 *     survives transpilation is one that would actually load.
 *
 * The claims: the domain's words stay out (no `@kolu/*` specifier here, so a
 * kolu type cannot move in by increments — refusals leave as
 * {@link ./asks.ts}'s own `Refused`, translated at the harness seam); the
 * package speaks only ACP; the SDK is TYPES here — the runtime and its zod
 * peer stay in `@kolu/acp-harness`; the protocol enters the tree in a closed
 * set of packages; the export lists are closed and disjoint; and who may
 * import which HALF is a table, so the `./wire` carve-out is a fact and not a
 * comment.
 *
 * The leaf claim is also what makes this package VENDORABLE: olai copies this
 * directory out of a content-addressed kolu pin and compiles it in its own
 * workspace (`packages/tests/governance/vendorEntries.ts`). A `@kolu/*` import
 * here would be a `TS2307` in THEIR compiler.
 */

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, test } from "vitest";

import * as face from "./index.ts";
import * as wire from "./wire.ts";

const PACKAGES = path.join(import.meta.dirname, "..", "..");

/** Every import specifier, by POSITION rather than by statement, so a braced
 *  list broken across lines — most of this tree's imports — is seen. A `from`
 *  in prose followed by a quoted name would be seen too, which is the right
 *  direction to be wrong in: an extra specifier fails a claim rather than
 *  passing one. */
const specifiersOf = (text: string): ReadonlyArray<string> =>
  [
    ...text.matchAll(
      /(?:\bfrom\s*|^\s*import\s*|\bimport\(\s*|\brequire\(\s*)["']([^"'\n]+)["']/gm,
    ),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

/** ... and the specifiers whose statement is NOT `import type` — what would
 *  actually load.
 *
 *  STRICTER than what a transpiler would elide, on purpose: the inline form
 *  (`import { type Foo } from …`) is elided at runtime too, and is still
 *  counted here. A boundary claim must fail closed, and "the whole statement
 *  says `type`" is the form this package writes anyway. */
const valueSpecifiersOf = (text: string): ReadonlyArray<string> =>
  [
    ...text.matchAll(
      /\bimport\s+(type\s+)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s*from\s*["']([^"'\n]+)["']|\bimport\s*["']([^"'\n]+)["']|\bimport\(\s*["']([^"'\n]+)["']|\brequire\(\s*["']([^"'\n]+)["']/g,
    ),
  ].flatMap((match) =>
    match[1] !== undefined
      ? []
      : [match[2] ?? match[3] ?? match[4] ?? match[5] ?? ""],
  );

interface Source {
  readonly file: string;
  readonly specifiers: ReadonlyArray<string>;
  readonly runtime: ReadonlyArray<string>;
}

/** Every `.ts`/`.tsx` under one package, skipping `node_modules`, `dist` and
 *  `.direnv` BEFORE descending — a late filter walks workspace symlinks and
 *  dies on `ELOOP`, and it is also just faster. */
const SKIP: Readonly<Record<string, true>> = {
  node_modules: true,
  dist: true,
  ".direnv": true,
  ".git": true,
  coverage: true,
};
const sourcesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return entry.name in SKIP ? [] : sourcesUnder(path.join(dir, entry.name));
    }
    return entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [path.join(dir, entry.name)]
      : [];
  });

/**
 * EVERY WORKSPACE MEMBER, as its directory relative to `packages/` — so a
 * top-level member is `client` and a nested one is `integrations/claude-code`.
 *
 * Read off the tree rather than listed: a directory under `packages/` with a
 * `package.json` is a member, which is exactly what `pnpm-workspace.yaml`'s
 * `packages/**` glob says. A corpus that came back short is a sweep that did
 * not run, so an empty result throws rather than passing every claim
 * vacuously.
 */
const MEMBERS: ReadonlyArray<string> = (() => {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 2) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name in SKIP) continue;
      const here = path.join(dir, entry.name);
      try {
        readFileSync(path.join(here, "package.json"), "utf8");
        found.push(path.relative(PACKAGES, here).split(path.sep).join("/"));
      } catch {
        walk(here, depth + 1);
      }
    }
  };
  walk(PACKAGES, 1);
  if (found.length === 0) {
    throw new Error(
      "acp: no workspace member found under packages/ — a corpus that came " +
        "back short is a sweep that did not run.",
    );
  }
  return found.sort();
})();

/** The whole tree, read ONCE: every `.ts`/`.tsx` in every member — the
 *  package, not its `src`, so a scripted agent in `tests/agent/` counts —
 *  keyed by the member's directory. */
const tree: ReadonlyMap<string, ReadonlyArray<Source>> = new Map(
  MEMBERS.map((member) => [
    member as string,
    sourcesUnder(path.join(PACKAGES, member)).map((file): Source => {
      // A scripted agent opens with a shebang, which the transpiler
      // refuses; the line holds no import, so dropping it loses nothing.
      const text = readFileSync(file, "utf8").replace(/^#![^\n]*\n/, "");
      return {
        file,
        specifiers: specifiersOf(text),
        runtime: valueSpecifiersOf(text),
      };
    }),
  ]),
);

const sources = (pkg: string): ReadonlyArray<Source> => tree.get(pkg) ?? [];

/** The SDK by any of its doors: the package, or a path under it — the pinned
 *  SDK really exports subpaths (`experimental/v2`, …), and a claim that
 *  matched the bare name alone was green under a subpath import. Inside `acp`
 *  the allowed-list stays the bare name on purpose: reaching for a subpath
 *  there is a manifest edit, not a drift. */
const isSdk = (spec: string): boolean =>
  spec === "@agentclientprotocol/sdk" ||
  spec.startsWith("@agentclientprotocol/sdk/");

describe("the manifest", () => {
  test("the domain's words stay out: this package imports no @kolu sibling", () => {
    for (const source of sources("acp")) {
      const strangers = source.specifiers.filter((spec) =>
        spec.startsWith("@kolu/"),
      );
      expect(strangers, source.file).toEqual([]);
    }
  });

  test("this package speaks only ACP: effect, the SDK, and its own files", () => {
    const allowed = (spec: string): boolean =>
      spec === "effect" ||
      spec === "@agentclientprotocol/sdk" ||
      spec === "vitest" ||
      spec.startsWith("node:") || // the manifest's own reading of the tree
      spec.startsWith("./");
    for (const source of sources("acp")) {
      expect(
        source.specifiers.filter((spec) => !allowed(spec)),
        source.file,
      ).toEqual([]);
    }
  });

  test("the SDK is TYPES here: no import of it survives to runtime", () => {
    // The emitter elides type-only imports, so an SDK specifier it still
    // reports is a runtime one — the import that would drag the SDK's code
    // and its zod peer into a closure that deliberately has neither.
    for (const source of sources("acp")) {
      expect(source.runtime.filter(isSdk), source.file).toEqual([]);
    }
  });

  test("the protocol enters the tree here and in the harness alone", () => {
    // The harness is the one package in this tree that SPAWNS an ACP
    // subprocess, so it is the one that carries the SDK's runtime. An agent's
    // integration leg names none of the SDK's types in its production
    // sources — `@kolu/acp/engine` carries the ones a leg's signatures need —
    // which is why this list can still be written down.
    const speaking = [...tree.keys()].filter((pkg) =>
      sources(pkg).some((source) => source.specifiers.some(isSdk)),
    );
    expect(speaking.sort()).toEqual(["acp", "acp-harness"]);
  });

  test("what may cross is enumerated: the export lists are closed and disjoint", () => {
    // Runtime exports only — `Form` is a type and invisible here, which is
    // fine: a type smuggles no value across, and the schemas ARE values. The
    // main entry is the PROJECTIONS: the vocabulary rides `./wire` alone,
    // because a second door to the same word is a door somebody eventually
    // uses.
    expect(Object.keys(face).sort()).toEqual([
      "AUTH_STATUS_METHOD",
      "PERMISSION_FIELD",
      "Refused",
      "contentOf",
      "diffsOf",
      "formOf",
      "hostOf",
      "identityIn",
      "nativeActivity",
      "permissionFormOf",
      "relativeTo",
      "terminalMetaIn",
      "urlOf",
      "usageIn",
    ]);
    // ... and the wire half carries the vocabulary alone: no payload reader
    // rides the subpath a surface declaration re-exports.
    expect(Object.keys(wire).sort()).toEqual([
      "AskAnswer",
      "AskChoice",
      "AskField",
      "AskLink",
      "AskOutcome",
      "AuthAccount",
      "AuthStatus",
      "FileDiff",
      "Usage",
      "YES_NO",
    ]);
  });

  /**
   * WHO MAY OPEN WHICH DOOR, as a table.
   *
   * `./engine` carries the shape an AGENT INTEGRATION registers — the leg that
   * reads one agent's wire, the adapter that starts it, the sentence for a
   * machine that has not installed it. An integration may not import
   * `@kolu/acp-harness` and the harness may not import an integration, so the
   * shape they both spell lives under both of them, here.
   *
   * Every other member's `[]` is what says nothing else opens any of them.
   */
  const MAY: Readonly<Record<string, ReadonlyArray<string>>> = {
    // THE ONLY ROW WITH ALL THREE, and that is what the harness IS: it runs
    // the protocol, so it reads the projections (`.`), spells the leg and the
    // adapter it was handed (`./engine`), and writes the vocabulary padi's
    // contract carries (`./wire`).
    "acp-harness": ["@kolu/acp", "@kolu/acp/engine", "@kolu/acp/wire"],
    // An agent's integration registers its engine through `./engine` and reads
    // nothing else: the leg's own signatures, the adapter it spawns, and the
    // `NotHere` a machine without it is owed all live there. The projections
    // are the harness's to run, and the wire's words are the surface's to
    // carry.
    "integrations/claude-code": ["@kolu/acp/engine"],
    // kolu's browser-safe contract half declares the orchestrator's members in
    // the protocol's own vocabulary rather than re-spelling it: the wire door
    // and nothing else. It was `padi-client`'s row until the conversation
    // stopped being a host's and became kolu-server's — the orchestrator's
    // vocabulary moved with its home.
    common: ["@kolu/acp/wire"],
    // The agent REGISTRY is where per-agent knowledge is folded, so the ACP
    // engine the orchestrator runs is registered there too — a daemon
    // that named one agent directly would be the defect
    // `agentDepFence.test.ts` exists to refuse.
    "integrations/agents": ["@kolu/acp/engine"],
    // kolu-server HOSTS the conversation, so it reads the ENGINE door alone:
    // the integration's `Registering` — its name, its leg, and whether this
    // machine has the adapter at all. The protocol's own payloads never reach
    // it; `@kolu/acp-harness` is the wall between them.
    server: ["@kolu/acp/engine"],
  };

  test("who may import which half is a table, and the harness is the only row with all of them", () => {
    const imported = new Map<string, ReadonlySet<string>>(
      [...tree.keys()]
        .filter((pkg) => pkg !== "acp")
        .map((pkg) => [
          pkg,
          new Set(
            sources(pkg).flatMap((source) =>
              source.specifiers.filter(
                (spec) => spec === "@kolu/acp" || spec.startsWith("@kolu/acp/"),
              ),
            ),
          ),
        ]),
    );
    for (const [pkg, specs] of imported) {
      expect([...specs].sort(), pkg).toEqual([...(MAY[pkg] ?? [])]);
    }
    // ...and every package the table names is one this walk actually read, so
    // a row left behind by a rename is red rather than silently permissive.
    for (const pkg of Object.keys(MAY)) {
      expect([pkg, imported.has(pkg)]).toEqual([pkg, true]);
    }
  });
});

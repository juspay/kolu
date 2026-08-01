/**
 * The walker's OWN tests (juspay/kolu#2096).
 *
 * `runtimeDepEdges.testlib.ts` is the check every daemon's staleKey rests on —
 * and until now it was only ever exercised THROUGH those daemons, where a green
 * run is equally consistent with "the manifests are honest" and "the walker
 * silently found nothing". So this suite pins both directions:
 *
 *   - POSITIVE — kaval's real entries produce zero violations (the guard that
 *     the daemon tests assert, asserted here against the same live manifests);
 *   - NEGATIVE — a TEST file as entry produces `dev-dependency` violations.
 *     This encodes the manual probe from #2095: a test file legitimately rides
 *     devDependency edges (`vitest`, `@kolu/daemon-test-gate`), so pointing the
 *     walker at one is the cheapest way to prove it still SEES the edge shape
 *     that #2094's silent stale-daemon hole was made of. If this test ever goes
 *     green-by-emptiness, the negative case is what tells us.
 *   - PINNED members — the #2096 graduation: identity for consumers OUTSIDE
 *     this workspace, whose `@kolu/*` packages arrive from a content-addressed
 *     pin. Exercised against a throwaway tmp fixture rather than a repo package,
 *     because the property under test is precisely "a member pnpm never
 *     discovered": any real package here is workspace-discovered by definition.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { walkRuntimeDepEdges } from "./runtimeDepEdges.testlib.ts";

const SRC = dirname(fileURLToPath(import.meta.url)); // packages/daemon-test-gate/src
const REPO_ROOT = resolve(SRC, "../../..");

// ── The pinned-member fixture ────────────────────────────────────────────────
// A tiny package tree in a tmpdir: two "pinned" members (one honest, one with a
// bare edge it never declared) plus a consumer that imports them. `repoRoot`
// stays the real repo — the walker discovers workspace members from it, while
// ownership of a walked file is its NEAREST package.json, so files living
// outside the repo are owned by their own manifest exactly like in-repo ones.
const FIXTURE = mkdtempSync(join(tmpdir(), "kolu-pinned-"));
afterAll(() => rmSync(FIXTURE, { recursive: true, force: true }));

const writePkg = (
  dir: string,
  manifest: object,
  files: Record<string, string>,
) => {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const [rel, body] of Object.entries(files))
    writeFileSync(join(dir, rel), body);
};

const PINNED = join(FIXTURE, "pinned-fixture");
writePkg(
  PINNED,
  {
    name: "pinned-fixture",
    version: "0.0.1",
    type: "module",
    main: "./src/index.ts",
    dependencies: {},
  },
  {
    "src/index.ts": `import { helper } from "./helper.ts";\nexport const pinned = () => helper();\n`,
    "src/helper.ts": `export const helper = () => "pinned";\n`,
  },
);

const LEAKY = join(FIXTURE, "pinned-leaky");
writePkg(
  LEAKY,
  {
    name: "pinned-leaky",
    version: "0.0.1",
    type: "module",
    main: "./src/index.ts",
  },
  {
    "src/index.ts": `import { thing } from "never-declared";\nexport const leak = () => thing;\n`,
  },
);

const CONSUMER = join(FIXTURE, "consumer");
writePkg(
  CONSUMER,
  {
    name: "pinned-consumer",
    version: "0.0.1",
    type: "module",
    // Declared at a plain version, NOT `workspace:` — the whole point of the
    // pinned arm: a pin is spelled however the consuming manifest spells pins.
    dependencies: { "pinned-fixture": "0.0.1", "pinned-leaky": "0.0.1" },
  },
  {
    "src/index.ts": `import { pinned } from "pinned-fixture";\nexport const use = () => pinned();\n`,
    "src/leaky.ts": `import { leak } from "pinned-leaky";\nexport const use = () => leak();\n`,
  },
);

describe("walkRuntimeDepEdges", () => {
  it("finds no violation from kaval's real entries", () => {
    const kavalSrc = resolve(REPO_ROOT, "packages/kaval/src");
    const { violations, reachedPackages } = walkRuntimeDepEdges({
      repoRoot: REPO_ROOT,
      entries: [resolve(kavalSrc, "index.ts"), resolve(kavalSrc, "bin.ts")],
    });
    expect(violations).toEqual([]);
    expect(reachedPackages).toContain("kaval"); // it really walked something
  });

  it("flags the devDependency edges a test file rides (the #2095 probe)", () => {
    const { violations } = walkRuntimeDepEdges({
      repoRoot: REPO_ROOT,
      entries: [
        resolve(
          REPO_ROOT,
          "packages/padi/src/daemonBoot/buildId.closure.test.ts",
        ),
      ],
    });
    expect(violations.map((v) => v.spec)).toEqual(
      expect.arrayContaining([
        "vitest",
        "@kolu/daemon-test-gate/runtimeDepEdges",
      ]),
    );
    // Every edge here is a *declared* devDependency — never "undeclared".
    expect([...new Set(violations.map((v) => v.problem))]).toEqual([
      "dev-dependency",
    ]);
  });

  it("throws when a pinned name is also a workspace member (ambiguous identity)", () => {
    expect(() =>
      walkRuntimeDepEdges({
        repoRoot: REPO_ROOT,
        entries: [resolve(REPO_ROOT, "packages/kaval/src/index.ts")],
        // The real overlap this rule guards: kolu's `osfacts-client` IS a pin
        // (juspay/kolu#2093 grafts it from the npins `osfacts` pin into the
        // root-level `osfacts-client/`), and it is ALSO listed in
        // pnpm-workspace.yaml so pnpm links it. Naming it here too would make
        // one package answer to two membership kinds.
        pinnedMembers: {
          "osfacts-client": resolve(REPO_ROOT, "osfacts-client"),
        },
      }),
    ).toThrow(/ambiguous member identity: 'osfacts-client'/);
  });

  it("walks a pinned member declared at a non-workspace protocol", () => {
    const { violations, reachedPackages } = walkRuntimeDepEdges({
      repoRoot: REPO_ROOT,
      entries: [join(CONSUMER, "src/index.ts")],
      pinnedMembers: { "pinned-fixture": PINNED },
    });
    expect(violations).toEqual([]);
    expect(reachedPackages).toContain("pinned-fixture");
  });

  it("checks a pinned member's own bare edges, not just the consumer's", () => {
    const { violations } = walkRuntimeDepEdges({
      repoRoot: REPO_ROOT,
      entries: [join(CONSUMER, "src/leaky.ts")],
      pinnedMembers: { "pinned-leaky": LEAKY },
    });
    expect(violations).toMatchObject([
      { owner: "pinned-leaky", spec: "never-declared", problem: "undeclared" },
    ]);
  });

  it("leaves an unpinned name unwalked — declared, so no violation, but opaque", () => {
    const { violations, reachedPackages } = walkRuntimeDepEdges({
      repoRoot: REPO_ROOT,
      entries: [join(CONSUMER, "src/index.ts")],
    });
    // Without the pin the import is indistinguishable from an npm external: it
    // IS declared, so nothing is wrong — but nothing behind it was inspected.
    expect(violations).toEqual([]);
    expect(reachedPackages).not.toContain("pinned-fixture");
  });
});

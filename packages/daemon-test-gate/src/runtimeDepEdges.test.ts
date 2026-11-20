import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { walkRuntimeDepEdges } from "./runtimeDepEdges.testlib.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC, "../../..");

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
    expect(reachedPackages).toContain("kaval");
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
    expect([...new Set(violations.map((v) => v.problem))]).toEqual([
      "dev-dependency",
    ]);
  });

  it("throws when a pinned name is also a workspace member (ambiguous identity)", () => {
    expect(() =>
      walkRuntimeDepEdges({
        repoRoot: REPO_ROOT,
        entries: [resolve(REPO_ROOT, "packages/kaval/src/index.ts")],
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
    expect(violations).toEqual([]);
    expect(reachedPackages).not.toContain("pinned-fixture");
  });
});

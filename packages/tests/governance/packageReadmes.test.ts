/**
 * The README gate's own gate. Each test is a way the scan could miss a package
 * that has no README, or demand one from a directory the workspace never
 * declared.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  collectPackageReadmes,
  validatePackageReadmes,
  workspaceGlobs,
} from "./packageReadmes";

/** A temp workspace: `pnpm-workspace.yaml` plus the files named, written for
 *  real, and returned as the tracked-file list the check reads. */
function workspace(
  globs: readonly string[],
  files: readonly string[],
): { root: string; files: string[] } {
  const root = mkdtempSync(join(tmpdir(), "kolu-package-readmes-"));
  writeFileSync(
    join(root, "pnpm-workspace.yaml"),
    `packages:\n${globs.map((glob) => `  - ${glob}\n`).join("")}`,
  );
  for (const file of files) {
    const abs = join(root, file);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, file.endsWith("package.json") ? "{}" : "# doc\n");
  }
  return { root, files: [...files] };
}

test("a package with no README is named, and its neighbour with one is not", () => {
  const { root, files } = workspace(
    ["packages/**"],
    [
      "package.json",
      "packages/told/package.json",
      "packages/told/README.md",
      "packages/silent/package.json",
    ],
  );
  const found = collectPackageReadmes(root, files);
  assert.deepEqual(found.packages, ["packages/silent", "packages/told"]);
  assert.deepEqual(found.missing, ["packages/silent"]);
  assert.throws(
    () => validatePackageReadmes(found.missing),
    (error: Error) =>
      error.message.includes("packages/silent/README.md") &&
      !error.message.includes("packages/told"),
  );
});

test("a nested package is a package — `**` spans directories", () => {
  const { root, files } = workspace(
    ["packages/**"],
    [
      "packages/integrations/pty/package.json",
      "packages/surface/example/snippets/package.json",
      "packages/surface/example/snippets/README.md",
    ],
  );
  assert.deepEqual(collectPackageReadmes(root, files), {
    packages: [
      "packages/integrations/pty",
      "packages/surface/example/snippets",
    ],
    missing: ["packages/integrations/pty"],
  });
});

test("a manifest outside every glob is not the workspace's package", () => {
  // `website/` and `docs/atlas/` carry a package.json and are not members:
  // `packages/**` does not match them, and neither does a grafted path that
  // was never checked out. The globs decide, not the presence of a manifest.
  const { root, files } = workspace(
    ["packages/**", "odu/run-client"],
    ["website/package.json", "docs/atlas/package.json"],
  );
  assert.deepEqual(collectPackageReadmes(root, files), {
    packages: [],
    missing: [],
  });
});

test("a declared path that is a literal is matched exactly", () => {
  const { root, files } = workspace(
    ["osfacts-client"],
    ["osfacts-client/package.json", "osfacts-client-extra/package.json"],
  );
  assert.deepEqual(collectPackageReadmes(root, files).packages, [
    "osfacts-client",
  ]);
});

test("the root manifest is not a package of the workspace", () => {
  const { root, files } = workspace(["packages/**"], ["package.json"]);
  assert.deepEqual(collectPackageReadmes(root, files).packages, []);
});

test("a README written in the working tree counts before it is committed", () => {
  const { root } = workspace(
    ["packages/**"],
    ["packages/draft/package.json", "packages/draft/README.md"],
  );
  // The package list is the committed one, so the README beside a manifest is
  // read off disk: a package whose README is written and not yet `git add`ed
  // is not reported as missing one.
  assert.deepEqual(
    collectPackageReadmes(root, ["packages/draft/package.json"]).missing,
    [],
  );
});

test("a workspace that declares no packages is a hard stop, not a pass", () => {
  assert.throws(
    () => workspaceGlobs("catalog:\n  effect: 4.1.4\n"),
    /declares no `packages:` globs/,
  );
});

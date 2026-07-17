// Drift pin: every out-of-tree file website/default.nix copies into the
// site's Nix build sandbox (the `${../...}` interpolations — favicon, logos,
// kolu-server-package.json, the shared fence scanner) must appear in the
// Pages workflow's push.paths — otherwise changing that file rebuilds the
// derivation but never triggers the deploy, and kolu.dev goes silently
// stale. Before this pin the list had already drifted three entries deep
// (both logos and the server package.json were copied but not listed).
//
// Repo-file scope: default.nix and pages.yml live OUTSIDE the fileset the
// Nix sandbox copies, so this pin runs only from the working tree
// (`just website::check`); in the sandbox checkPhase it skips loudly rather
// than fail on files the sandbox deliberately doesn't have.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const defaultNix = new URL("../default.nix", import.meta.url);
const pagesYml = new URL("../../.github/workflows/pages.yml", import.meta.url);
const inWorkingTree = existsSync(defaultNix) && existsSync(pagesYml);

test("every out-of-tree cp-source in default.nix has a pages.yml deploy trigger", {
  skip:
    !inWorkingTree &&
    "repo files absent (Nix sandbox) — runs under just website::check",
}, () => {
  const nix = readFileSync(fileURLToPath(defaultNix), "utf8");
  // The cp-source mirrors: ${../path/to/file} interpolations (repo-relative
  // once the leading ../ — website/'s parent — is stripped).
  const copied = [...nix.matchAll(/\$\{\.\.\/([^}]+)\}/g)].map((m) => m[1]);
  assert.ok(
    copied.length >= 5,
    `expected the known cp-sources in default.nix, found: ${copied.join(", ")}`,
  );

  const yml = readFileSync(fileURLToPath(pagesYml), "utf8");
  const pathsBlock = yml.match(/paths:\n((?:\s+(?:#[^\n]*|- "[^"]+")\n)+)/);
  assert.ok(pathsBlock, "pages.yml push.paths block not found");
  const triggers = [...pathsBlock[1].matchAll(/- "([^"]+)"/g)].map((m) => m[1]);

  // A trigger covers a copied path if it names it exactly or as a
  // directory glob (`docs/atlas/dist/**` covers `docs/atlas/dist`).
  const covers = (trigger, p) =>
    trigger === p ||
    (trigger.endsWith("/**") && p.startsWith(trigger.slice(0, -3)));
  const missing = copied.filter((p) => !triggers.some((t) => covers(t, p)));
  assert.deepEqual(
    missing,
    [],
    `website/default.nix copies ${missing.join(", ")} into the site build, but pages.yml push.paths never triggers a deploy for it — add the entry`,
  );
});

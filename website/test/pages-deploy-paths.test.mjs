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
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultNix = new URL("../default.nix", import.meta.url);
const pagesYml = new URL("../../.github/workflows/pages.yml", import.meta.url);
const inWorkingTree = existsSync(defaultNix) && existsSync(pagesYml);

// A real YAML parser for the workflow file (a regex over structured data is
// brittle to reformatting); `yaml` is astro's own transitive dep, resolved
// through its require context like the other test-side imports.
const requireFromAstro = createRequire(
  createRequire(import.meta.url).resolve("astro/package.json"),
);
const YAML = await import(pathToFileURL(requireFromAstro.resolve("yaml")).href);

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

  const workflow = YAML.parse(readFileSync(fileURLToPath(pagesYml), "utf8"));
  // YAML 1.1 would read the `on:` key as boolean true; the `yaml` package
  // defaults to 1.2, where it stays the string key GitHub means.
  const triggers = workflow?.on?.push?.paths;
  assert.ok(
    Array.isArray(triggers) && triggers.length > 0,
    "pages.yml push.paths block not found",
  );

  // A trigger covers a copied path if it names it exactly or as a
  // directory glob (`docs/atlas/dist/**` covers `docs/atlas/dist` and
  // everything under `docs/atlas/dist/` — but NOT a sibling like
  // `docs/atlas/dist-staging`, hence the slash-preserving prefix).
  const covers = (trigger, p) =>
    trigger === p ||
    (trigger.endsWith("/**") &&
      (p === trigger.slice(0, -3) || p.startsWith(trigger.slice(0, -2))));
  const missing = copied.filter((p) => !triggers.some((t) => covers(t, p)));
  assert.deepEqual(
    missing,
    [],
    `website/default.nix copies ${missing.join(", ")} into the site build, but pages.yml push.paths never triggers a deploy for it — add the entry`,
  );
});

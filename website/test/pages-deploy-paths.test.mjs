import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultNix = new URL("../default.nix", import.meta.url);
const pagesYml = new URL("../../.github/workflows/pages.yml", import.meta.url);
const inWorkingTree = existsSync(defaultNix) && existsSync(pagesYml);

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

  const triggerCoversPath = (trigger, path) => {
    if (trigger === path) return true;
    if (!trigger.endsWith("/**")) return false;
    const recursiveRoot = trigger.slice(0, -"/**".length);
    return path === recursiveRoot || path.startsWith(`${recursiveRoot}/`);
  };
  const missing = copied.filter(
    (path) => !triggers.some((trigger) => triggerCoversPath(trigger, path)),
  );
  assert.deepEqual(
    missing,
    [],
    `website/default.nix copies ${missing.join(", ")} into the site build, but pages.yml push.paths never triggers a deploy for it — add the entry`,
  );
});

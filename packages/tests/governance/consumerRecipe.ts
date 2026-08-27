/**
 * **The consumer recipe in `nix/README.md`, EVALUATED.**
 *
 * `nix/README.md` opens with the snippet a consuming repo copies into its own
 * `nix/kolu.nix` — the one expression this whole entry point exists to make
 * writable. It was prose, and prose is not executed: the snippet shipped
 * referring to a variable its own `let` never bound, so a consumer who copied
 * the documented pattern got `error: undefined variable 'kolu'` and no clue
 * which half was wrong. It was found by a reviewer running it, which is not a
 * mechanism.
 *
 * So it runs here. The block is extracted from the README, its two
 * CONSUMER-SIDE pins are rebound to this repo's own (a consumer's `../npins` is
 * not a path kolu has), and the result is evaluated. Nothing else is
 * substituted: the seeds, the `koluWith` shape, the `pins` read and the
 * `pinnedSources` record are checked exactly as a reader would copy them.
 *
 * WHAT THIS DOES NOT PROVE: that the copied bytes BUILD. `runCommand` is
 * realised only on `nix build`, and the point here is eval — the arity, the
 * bound names, the attribute paths, and every throw `consumer.nix` raises at
 * eval (an unvendored seed, a `catalog:` external, a missing or drifted pinned
 * source). Those are the failures a consumer meets first and the ones a stale
 * doc causes.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The file the recipe lives in, repo-relative. */
export const CONSUMER_RECIPE_DOC = "nix/README.md";

/** The FIRST ```nix block in the README — the flagship recipe, which is why it
 *  is first. Extracted rather than duplicated here: a copy in this file would be
 *  a second spelling of the thing under test, and it would be the one that
 *  passed. */
export function extractConsumerRecipe(repoRoot: string): string {
  const doc = readFileSync(join(repoRoot, CONSUMER_RECIPE_DOC), "utf8");
  const opened = doc.indexOf("```nix\n");
  if (opened === -1) {
    throw new Error(
      `${CONSUMER_RECIPE_DOC} has no \`\`\`nix block. The consumer recipe is the ` +
        `first one; if it moved or lost its fence, this check is now watching ` +
        `nothing — restore it or delete this gate deliberately.`,
    );
  }
  const body = doc.slice(opened + "```nix\n".length);
  const closed = body.indexOf("\n```");
  if (closed === -1) {
    throw new Error(
      `${CONSUMER_RECIPE_DOC}'s first \`\`\`nix block is unclosed.`,
    );
  }
  return body.slice(0, closed);
}

/** Evaluate it, with only the consumer-side pins rebound.
 *
 *  Returns the closure size the recipe walks to, so the caller can print
 *  something that would look wrong if this ever silently degraded to evaluating
 *  an empty expression. */
export function checkConsumerRecipeEvaluates(repoRoot: string): number {
  const recipe = extractConsumerRecipe(repoRoot);

  // The two substitutions, and they are the whole list. A consumer's `../npins`
  // holds ITS pins of kolu and osfacts; this repo is the kolu, and its own npins
  // holds the osfacts that `consumer-closure.json` was emitted against — which
  // is exactly the revision the recipe must agree with, so the check exercises
  // the agreeing case rather than a contrived one.
  const bound = recipe
    .replace("(import ../npins).kolu;", `${JSON.stringify(repoRoot)};`)
    .replace("(import ../npins).osfacts;", "(import ./npins).osfacts;");
  if (bound === recipe) {
    throw new Error(
      `${CONSUMER_RECIPE_DOC}'s recipe no longer binds its pins as ` +
        `\`(import ../npins).kolu\` / \`(import ../npins).osfacts\`, so this check ` +
        `could not point it at this repo. Update the substitution here to match ` +
        `the doc — do not "fix" the doc to match this file.`,
    );
  }

  const expr = `
    let pkgs = import ${JSON.stringify(repoRoot)}/nix/nixpkgs.nix { system = builtins.currentSystem; };
    in builtins.length (${bound}).names`;

  try {
    const out = execFileSync(
      "nix",
      ["eval", "--accept-flake-config", "--impure", "--json", "--expr", expr],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(out) as number;
  } catch (err) {
    // The nix error is the WHOLE point — it is what a consumer would have seen —
    // so it is carried through verbatim rather than summarised into "recipe
    // failed", which would leave the next reader running it by hand to find out
    // what this already knew.
    const stderr = (err as { stderr?: string }).stderr ?? "";
    throw new Error(
      `${CONSUMER_RECIPE_DOC}'s consumer recipe does not evaluate. This is the ` +
        `snippet a consuming repo copies verbatim, so a reader hits this before ` +
        `anything else kolu documents:\n\n${stderr.trim()}`,
    );
  }
}

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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nixEvalJson, nixpkgsPreamble } from "./nixEval";

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
  // EACH rebind is checked, not the pair: a doc that renames one of them would
  // otherwise slip past a `bound === recipe` test and fail later on a nix path
  // error, which names the wrong thing.
  const rebinds: [string, string][] = [
    ["(import ../npins).kolu;", `${JSON.stringify(repoRoot)};`],
    ["(import ../npins).osfacts;", "(import ./npins).osfacts;"],
  ];
  let bound = recipe;
  for (const [from, to] of rebinds) {
    if (!bound.includes(from)) {
      throw new Error(
        `${CONSUMER_RECIPE_DOC}'s recipe no longer binds \`${from}\`, so this check ` +
          `could not point it at this repo. Update the substitution here to match ` +
          `the doc — do not "fix" the doc to match this file.`,
      );
    }
    bound = bound.replace(from, to);
  }

  // `.names` alone forces almost nothing. `pinnedProblems` checks `given ? src`
  // — PRESENCE, not value — and forces only `given.revision`, so every error
  // inside the `src` expression is invisible on that spine: a recipe reading
  // `pins.osfacts-client.NOSUCHATTR` evaluated clean and this gate reported a
  // healthy 28 members. That is the half the recipe ADDED — the `pins` read
  // exists so a consumer takes kolu's answer for the subdir instead of
  // hardcoding it — and a guard that cannot fail for the case it names is worse
  // than none, which is the bar `consumer.nix` sets for itself two files over.
  //
  // So the pinned sources are forced too, through `drvPath`. That stays at EVAL
  // — a derivation path is computed, nothing is realised — so the paragraph
  // above about what this does not prove stays true.
  //
  // The parenthesis on `pkgs` is load-bearing and was wrong until the forcing
  // exposed it: `import <path>/nix/nixpkgs.nix { … }` parses as
  // `import(<path>)` applied to the absolute path `/nix/nixpkgs.nix`, which
  // survived only because nothing forced `pkgs` either.
  const expr = `
    let
      pkgs = ${nixpkgsPreamble(repoRoot)};
      recipe = ${bound};
    in builtins.deepSeq
      (builtins.map (p: p.drvPath) (builtins.attrValues recipe.packages))
      (builtins.length recipe.names)`;

  try {
    return nixEvalJson<number>(repoRoot, expr);
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

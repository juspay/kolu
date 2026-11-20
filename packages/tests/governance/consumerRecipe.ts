import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nixEvalJson, nixpkgsPreamble } from "./nixEval";

export const CONSUMER_RECIPE_DOC = "nix/README.md";

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

export function checkConsumerRecipeEvaluates(repoRoot: string): number {
  const recipe = extractConsumerRecipe(repoRoot);

  const rebinds: [string, string][] = [
    ["(import ../npins).kolu;", `${JSON.stringify(repoRoot)};`],
    ["(import ../npins).osfacts;", "(import ./npins).osfacts;"],
    ["(import ../npins).odu;", "(import ./npins).odu;"],
    ["(import ../npins).agent-distro;", "(import ./npins).agent-distro;"],
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
    const stderr = (err as { stderr?: string }).stderr ?? "";
    throw new Error(
      `${CONSUMER_RECIPE_DOC}'s consumer recipe does not evaluate. This is the ` +
        `snippet a consuming repo copies verbatim, so a reader hits this before ` +
        `anything else kolu documents:\n\n${stderr.trim()}`,
    );
  }
}

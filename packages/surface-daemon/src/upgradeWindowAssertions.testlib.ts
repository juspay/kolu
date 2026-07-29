/** Pure compatibility-shape and CI-recipe assertions for upgrade windows. */

import { throws } from "node:assert/strict";

export function pinPreviousShapeRecovery<T>(opts: {
  previous: unknown;
  irrecoverable: unknown;
  recover: (value: unknown) => unknown;
  parse: (value: unknown) => T;
  assertRecovered: (value: T) => void;
}): void {
  throws(
    () => opts.parse(opts.previous),
    "previous shape must require recovery",
  );
  opts.assertRecovered(opts.parse(opts.recover(opts.previous)));
  throws(
    () => opts.parse(opts.recover(opts.irrecoverable)),
    "irrecoverable shape must refuse",
  );
}

export function assertRecipeWired(
  justfile: string,
  recipe: string,
  tokens: readonly (string | RegExp)[],
): void {
  const lines = justfile.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^${recipe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`).test(line),
  );
  if (start < 0) throw new Error(`recipe ${recipe} is missing`);
  const tail = lines.slice(start).join("\n");
  const next = tail.search(/\n[a-zA-Z][a-zA-Z0-9_-]*:/);
  const body = next === -1 ? tail : tail.slice(0, next);
  const missing = tokens.filter((token) =>
    typeof token === "string" ? !body.includes(token) : !token.test(body),
  );
  if (missing.length > 0) {
    throw new Error(
      `recipe ${recipe} is missing required token(s): ${missing.join(", ")}`,
    );
  }
}

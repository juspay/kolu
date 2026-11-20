/**
 * THE CLAUDE CODE AGENT, as one package.
 *
 * ## The leg is a SUPERSET, because this package is shared
 *
 * [olai](https://github.com/juspay/olai) vendors this directory as raw
 * TypeScript and runs the same adapter, and its panel reads two things kolu's
 * conductor does not: {@link CLAUDE}'s `listedIn` (a stored conversation's
 * message count and what clearing produced it) and its `terminalOutput` flag (a
 * Bash result as a terminal block rather than a fenced string). kolu may add to
 * this package; kolu may not take away — the rule `@kolu/acp` states at length,
 * and for the same reason: a type-level contract whose consumer is in another
 * repository has no compiler watching it.
 */

export { configDirIn, REMOTE_SIGNALS } from "./env.ts";
export { CLAUDE, spelling } from "./leg.ts";
export { MODELS, modelNameIn } from "./models.ts";
export { NAME } from "./name.ts";

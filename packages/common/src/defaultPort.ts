/**
 * The port `kolu web` listens on when nobody says otherwise — ONE definition,
 * reachable without loading anything else.
 *
 * ## Why this is its own file and not just a line in `./config.ts`
 *
 * `./config.ts` is the door every app-side consumer already knows, and it will
 * keep being that: it re-exports this constant, so the value still has exactly
 * one home and `kolu-common/config` still answers for it. But config.ts is not
 * a LEAF — its last line re-exports `DEFAULT_SCROLLBACK` from
 * `@kolu/terminal-vocab/schema`, which builds seventeen modules of agent and
 * forge schemas at load time. A browser tab or the web server pays that
 * happily; both are already holding the domain.
 *
 * The COMMAND TREE is not. `kolu-cli/src/webFlags.ts` declares `--port`'s
 * default, and the command tree is built on EVERY `kolu` invocation — `kolu ls`,
 * `kolu --help`, a bare `kolu` — so reading the integer through config.ts made
 * every one of them build the whole terminal vocabulary to learn the number
 * 7681. That is the same cost `kolu-server/src/bootFlags.ts` was emptied to
 * avoid ("This file has ZERO imports, and that is the point"); the import it
 * dropped had simply reappeared one package over.
 *
 * So: the constant moves to where it can be read alone, and config.ts points at
 * it. Copying `7681` into the flag declaration instead would have bought the
 * same milliseconds with a second source of truth — the drift this repo treats
 * as a defect.
 *
 * This file has ZERO imports, and that is the point. Anything that needs a
 * type, a schema, or a sibling constant does not belong in it.
 */

/** Default port for the kolu web server (`kolu web --port`). */
export const DEFAULT_PORT = 7681;

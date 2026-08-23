/**
 * The web face's BOOT CONTRACT — the shape `bootKoluWeb` is written against,
 * and nothing else.
 *
 * ## Why there is no flag schema here
 *
 * This file has ZERO imports, and that is the point: the web server package
 * must not know how argv is parsed. Which parser the product's CLI uses is the
 * CLI's volatility — it went cleye → `effect/unstable/cli` without this
 * interface changing a character — and a flag DECLARATION is a function call,
 * so hosting one here would pull the parser into the web server's runtime
 * module graph for no benefit the server can name. The declarations live where
 * the command tree does, in `packages/kolu-cli/src/webFlags.ts`, beside the
 * root's shared endpoint flags.
 *
 * ## What keeps this from drifting from the flags
 *
 * `webFlags.ts`'s projection is annotated `bootFlagsOf(parsed): KoluBootFlags`.
 * A flag added to the schema and forgotten in the projection is still a COMPILE
 * error — the property the flags' old co-location here was protecting — and it
 * costs this package nothing, because kolu-cli imports this interface as a TYPE
 * and the import is erased.
 */

/** What `kolu web` boots with.
 *
 *  Deliberately `undefined` rather than `Option` for the two optional flags: the
 *  server's own reads are plain truthiness checks (`tls.ts`), and an `Option`
 *  here would push a parser-shaped type through every consumer of a function
 *  whose job has nothing to do with argv. `webFlags.ts`'s projection is the ONE
 *  place the two vocabularies meet. */
export interface KoluBootFlags {
  /** The address to bind — `kolu web --bind`. Named for what it does, not for
   *  the flag it used to be (`--host`, retired to keep that name meaning "which
   *  padi" everywhere). */
  readonly bind: string;
  readonly port: number;
  readonly tls: boolean;
  readonly tlsCert: string | undefined;
  readonly tlsKey: string | undefined;
  readonly verbose: boolean;
  readonly allowNixShellWithEnvWhitelist: string | undefined;
}

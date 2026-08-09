/**
 * The web face's boot contract — ONE artifact for the flag set `kolu web` boots
 * with: the Effect CLI flag schema (`webFlags`), the parsed flag type
 * (`KoluBootFlags`) DERIVED from it, and the single projection between them, all
 * on the same screen.
 *
 * A deliberate LEAF: it imports `kolu-common/config`, `effect`, and Effect's own
 * CLI flag constructors, and nothing else — so `packages/kolu-cli`'s command
 * tree can import the schema VALUE via the legacy deep path
 * `kolu-server/src/bootFlags.ts` without loading the server's runtime module
 * graph (`index.ts`). The same deep-leaf pattern as its
 * `kolu-server/src/hostname.ts` version import.
 *
 * `effect/unstable/cli` ships INSIDE the `effect` package this repo already pins
 * through the workspace catalog, so declaring flags here adds no dependency —
 * the flag constructors are the same module the binary's command tree is built
 * from, which is what keeps the schema and the contract one artifact rather than
 * two that agree by inspection.
 */

import { Option } from "effect";
import { type Command, Flag } from "effect/unstable/cli";
import { DEFAULT_PORT } from "kolu-common/config";

/** The web face's flags — bound to the `web` subcommand in
 *  `packages/kolu-cli/src/cli.ts`.
 *
 *  The bind address is `--bind`, not `--host`. `--host` is the root command's
 *  SHARED flag and means "which padi to reach" on every verb; Effect CLI refuses
 *  a parent/child flag collision outright (`DuplicateOption`: "Parent will
 *  always claim this flag"), so one name had to give. Renaming the web-only one
 *  is the trade that leaves `--host` a single idea across the whole binary
 *  instead of two that differ by subcommand. */
export const webFlags = {
  bind: Flag.string("bind").pipe(
    Flag.withDescription("Address to listen on"),
    Flag.withDefault("127.0.0.1"),
  ),
  port: Flag.integer("port").pipe(
    Flag.withDescription("Port to listen on"),
    Flag.withDefault(DEFAULT_PORT),
  ),
  tls: Flag.boolean("tls").pipe(
    Flag.withDescription(
      "Enable HTTPS with auto-generated self-signed certificate",
    ),
  ),
  tlsCert: Flag.string("tls-cert").pipe(
    Flag.withDescription("Path to TLS certificate file (PEM)"),
    Flag.optional,
  ),
  tlsKey: Flag.string("tls-key").pipe(
    Flag.withDescription("Path to TLS private key file (PEM)"),
    Flag.optional,
  ),
  verbose: Flag.boolean("verbose").pipe(
    Flag.withDescription("Enable debug-level logging"),
  ),
  allowNixShellWithEnvWhitelist: Flag.string(
    "allow-nix-shell-with-env-whitelist",
  ).pipe(
    Flag.withDescription(
      "Allow running inside a nix shell, forwarding only these comma-separated env vars to PTY shells (dev/test only). Uses built-in default list if set to 'default'.",
    ),
    Flag.optional,
  ),
} as const;

/** What the PARSER hands back for {@link webFlags} — Effect CLI's own inference
 *  over the schema, so key drift between the two is inexpressible. An
 *  `optional` flag lands here as `Option<T>`. */
export type ParsedWebFlags = Command.Command.Config.Infer<typeof webFlags>;

/** The BOOT contract — what `bootKoluWeb` is written against.
 *
 *  Deliberately `undefined` rather than `Option` for the two optional flags: the
 *  server's own reads are plain truthiness checks (`tls.ts`), and an `Option`
 *  here would push a parser-shaped type through every consumer of a function
 *  whose job has nothing to do with argv. The projection below is the ONE place
 *  the two vocabularies meet. */
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

/** Project the parsed flags onto the boot contract — the single, total mapping
 *  between the parser's `Option` vocabulary and the server's `undefined` one.
 *
 *  Its own named function rather than an object literal at the call site for the
 *  reason `koluCliConnectionOf` is one: a field added to the schema and
 *  forgotten here is a COMPILE error (the returned object must satisfy
 *  `KoluBootFlags`), where an inline literal in the command handler would be one
 *  more place to keep in sync by inspection. */
export function bootFlagsOf(parsed: ParsedWebFlags): KoluBootFlags {
  return {
    bind: parsed.bind,
    port: parsed.port,
    tls: parsed.tls,
    tlsCert: Option.getOrUndefined(parsed.tlsCert),
    tlsKey: Option.getOrUndefined(parsed.tlsKey),
    verbose: parsed.verbose,
    allowNixShellWithEnvWhitelist: Option.getOrUndefined(
      parsed.allowNixShellWithEnvWhitelist,
    ),
  };
}

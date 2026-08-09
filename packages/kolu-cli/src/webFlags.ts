/**
 * `kolu web`'s flags — the argv half of the web face, and the projection onto
 * the boot contract the server is written against (`KoluBootFlags`, in
 * `kolu-server/src/bootFlags.ts`).
 *
 * ## Why the DECLARATIONS live here and the CONTRACT lives there
 *
 * How argv is parsed is this package's volatility, not the web server's: this
 * PR alone moved it from cleye to `effect/unstable/cli`, and the server did not
 * care either time. A `Flag.string(...)` is a function CALL, so declaring these
 * inside `packages/server` would put `effect/unstable/cli` into the web
 * server's RUNTIME graph — the server package would then know how argv is
 * parsed, which is exactly the coupling the composition root exists to absorb.
 * (The cleye coupling it replaced was type-only and erased, so a runtime one
 * would be a regression in containment, not a continuation.) The flags are part
 * of the COMMAND TREE; they belong beside it, next to `endpoint.ts`'s shared
 * flags, and `bootKoluWeb` keeps only the plain-typed shape it actually reads.
 *
 * ## What keeps the two from drifting
 *
 * {@link bootFlagsOf}'s `: KoluBootFlags` return annotation. A flag added to
 * the schema below and forgotten in the projection is still a COMPILE error —
 * the property the old co-location was protecting — and it costs the server
 * package nothing to hold, because a type import is erased.
 */

import { Option } from "effect";
import { type Command, Flag } from "effect/unstable/cli";
import { DEFAULT_PORT } from "kolu-common/config";
// The BOOT contract — plain types, so this import is erased. A deep LEAF import
// (like `cli.ts`'s hostname one): it skips the server's runtime module graph
// (`index.ts`), so building the command tree stays server-free.
import type { KoluBootFlags } from "kolu-server/src/bootFlags.ts";

/** The web face's flags — bound to the `web` subcommand in `./cli.ts`.
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

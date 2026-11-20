import { Option } from "effect";
import { type Command, Flag } from "effect/cli";
import { DEFAULT_PORT } from "kolu-common/defaultPort";
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
  bind: Flag.String("bind").pipe(
    Flag.withDescription("Address to listen on"),
    Flag.withDefault("127.0.0.1"),
  ),
  port: Flag.Int("port").pipe(
    Flag.withDescription("Port to listen on"),
    Flag.withDefault(DEFAULT_PORT),
  ),
  // `withDefault(false)` is the switch's OFF position, not a fallback: since
  // rc.110 a bare `Flag.Boolean` FAILS when absent rather than parsing as
  // `false` (Effect-TS/effect#7296), so without it `kolu web` would refuse to
  // boot unless the operator wrote `--tls` and `--verbose` every time. Still
  // true at `effect@4.1.4`, re-read off `Flag.Boolean` at the pin.
  tls: Flag.Boolean("tls").pipe(
    Flag.withDescription(
      "Enable HTTPS with auto-generated self-signed certificate",
    ),
    Flag.withDefault(false),
  ),
  tlsCert: Flag.String("tls-cert").pipe(
    Flag.withDescription("Path to TLS certificate file (PEM)"),
    Flag.optional,
  ),
  tlsKey: Flag.String("tls-key").pipe(
    Flag.withDescription("Path to TLS private key file (PEM)"),
    Flag.optional,
  ),
  verbose: Flag.Boolean("verbose").pipe(
    Flag.withDescription("Enable debug-level logging"),
    Flag.withDefault(false),
  ),
  allowNixShellWithEnvWhitelist: Flag.String(
    "allow-nix-shell-with-env-whitelist",
  ).pipe(
    Flag.withDescription(
      "Allow running inside a nix shell, forwarding only these comma-separated env vars to PTY shells (dev/test only). Uses built-in default list if set to 'default'.",
    ),
    Flag.optional,
  ),
} as const;

export type ParsedWebFlags = Command.Command.Config.Infer<typeof webFlags>;

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

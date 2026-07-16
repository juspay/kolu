/**
 * The web face's boot contract — ONE artifact for the flag set bare `kolu` /
 * `kolu web` boots with: the cleye-shaped schema (`webFlags`) and the parsed
 * flag type (`KoluBootFlags`), DERIVED from it, on the same screen.
 *
 * A deliberate LEAF: it imports only `kolu-common/config` (the schema is a
 * plain object literal — cleye consumes it, but no cleye import is needed to
 * declare it), so `packages/kolu-cli`'s parse can import the schema VALUE via
 * the legacy deep path `kolu-server/src/bootFlags.ts` without loading the
 * server's runtime module graph (`index.ts`), exactly as its
 * `kolu-server/package.json` version import already does.
 */

import { DEFAULT_PORT } from "kolu-common/config";

/** The web face's flags — today's `kolu` flag set, verbatim. Declared once and
 *  bound to BOTH the root CLI (bare `kolu`) and the `web` subcommand
 *  (`packages/kolu-cli/src/cli.ts`), which is what makes the alias
 *  byte-for-byte rather than kept-in-sync. */
export const webFlags = {
  host: {
    type: String,
    description: "Address to listen on",
    default: "127.0.0.1",
  },
  port: {
    type: Number,
    description: "Port to listen on",
    default: DEFAULT_PORT,
  },
  tls: {
    type: Boolean,
    description: "Enable HTTPS with auto-generated self-signed certificate",
    default: false,
  },
  tlsCert: {
    type: String,
    description: "Path to TLS certificate file (PEM)",
  },
  tlsKey: {
    type: String,
    description: "Path to TLS private key file (PEM)",
  },
  verbose: {
    type: Boolean,
    description: "Enable debug-level logging",
    default: false,
  },
  allowNixShellWithEnvWhitelist: {
    type: String,
    description:
      "Allow running inside a nix shell, forwarding only these comma-separated env vars to PTY shells (dev/test only). Uses built-in default list if set to 'default'.",
  },
} as const;

/** Flag constructor → parsed primitive (the value cleye hands back). */
type FlagPrimitive<T> = T extends StringConstructor
  ? string
  : T extends NumberConstructor
    ? number
    : T extends BooleanConstructor
      ? boolean
      : never;

/** The boot contract, derived key-by-key from the ONE schema above: a flag
 *  with a `default` always carries a value; one without may be `undefined`.
 *  Key drift between schema and contract is INEXPRESSIBLE by construction
 *  (this replaced the hand-written type + two `AssertTrue` key-equality
 *  guards in cli.ts); a value-mapping divergence from cleye's own inference
 *  is still caught by `parseKoluCli`'s `flags: parsed.flags` return
 *  assignment. */
export type KoluBootFlags = {
  -readonly [K in keyof typeof webFlags]: (typeof webFlags)[K] extends {
    type: infer T;
  }
    ? (typeof webFlags)[K] extends { default: unknown }
      ? FlagPrimitive<T>
      : FlagPrimitive<T> | undefined
    : never;
};

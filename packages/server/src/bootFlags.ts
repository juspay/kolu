/**
 * The web face's boot contract — ONE artifact for the flag set bare `kolu` /
 * `kolu web` boots with: the cleye-shaped schema (`webFlags`) and the parsed
 * flag type (`KoluBootFlags`), DERIVED from it, on the same screen.
 *
 * A deliberate LEAF: it imports only `kolu-common/config` (the schema is a
 * plain object literal — cleye consumes it, but no cleye import is needed to
 * declare it; the `TypeFlag` import below is type-only, erased), so
 * `packages/kolu-cli`'s parse can import the schema VALUE via the legacy deep
 * path `kolu-server/src/bootFlags.ts` without loading the server's runtime
 * module graph (`index.ts`) — the same deep-leaf pattern as its
 * `kolu-server/src/hostname.ts` version import.
 */

// Type-only: erased at compile time, so the leaf stays runtime-free. cleye
// re-exports type-flag's TypeFlag — the library's OWN inference over this
// schema, so the contract below is definitionally what cli() returns.
import type { TypeFlag } from "cleye";
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

/** The boot contract, derived from the ONE schema above by cleye's own
 *  exported inference (`TypeFlag`, re-exported from type-flag) — so both key
 *  AND value drift between schema and contract are inexpressible: this type
 *  is by definition the flag shape `cli()` hands back for `webFlags`. */
export type KoluBootFlags = TypeFlag<typeof webFlags>["flags"];

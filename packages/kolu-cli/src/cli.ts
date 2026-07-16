/**
 * The kolu binary's subcommand dispatch — PR1 of the kolu-cli plan
 * (docs/atlas/src/content/atlas/kolu-cli.mdx). This package is the composition
 * root: the one module set allowed to import everything, so the product's argv
 * face stays out of the web server's boot (`packages/server` exports
 * `bootKoluWeb`; the volatility is in the set of faces, and only a dedicated
 * package encapsulates it).
 *
 * `kolu web` NAMES today's behavior; bare `kolu` stays its byte-for-byte alias:
 * ONE flag schema (`webFlags`) is bound to both spellings, so the alias holds by
 * construction, and the flag-matrix test (`cli.test.ts`) pins it. `kolu tui` and
 * `kolu mcp` are reserved — they fail fast with a pointer at the plan (PR3 and
 * PR2 respectively) instead of pretending to exist.
 *
 * This module is the PARSE only — deliberately free of runtime `kolu-server`
 * imports (the type below is erased), so the pin suite drives it without
 * loading the server's module graph. The `web` arm's boot import lives in
 * `main.ts`, behind the dispatch. (The tui/mcp faces themselves arrive as
 * separate packages in PR2/PR3 — their manifests, which list no kolu app
 * package, are the structural fence.)
 */

import { cli, command } from "cleye";
import { DEFAULT_PORT } from "kolu-common/config";
import type { KoluBootFlags } from "kolu-server";
// The app version's single source of truth is packages/server/package.json
// (`/release` bumps it; nix reads the same file for the derivation version).
// Read it straight from that file — same value `serverVersion` carries inside
// the server — without pulling the server's runtime graph into the parse.
import serverPkg from "kolu-server/package.json" with { type: "json" };

/** The web face's flags — today's `kolu` flag set, verbatim. Declared once and
 *  bound to BOTH the root CLI (bare `kolu`) and the `web` subcommand, which is
 *  what makes the alias byte-for-byte rather than kept-in-sync. */
const webFlags = {
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

const RESERVED_FACES = ["tui", "mcp"] as const;
type ReservedFace = (typeof RESERVED_FACES)[number];

/** The named fail-fast for a face that is planned but not shipped (exit
 *  non-zero rides `koluWebFlagsOrExit`). One template so `tui` and `mcp`
 *  can't drift apart. */
export const reservedFaceMessage = (face: ReservedFace): string =>
  `kolu ${face} is not shipped yet — it lands in a later PR of the kolu-cli plan: https://kolu.dev/atlas/kolu-cli.html`;

export type KoluCliParse =
  | { face: "web"; flags: KoluBootFlags }
  | { face: ReservedFace };

/** Parse the kolu argv into a face. Pure — no exits beyond cleye's own
 *  `--help`/`--version`/unknown-flag handling — so the flag-matrix test can
 *  drive it directly. NOTE: cleye MUTATES the argv array it's handed, so we
 *  copy before parsing. */
export function parseKoluCli(
  argv: string[] = process.argv.slice(2),
): KoluCliParse {
  const parsed = cli(
    {
      name: "kolu",
      version: serverPkg.version,
      flags: webFlags,
      strictFlags: true,
      commands: [
        command({
          name: "web",
          help: {
            description:
              "Run the kolu web server (the default — bare `kolu` is this command's alias).",
          },
          flags: webFlags,
        }),
        command({
          name: "tui",
          help: {
            description:
              "Reserved — the terminal canvas is not shipped yet (see kolu.dev/atlas/kolu-cli.html).",
          },
        }),
        command({
          name: "mcp",
          help: {
            description:
              "Reserved — the MCP agent face is not shipped yet (see kolu.dev/atlas/kolu-cli.html).",
          },
        }),
      ],
    },
    undefined,
    [...argv],
  );
  if (parsed.command === "tui" || parsed.command === "mcp") {
    return { face: parsed.command };
  }
  // Bare (`command: undefined`) and `web` carry the same schema — the alias.
  return { face: "web", flags: parsed.flags };
}

/** The dispatch seam `main.ts` parses through: returns the web face's flags, or
 *  fails fast (the named message on stderr, exit 1) on a reserved subcommand. */
export function koluWebFlagsOrExit(argv?: string[]): KoluBootFlags {
  const parsed = parseKoluCli(argv);
  if (parsed.face !== "web") {
    process.stderr.write(`${reservedFaceMessage(parsed.face)}\n`);
    process.exit(1);
  }
  return parsed.flags;
}

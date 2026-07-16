/**
 * The kolu binary's subcommand dispatch — PR1 of the kolu-cli plan
 * (docs/atlas/src/content/atlas/kolu-cli.mdx).
 *
 * `kolu web` NAMES today's behavior; bare `kolu` stays its byte-for-byte alias:
 * ONE flag schema (`webFlags`) is bound to both spellings, so the alias holds by
 * construction, and the flag-matrix test (`cli.test.ts`) pins it. `kolu tui` and
 * `kolu mcp` are reserved — they fail fast with a pointer at the plan (PR3 and
 * PR2 respectively) instead of pretending to exist.
 */

import { cli, command } from "cleye";
import { DEFAULT_PORT } from "kolu-common/config";
import { serverVersion } from "./hostname.ts";

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
  | { face: "web"; flags: KoluWebFlags }
  | { face: ReservedFace };

/** Today's flag set, parsed — the shape `index.ts` boots with. */
export type KoluWebFlags = {
  host: string;
  port: number;
  tls: boolean;
  tlsCert: string | undefined;
  tlsKey: string | undefined;
  verbose: boolean;
  allowNixShellWithEnvWhitelist: string | undefined;
};

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
      version: serverVersion,
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

/** The boot seam `index.ts` parses through: returns the web face's flags, or
 *  fails fast (the named message on stderr, exit 1) on a reserved subcommand. */
export function koluWebFlagsOrExit(argv?: string[]): KoluWebFlags {
  const parsed = parseKoluCli(argv);
  if (parsed.face !== "web") {
    process.stderr.write(`${reservedFaceMessage(parsed.face)}\n`);
    process.exit(1);
  }
  return parsed.flags;
}

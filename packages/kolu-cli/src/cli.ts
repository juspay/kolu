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
 * This module is the PARSE only — its `kolu-server` imports are LEAVES
 * (`src/bootFlags.ts`, `src/hostname.ts`) that never touch the server's
 * runtime module graph (`index.ts`), so the pin suite drives it without
 * loading that graph. The `web` arm's boot import lives in
 * `main.ts`, behind the dispatch. (The tui/mcp faces themselves arrive as
 * separate packages in PR2/PR3 — their manifests, which list no kolu app
 * package, are the structural fence.)
 */

import { cli, command } from "cleye";
// The web face's ONE flag artifact — the cleye schema and the `KoluBootFlags`
// contract DERIVED from it, co-located in `kolu-server/src/bootFlags.ts`. A
// deep LEAF import (like the hostname one below): it skips the server's
// runtime module graph (`index.ts`), so the parse stays server-free.
import { type KoluBootFlags, webFlags } from "kolu-server/src/bootFlags.ts";
// The ONE version accessor (`hostname.ts` is a leaf: node built-ins + the
// server's package.json, which `/release` bumps and nix reads too) — so
// `kolu --version` can never diverge from the version the server reports.
import { serverVersion } from "kolu-server/src/hostname.ts";

const RESERVED_FACES = ["tui", "mcp"] as const;
type ReservedFace = (typeof RESERVED_FACES)[number];

/** The named fail-fast for a face that is planned but not shipped (exit
 *  non-zero rides `koluWebFlagsOrExit`). One template so `tui` and `mcp`
 *  can't drift apart. */
export const reservedFaceMessage = (face: ReservedFace): string =>
  `kolu ${face} is not shipped yet — it lands in a later PR of the kolu-cli plan: https://kolu.dev/atlas/kolu-cli.html`;

export type KoluCliParse =
  | { face: "web"; flags: KoluBootFlags }
  | { face: ReservedFace }
  // A positional neither spelling takes — `kolu tuii`, `kolu web foo`. Named so
  // a typo'd subcommand FAILS FAST instead of silently booting the web server
  // (cleye has no strict-commands mode: an unknown first positional falls
  // through to the root command with the word left in `_`).
  | { face: "unknown-command"; args: string[] };

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
          // The alias must hold for cleye's IMPLICIT flags too: --version only
          // exists where a `version` option is passed, so without this line
          // `kolu web --version` would reject the flag bare `kolu` accepts.
          version: serverVersion,
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
  // Neither bare `kolu` nor `kolu web` takes positionals, so a leftover one is
  // a typo'd subcommand (`kolu tuii`) — fail fast rather than boot a server the
  // user didn't ask for.
  if (parsed._.length > 0) {
    return { face: "unknown-command", args: [...parsed._] };
  }
  // Bare (`command: undefined`) and `web` carry the same schema — the alias.
  return { face: "web", flags: parsed.flags };
}

/** The dispatch seam `main.ts` parses through: returns the web face's flags, or
 *  fails fast (a named message on stderr, exit 1) on a reserved subcommand or a
 *  positional that matches no command. */
export function koluWebFlagsOrExit(argv?: string[]): KoluBootFlags {
  const parsed = parseKoluCli(argv);
  if (parsed.face === "unknown-command") {
    process.stderr.write(
      `kolu: unknown command "${parsed.args[0]}" — commands: web (the default), tui, mcp. See kolu --help.\n`,
    );
    process.exit(1);
  }
  if (parsed.face !== "web") {
    process.stderr.write(`${reservedFaceMessage(parsed.face)}\n`);
    process.exit(1);
  }
  return parsed.flags;
}

/**
 * The kolu binary's subcommand dispatch — the kolu-cli plan
 * (docs/atlas/src/content/atlas/kolu-cli.mdx). This package is the composition
 * root: the one module set allowed to import everything, so the product's argv
 * face stays out of the web server's boot (`packages/server` exports
 * `bootKoluWeb`; the volatility is in the set of faces, and only a dedicated
 * package encapsulates it).
 *
 * `kolu web` NAMES today's behavior; bare `kolu` stays its byte-for-byte alias:
 * ONE flag schema (`webFlags`) is bound to both spellings, so the alias holds by
 * construction, and the flag-matrix test (`cli.test.ts`) pins it. `kolu mcp`
 * serves the agent face (PR2 — `[--host <ssh>]` reaches a remote padi); `kolu
 * tui` stays reserved — it fails fast with a pointer at the plan (PR3) instead
 * of pretending to exist.
 *
 * This module is the PARSE only — its `kolu-server` imports are LEAVES
 * (`src/bootFlags.ts`, `src/hostname.ts`) that never touch the server's
 * runtime module graph (`index.ts`), so the pin suite drives it without
 * loading that graph. Each face's boot import lives in `main.ts`, behind the
 * dispatch, as a dynamic import. (The mcp face itself is `packages/kolu-mcp` —
 * its manifest, which lists no kolu app package, is the structural fence.)
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
import { match, P } from "ts-pattern";

const RESERVED_FACES = ["tui"] as const;
type ReservedFace = (typeof RESERVED_FACES)[number];

/** The named fail-fast for a face that is planned but not shipped (exit
 *  non-zero rides `koluFaceOrExit`). */
export const reservedFaceMessage = (face: ReservedFace): string =>
  `kolu ${face} is not shipped yet — it lands in a later PR of the kolu-cli plan: https://kolu.dev/atlas/kolu-cli.html`;

export type KoluCliParse =
  | { face: "web"; flags: KoluBootFlags }
  | { face: "mcp"; host: string | undefined }
  | { face: ReservedFace }
  // A positional no spelling takes — `kolu tuii`, `kolu web foo`. Named so
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
          version: serverVersion,
          help: {
            description:
              "Serve this host's terminals to a coding agent over MCP (stdio) — a pure padi client, no web server.",
          },
          flags: {
            host: {
              type: String,
              description:
                "reach a padi on another machine over ssh (user@host) instead of the local socket — goes AFTER the subcommand: `kolu mcp --host user@zest`.",
            },
          },
        }),
      ],
    },
    undefined,
    [...argv],
  );
  if (parsed.command === "tui") {
    return { face: "tui" };
  }
  if (parsed.command === "mcp") {
    // cleye types each command's flags per-command; narrow through the
    // discriminant we just matched.
    const { host } = parsed.flags as { host: string | undefined };
    return { face: "mcp", host };
  }
  // Drift guard (type-level): the literals above must cover every registered
  // non-web command. If a new face is added to the `commands` array without a
  // matching arm in the cascade, the leftover command type here stops
  // satisfying `"web" | undefined` and this line is a COMPILE error — a
  // missed edit cannot silently fall through to booting the web server.
  parsed.command satisfies "web" | undefined;
  // Neither bare `kolu` nor `kolu web` takes positionals, so a leftover one is
  // a typo'd subcommand (`kolu tuii`) — fail fast rather than boot a server the
  // user didn't ask for.
  if (parsed._.length > 0) {
    return { face: "unknown-command", args: [...parsed._] };
  }
  // Bare (`command: undefined`) and `web` carry the same schema — the alias.
  return { face: "web", flags: parsed.flags };
}

/** The faces `main.ts` actually boots — the parse minus the fail-fast arms. */
export type KoluCliFace =
  | { face: "web"; flags: KoluBootFlags }
  | { face: "mcp"; host: string | undefined };

/** The dispatch seam `main.ts` parses through: returns the face to boot, or
 *  fails fast (a named message on stderr, exit 1) on a reserved subcommand or a
 *  positional that matches no command. `exhaustive()` is load-bearing: a new
 *  face added to `KoluCliParse` without an arm here is a compile error, where
 *  a `!== "web"` catch-all would silently mislabel it. */
export function koluFaceOrExit(argv?: string[]): KoluCliFace {
  return match(parseKoluCli(argv))
    .with({ face: "web" }, (p): KoluCliFace => p)
    .with({ face: "mcp" }, (p): KoluCliFace => p)
    .with({ face: P.union(...RESERVED_FACES) }, (p): never => {
      process.stderr.write(`${reservedFaceMessage(p.face)}\n`);
      process.exit(1);
    })
    .with({ face: "unknown-command" }, (p): never => {
      process.stderr.write(
        `kolu: unknown command "${p.args[0]}" — commands: web (the default), tui, mcp. See kolu --help.\n`,
      );
      process.exit(1);
    })
    .exhaustive();
}

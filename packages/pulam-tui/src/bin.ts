/**
 * pulam-tui — a terminal-side viewer for a running `pulam` daemon. It dials
 * pulam's unix socket and reads the `awareness` collection: what each terminal
 * *is in* (repo·branch · PR + checks · agent state · foreground), where
 * kaval-tui shows what's *running* in each PTY.
 *
 *   pulam-tui            an OpenTUI dashboard of ONE endpoint — one row per
 *                        terminal, with a live clock; the rows are a
 *                        point-in-time snapshot. Ctrl-C to quit.
 *   pulam-tui --json     a one-shot machine-readable dump (a top-level array)
 *   pulam-tui fleet      a LIVE multi-host board — every terminal across N hosts
 *                        in one screen, awaiting-you agents floated to the top,
 *                        rows updating live as agents change (see `fleet.tsx`).
 *                        `fleet --json` dumps `[{ host, terminalId, ... }]`.
 *
 * By default it reaches an pulam on THIS machine. Two ways to point it
 * elsewhere, mutually exclusive:
 *   --socket PATH   a different LOCAL socket.
 *   --host <ssh>    a REMOTE pulam over ssh: provision the daemon's closure with
 *                   Nix, run `pulam --stdio`, and dial it — the same awareness
 *                   surface over a different transport (see `hostConnect.ts`).
 *                   The remote pulam DISCOVERS the running kaval — a standalone
 *                   one or a home-manager kolu-server (namespaced by listen
 *                   port) — so `--host` lands on your remote kolu's terminals
 *                   with no extra flag. Add `--kaval <path>` only to pick one
 *                   when several kavals run on the host. Nothing survives the
 *                   link (pulam is ephemeral by design).
 *
 * The dashboard is rendered with OpenTUI under Bun; the `pulam` daemon and the
 * rest of kolu stay on Node. The OpenTUI renderer is imported dynamically and
 * ONLY when stdout is a TTY, so `--json` / a piped run stays a plain one-shot
 * and never loads the native renderer.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TERMINAL_WORKSPACE_CONTRACT_VERSION } from "@kolu/terminal-workspace/surface";
import { pulamSocketPath } from "@kolu/terminal-workspace/socket";
import { cli, command } from "cleye";
import { type Connection, connectArivu } from "./connect.ts";
import { type FleetConnector, snapshotFleet } from "./fleet.ts";
import { connectArivuViaHost } from "./hostConnect.ts";
import { parseSshConfigHosts, resolveFleetHosts } from "./hosts.ts";
import { snapshotAwareness } from "./read.ts";
import {
  type FleetMode,
  formatAwarenessJson,
  formatFleetJson,
} from "./render.ts";

const argv = cli({
  name: "pulam-tui",
  version: TERMINAL_WORKSPACE_CONTRACT_VERSION,
  help: {
    description:
      "A dashboard of what every terminal is in (repo·branch · PR · agent · foreground), read from a running `pulam` (start it with `pulam`, which needs a running kaval). `--json` dumps it for scripts; `--host <ssh>` reads a remote machine over ssh.",
  },
  // No subcommands — bare `pulam-tui` IS the dashboard, so flags are top-level
  // (no "flags go after the subcommand" footgun).
  flags: {
    socket: {
      type: String,
      description:
        "the pulam socket to dial. Default: $XDG_RUNTIME_DIR/pulam/awareness.sock (or /tmp/pulam-$UID/awareness.sock off systemd).",
    },
    host: {
      type: String,
      description:
        "reach an pulam on a remote machine over ssh, provisioning it via Nix — e.g. --host nix@prod. The remote pulam dials the remote kaval and recomputes awareness from now. Mutually exclusive with --socket.",
    },
    kaval: {
      type: String,
      description:
        "with --host: the kaval pty-host socket the remote pulam should dial (e.g. $XDG_RUNTIME_DIR/kaval-<port>/pty-host.sock). Default: the remote pulam discovers the running kaval (standalone, or a kolu-server).",
    },
    json: {
      type: Boolean,
      description:
        "one-shot machine-readable JSON (a top-level array) instead of the dashboard",
      default: false,
    },
  },
  // `pulam-tui fleet` is the LIVE multi-host board (PR2b). The bare `pulam-tui`
  // above stays the single-endpoint snapshot dashboard; `fleet` fans the dial
  // over N hosts and mirrors each one's awareness collection for live rows.
  commands: [
    command({
      name: "fleet",
      help: {
        description:
          "A LIVE multi-host board: every terminal across N hosts in one screen, with every agent awaiting you floated to the top. Repeat --host to add machines; the local pulam is included unless --no-local. Flags go AFTER `fleet`.",
      },
      flags: {
        host: {
          type: [String],
          description:
            "a remote pulam over ssh, provisioned via Nix — repeatable: --host nix@a --host nix@b. The local pulam is also included unless --no-local.",
        },
        kaval: {
          type: [String],
          description:
            "pin which kaval a host's remote pulam dials, for a host running several — repeatable, `<host>=<socket>` (the <host> matches a --host value): --kaval nix@zest=/tmp/kaval-7692-501/pty-host.sock. Omit and each host discovers the one that's up.",
        },
        sshConfig: {
          type: Boolean,
          description:
            "also add hosts from ~/.ssh/config (its `Host` aliases; wildcard stanzas dropped). ssh resolves each alias when dialing.",
          default: false,
        },
        noLocal: {
          type: Boolean,
          description: "exclude the local pulam from the fleet.",
          default: false,
        },
        by: {
          type: String,
          description:
            "group/sort: host (per-host groups, default) · needs (one fleet-wide urgency list) · agent (grouped by agent state across hosts).",
          default: "host",
        },
        json: {
          type: Boolean,
          description:
            "one-shot JSON [{ host, terminalId, ...awareness }] instead of the live board",
          default: false,
        },
      },
    }),
  ],
});

function fail(message: string): never {
  process.stderr.write(`pulam-tui: ${message}\n`);
  process.exit(1);
}

/** Dial a LOCAL pulam over its unix socket — an explicit `--socket`, else the
 *  default path. Fails loud with an actionable hint if nothing is listening. */
function connectLocal(socketOverride: string | undefined): Promise<Connection> {
  const socketPath = pulamSocketPath(socketOverride);
  return connectArivu(socketPath).catch((err) => {
    const code = (err as NodeJS.ErrnoException).code;
    return fail(
      `no pulam at ${socketPath}${code ? ` (${code})` : ""} — is it running? Start it with \`pulam\` (it needs a running kaval).`,
    );
  });
}

/** Reach a REMOTE pulam over ssh (`--host`): provision the daemon with Nix and
 *  dial it. Fails loud with the underlying ssh/nix error so a misconfigured host
 *  (no passwordless ssh, the user not in the remote's `trusted-users`) reads as
 *  actionable rather than an opaque hang — the CLI is one-shot, so it surfaces
 *  the first failure instead of spinning on HostSession's reconnect loop. */
function connectHost(
  host: string,
  kavalSocket: string | undefined,
): Promise<Connection> {
  return connectArivuViaHost(host, kavalSocket).catch((err) =>
    fail(`could not reach pulam on ${host} — ${(err as Error).message}`),
  );
}

/** Validate `--by` into the closed `FleetMode` union, failing loud on a typo. */
function parseFleetMode(by: string): FleetMode {
  if (by === "host" || by === "needs" || by === "agent") return by;
  return fail(
    `--by must be one of host|needs|agent (got ${JSON.stringify(by)}).`,
  );
}

/** `pulam-tui fleet` — resolve the host list, then either dump one-shot JSON or
 *  run the live board. The connector here REJECTS on a failed dial (it is NOT
 *  the bare path's `fail()`-wrapping connector) so the orchestrator can render a
 *  dead host as `unreachable` instead of exiting — one bad box never sinks the
 *  board. */
/** Parse `--kaval <ssh>=<socket>` entries into a `{ ssh → socket }` map, failing
 *  loud on a malformed entry (no `=`, or an empty side). Split on the FIRST `=`
 *  so a socket path can't be mistaken for the separator. */
function parseKavalMap(entries: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of entries) {
    const eq = entry.indexOf("=");
    const ssh = eq < 0 ? "" : entry.slice(0, eq);
    const socket = eq < 0 ? "" : entry.slice(eq + 1);
    if (ssh === "" || socket === "") {
      fail(
        `--kaval must be <host>=<socket> (got ${JSON.stringify(entry)}) — e.g. --kaval nix@zest=/tmp/kaval-7692-501/pty-host.sock`,
      );
    }
    map[ssh] = socket;
  }
  return map;
}

async function runFleet(opts: {
  hosts: string[];
  kaval: string[];
  sshConfig: boolean;
  noLocal: boolean;
  by: string;
  json: boolean;
}): Promise<void> {
  // The board owns the terminal; a pipe has no TTY to own — so a piped run must
  // ask for --json explicitly rather than silently degrade.
  if (!opts.json && !process.stdout.isTTY) {
    fail(
      "stdout is not a TTY — pass --json for scriptable output (the fleet board needs an interactive terminal).",
    );
  }
  const mode = parseFleetMode(opts.by);

  let fromSshConfig: string[] = [];
  if (opts.sshConfig) {
    const path = join(homedir(), ".ssh", "config");
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return fail(
        `--ssh-config: could not read ${path}${code ? ` (${code})` : ""}.`,
      );
    }
    fromSshConfig = parseSshConfigHosts(content);
  }

  const { hosts, unmatchedKaval } = resolveFleetHosts({
    explicit: opts.hosts,
    fromSshConfig,
    includeLocal: !opts.noLocal,
    kavalByHost: parseKavalMap(opts.kaval),
  });
  if (hosts.length === 0) {
    fail(
      "no hosts to dial — pass --host <ssh>, add --ssh-config, or drop --no-local.",
    );
  }
  if (unmatchedKaval.length > 0) {
    fail(
      `--kaval names a host that isn't in the fleet: ${unmatchedKaval.join(", ")} — its <host> must match a --host value (the local socket can't be pinned this way).`,
    );
  }

  // The board owns the alt-screen, so the dial's diagnostic lines must NOT reach
  // the tty — pass a discarding sink (a host's failure reason still surfaces via
  // the rejected dial → its `unreachable` header; the board never needs the raw
  // lifecycle chatter). Paired with the daemon quieting its `--stdio` logs.
  const swallow = (): void => {};
  const connect: FleetConnector = (host) =>
    host.ssh === null
      ? connectArivu(pulamSocketPath(undefined))
      : connectArivuViaHost(host.ssh, host.kaval, swallow);

  if (opts.json) {
    // Scriptable one-shot — never touches the renderer.
    const snaps = await snapshotFleet(hosts, connect);
    process.stdout.write(`${formatFleetJson(snaps)}\n`);
    process.exit(0);
  }

  // Interactive: the live OpenTUI fleet board until Ctrl-C. Imported dynamically
  // + behind the TTY gate so a piped/JSON run never loads the Bun-only renderer.
  const { runFleetTui } = await import("./fleet.tsx");
  await runFleetTui({ hosts, connect, mode });
  process.exit(0);
}

async function main(): Promise<void> {
  // `pulam-tui fleet` is its own world (the live multi-host board); everything
  // below is the bare single-endpoint dashboard. Route fleet first. cleye merges
  // the command's flags onto argv.flags; `host` is repeatable here ([String]),
  // so normalize the string | string[] union into a plain array.
  if (argv.command === "fleet") {
    await runFleet({
      hosts: ([] as string[]).concat(argv.flags.host ?? []),
      kaval: ([] as string[]).concat(argv.flags.kaval ?? []),
      sshConfig: argv.flags.sshConfig ?? false,
      noLocal: argv.flags.noLocal ?? false,
      by: argv.flags.by ?? "host",
      json: argv.flags.json,
    });
    return;
  }

  // --host reaches a remote pulam over ssh; --socket a local one. They name two
  // different daemons, so passing both is a usage error, not a precedence puzzle.
  if (argv.flags.host !== undefined && argv.flags.socket !== undefined) {
    fail(
      "--host and --socket are mutually exclusive: --host reaches a remote pulam over ssh, --socket dials a local one. Pass just one.",
    );
  }
  // --kaval only travels over the --host dial (it picks which kaval the remote
  // pulam reads); without --host there is no remote pulam to point at.
  if (argv.flags.kaval !== undefined && argv.flags.host === undefined) {
    fail(
      "--kaval only applies with --host (it picks which kaval the remote pulam dials). For a local pulam, point pulam itself at the kaval when you start it.",
    );
  }
  // The OpenTUI renderer owns the terminal; a pipe has no TTY to own. So a piped
  // run must ask for the scriptable form explicitly rather than silently degrade
  // — fail loud before we even dial.
  if (!argv.flags.json && !process.stdout.isTTY) {
    fail(
      "stdout is not a TTY — pass --json for scriptable output (the dashboard needs an interactive terminal).",
    );
  }

  const conn =
    argv.flags.host !== undefined
      ? await connectHost(argv.flags.host, argv.flags.kaval)
      : await connectLocal(argv.flags.socket);

  // Read the awareness collection ONCE, then release the link: PR2a renders a
  // point-in-time snapshot, so the dashboard needs no live connection (and a
  // remote daemon's forwarded stderr can't reach the alt-screen once the link is
  // gone). PR2b will instead hold the link and mirror it for live rows.
  let entries: Awaited<ReturnType<typeof snapshotAwareness>>;
  try {
    entries = await snapshotAwareness(conn.client);
  } finally {
    conn.dispose();
  }

  if (argv.flags.json) {
    // Scriptable one-shot — never touches the renderer.
    process.stdout.write(`${formatAwarenessJson(entries)}\n`);
    process.exit(0);
  }

  // Interactive terminal: the OpenTUI dashboard until Ctrl-C. Imported
  // dynamically + behind the TTY gate so a piped/JSON run never loads the
  // Bun-only native renderer.
  const { runDashboardTui } = await import("./tui.tsx");
  await runDashboardTui({ entries });
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`pulam-tui: ${(err as Error).message}\n`);
  process.exit(1);
});

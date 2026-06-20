/**
 * arivu-tui — a terminal-side viewer for a running `arivu` daemon. It dials
 * arivu's unix socket and reads the `awareness` collection: what each terminal
 * *is in* (repo branch · PR + checks · agent state · foreground), where
 * kaval-tui shows what's *running* in each PTY.
 *
 *   arivu-tui            a LIVE dashboard — one row per terminal, updating in
 *                        place until you quit (Ctrl-C or `q`)
 *   arivu-tui --json     a one-shot machine-readable dump (a top-level array)
 *
 * By default it reaches an arivu on THIS machine. Two ways to point it
 * elsewhere, mutually exclusive:
 *   --socket PATH   a different LOCAL socket.
 *   --host <ssh>    a REMOTE arivu over ssh: provision the daemon's closure with
 *                   Nix, run `arivu --stdio`, and dial it — the same awareness
 *                   surface over a different transport (see `hostConnect.ts`).
 *                   The remote arivu DISCOVERS the running kaval — a standalone
 *                   one or a home-manager kolu-server (namespaced by listen
 *                   port) — so `--host` lands on your remote kolu's terminals
 *                   with no extra flag. Add `--kaval <path>` only to pick one
 *                   when several kavals run on the host. Nothing survives the
 *                   link (arivu is ephemeral by design).
 *
 * The live dashboard is rendered with OpenTUI under Bun (P3a); the `arivu`
 * daemon and the rest of kolu stay on Node. The OpenTUI renderer is imported
 * dynamically and ONLY when stdout is a TTY, so `--json` / a piped run stays a
 * plain one-shot and never loads the native renderer.
 */

import { homedir } from "node:os";
import { ARIVU_CONTRACT_VERSION } from "@kolu/arivu-contract";
import { arivuSocketPath } from "@kolu/arivu-contract/socket";
import { cli } from "cleye";
import { type Connection, connectArivu } from "./connect.ts";
import { connectArivuViaHost } from "./hostConnect.ts";
import { snapshotAwareness } from "./read.ts";
import { formatAwarenessJson, formatAwarenessList } from "./render.ts";

const argv = cli({
  name: "arivu-tui",
  version: ARIVU_CONTRACT_VERSION,
  help: {
    description:
      "A live dashboard of what every terminal is in (branch · PR · agent · foreground), read from a running `arivu` (start it with `arivu`, which needs a running kaval). `--json` dumps it for scripts; `--host <ssh>` reads a remote machine over ssh.",
  },
  // No subcommands — bare `arivu-tui` IS the dashboard, so flags are top-level
  // (no "flags go after the subcommand" footgun).
  flags: {
    socket: {
      type: String,
      description:
        "the arivu socket to dial. Default: $XDG_RUNTIME_DIR/arivu/awareness.sock (or /tmp/arivu-$UID/awareness.sock off systemd).",
    },
    host: {
      type: String,
      description:
        "reach an arivu on a remote machine over ssh, provisioning it via Nix — e.g. --host nix@prod. The remote arivu dials the remote kaval and recomputes awareness from now. Mutually exclusive with --socket.",
    },
    kaval: {
      type: String,
      description:
        "with --host: the kaval pty-host socket the remote arivu should dial (e.g. $XDG_RUNTIME_DIR/kaval-<port>/pty-host.sock). Default: the remote arivu discovers the running kaval (standalone, or a kolu-server).",
    },
    json: {
      type: Boolean,
      description:
        "one-shot machine-readable JSON (a top-level array) instead of the live dashboard",
      default: false,
    },
  },
});

function fail(message: string): never {
  process.stderr.write(`arivu-tui: ${message}\n`);
  process.exit(1);
}

/** Dial a LOCAL arivu over its unix socket — an explicit `--socket`, else the
 *  default path. Fails loud with an actionable hint if nothing is listening. */
function connectLocal(socketOverride: string | undefined): Promise<Connection> {
  const socketPath = arivuSocketPath(socketOverride);
  return connectArivu(socketPath).catch((err) => {
    const code = (err as NodeJS.ErrnoException).code;
    return fail(
      `no arivu at ${socketPath}${code ? ` (${code})` : ""} — is it running? Start it with \`arivu\` (it needs a running kaval).`,
    );
  });
}

/** Reach a REMOTE arivu over ssh (`--host`): provision the daemon with Nix and
 *  dial it. Fails loud with the underlying ssh/nix error so a misconfigured host
 *  (no passwordless ssh, the user not in the remote's `trusted-users`) reads as
 *  actionable rather than an opaque hang — the CLI surfaces the first failure
 *  instead of spinning on HostSession's reconnect loop. */
function connectHost(
  host: string,
  kavalSocket: string | undefined,
): Promise<Connection> {
  return connectArivuViaHost(host, kavalSocket).catch((err) =>
    fail(`could not reach arivu on ${host} — ${(err as Error).message}`),
  );
}

async function main(): Promise<void> {
  // --host reaches a remote arivu over ssh; --socket a local one. They name two
  // different daemons, so passing both is a usage error, not a precedence puzzle.
  if (argv.flags.host !== undefined && argv.flags.socket !== undefined) {
    fail(
      "--host and --socket are mutually exclusive: --host reaches a remote arivu over ssh, --socket dials a local one. Pass just one.",
    );
  }
  // --kaval only travels over the --host dial (it picks which kaval the remote
  // arivu reads); without --host there is no remote arivu to point at.
  if (argv.flags.kaval !== undefined && argv.flags.host === undefined) {
    fail(
      "--kaval only applies with --host (it picks which kaval the remote arivu dials). For a local arivu, point arivu itself at the kaval when you start it.",
    );
  }

  const conn =
    argv.flags.host !== undefined
      ? await connectHost(argv.flags.host, argv.flags.kaval)
      : await connectLocal(argv.flags.socket);

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    conn.dispose();
  };

  try {
    if (argv.flags.json) {
      // Scriptable one-shot — never touches the renderer.
      const entries = await snapshotAwareness(conn.client);
      process.stdout.write(`${formatAwarenessJson(entries)}\n`);
    } else if (!process.stdout.isTTY) {
      // Piped / non-interactive: a one-shot plain-text snapshot. The live
      // renderer takes raw-mode ownership of the terminal and would corrupt a
      // pipe — choosing the right output for the medium, not a fallback.
      const entries = await snapshotAwareness(conn.client);
      process.stdout.write(
        `${formatAwarenessList(entries, { home: homedir() })}\n`,
      );
    } else {
      // Interactive terminal: the live truecolour dashboard until Ctrl-C / q.
      // Imported dynamically + behind the TTY gate so a piped/JSON run never
      // loads the Bun-only native renderer.
      const { runDashboardTui } = await import("./tui.tsx");
      await runDashboardTui({
        client: conn.client,
        home: homedir(),
        // Disposing ends the mirror's streams, so the dashboard unwinds on quit.
        stop: dispose,
      });
    }
  } finally {
    dispose();
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`arivu-tui: ${(err as Error).message}\n`);
  process.exit(1);
});

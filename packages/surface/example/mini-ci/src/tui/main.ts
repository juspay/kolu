/**
 * mini-ci — a CI-runner TUI over oRPC stdio.
 *
 * Spawns the runner (local child or remote ssh), attaches over `stdioLink`,
 * and paints a live dashboard: a node-status table (from the `nodes` cell)
 * plus the attached node's log tail (from the `nodeLog` stream). Keys:
 *
 *   digits 1-9  attach node N        r  rerun the attached node
 *   n / p       next / prev node     q  quit (Ctrl-C / Ctrl-D too)
 *
 * Non-interactive modes for scripting / CI: `--headless` streams
 * transitions, `--json` prints the final state and exits non-zero on
 * failure.
 *
 * Note on detach: kolu-tui's Phase-2 ssh-style `~`-escape exists because
 * that client is a *raw VT passthrough* where every byte must reach the
 * inner program, so it needs an unambiguous escape that never collides with
 * the inner tool. mini-ci's dashboard renders *structured state* and owns
 * the keyboard directly, so it binds plain keys — the `~`-escape decision
 * is recorded for kolu-tui (see the plan), not needed here.
 */

import {
  connectLocal,
  connectRemote,
  type Connection,
  type RunnerClient,
} from "./connect";
import {
  applyLogFrame,
  defaultAttachId,
  renderDashboard,
  summarize,
} from "./render";
import type { NodeLogFrame, NodesSnapshot } from "../common/surface";

interface Args {
  pipeline?: string;
  remote?: string;
  remoteDir?: string;
  attach?: string;
  headless: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { headless: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string | undefined => argv[++i];
    switch (flag) {
      case "run":
      case "--":
        // `run` is the default verb; `--` is the `pnpm start -- …` separator.
        break;
      case "--pipeline":
        args.pipeline = value();
        break;
      case "--remote":
        args.remote = value();
        break;
      case "--remote-dir":
        args.remoteDir = value();
        break;
      case "--attach":
        args.attach = value();
        break;
      case "--headless":
        args.headless = true;
        break;
      case "--json":
        args.json = true;
        break;
      default:
        process.stderr.write(`mini-ci: unknown argument "${flag}"\n`);
        process.exit(1);
    }
  }
  return args;
}

async function connect(args: Args): Promise<Connection> {
  if (args.remote !== undefined) {
    return connectRemote({
      host: args.remote,
      remoteDir: args.remoteDir,
      pipeline: args.pipeline,
    });
  }
  return connectLocal({ pipeline: args.pipeline });
}

/** Iterate the `nodes` cell until the pipeline settles, calling `onState`
 *  for every yield (including the initial snapshot). Returns the final
 *  state. */
async function pumpUntilDone(
  client: RunnerClient,
  onState: (state: NodesSnapshot) => void,
): Promise<NodesSnapshot> {
  let last: NodesSnapshot | undefined;
  for await (const state of await client.surface.nodes.get({})) {
    last = state;
    onState(state);
    if (summarize(state).done) break;
  }
  if (last === undefined)
    throw new Error("mini-ci: runner closed before any state");
  return last;
}

/** `--json`: run to completion, print the final state, exit. */
async function runJson(conn: Connection): Promise<never> {
  const final = await pumpUntilDone(conn.client, () => {});
  process.stdout.write(`${JSON.stringify(final, null, 2)}\n`);
  conn.dispose();
  process.exit(summarize(final).failedOverall ? 1 : 0);
}

/** `--headless` / non-tty: stream status transitions as plain lines. */
async function runHeadless(conn: Connection): Promise<never> {
  const seen = new Map<string, string>();
  const final = await pumpUntilDone(conn.client, (state) => {
    for (const id of state.order) {
      const node = state.nodes[id];
      if (node === undefined) continue;
      if (seen.get(id) !== node.status) {
        seen.set(id, node.status);
        process.stdout.write(`${node.status.padEnd(8)} ${id}\n`);
      }
    }
  });
  const summary = summarize(final);
  process.stdout.write(
    `done — ${summary.ok} ok, ${summary.failed} failed, ${summary.skipped} skipped\n`,
  );
  conn.dispose();
  process.exit(summary.failedOverall ? 1 : 0);
}

/** Interactive raw-tty dashboard. */
async function runInteractive(conn: Connection, args: Args): Promise<void> {
  const client = conn.client;
  let state: NodesSnapshot | undefined;
  let attachedId = args.attach;
  let log = "";
  // The current log subscription's teardown — `attachedId` is navigation
  // state (it has other consumers: render, keyboard nav, rerun), so only the
  // subscription *lifecycle* lives in one handle here.
  let detachLog: (() => void) | undefined;

  const repaint = (): void => {
    if (state === undefined) return;
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(`${renderDashboard({ state, attachedId, log })}\n`);
    process.stdout.write(
      "\n[digits] attach · [n/p] cycle · [r] rerun · [q] quit\n",
    );
  };

  const attach = (id: string | undefined): void => {
    if (id === undefined || id === attachedId) return;
    attachedId = id;
    log = "";
    detachLog?.();
    detachLog = attachLog(client, id, (frame) => {
      log = applyLogFrame(log, frame);
      repaint();
    });
    repaint();
  };

  // State pump — keeps the table live and seeds the initial attachment.
  const stateDone = (async (): Promise<void> => {
    for await (const next of await client.surface.nodes.get({})) {
      state = next;
      if (attachedId === undefined) attach(defaultAttachId(next));
      repaint();
    }
  })();

  const quit = (code: number): void => {
    detachLog?.();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    conn.dispose();
    process.exit(code);
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (key: string) => {
    if (key === "q" || key === "\x03" || key === "\x04") return quit(0);
    if (key === "r" && attachedId !== undefined) {
      void client.surface.node.rerun({ id: attachedId });
      return;
    }
    if (state === undefined) return;
    if (key === "n" || key === "p") {
      const idx = attachedId ? state.order.indexOf(attachedId) : -1;
      const delta = key === "n" ? 1 : -1;
      const next =
        state.order[(idx + delta + state.order.length) % state.order.length];
      attach(next);
      return;
    }
    if (key >= "1" && key <= "9") {
      const next = state.order[Number(key) - 1];
      if (next !== undefined) attach(next);
    }
  });

  await stateDone;
  quit(state !== undefined && summarize(state).failedOverall ? 1 : 0);
}

/** Subscribe to a node's log; returns a `detach()` that aborts the
 *  subscription. Owns the AbortController so the caller holds one teardown
 *  handle, not a controller it has to remember to abort. */
function attachLog(
  client: RunnerClient,
  id: string,
  onFrame: (frame: NodeLogFrame) => void,
): () => void {
  const controller = new AbortController();
  void pumpLog(client, id, controller.signal, onFrame);
  return () => controller.abort();
}

async function pumpLog(
  client: RunnerClient,
  id: string,
  signal: AbortSignal,
  onFrame: (frame: NodeLogFrame) => void,
): Promise<void> {
  try {
    for await (const frame of await client.surface.nodeLog.get(
      { id },
      { signal },
    )) {
      onFrame(frame);
    }
  } catch {
    // Aborted on attach-switch or quit — expected.
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const conn = await connect(args);
  if (args.json) {
    await runJson(conn);
  } else if (args.headless || !process.stdin.isTTY || !process.stdout.isTTY) {
    await runHeadless(conn);
  } else {
    await runInteractive(conn, args);
  }
}

main().catch((err) => {
  process.stderr.write(`mini-ci: ${(err as Error).message}\n`);
  process.exit(1);
});

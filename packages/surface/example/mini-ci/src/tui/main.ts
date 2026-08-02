/**
 * mini-ci — a CI-runner TUI over an Effect RPC stdio link.
 *
 * Connects to the runner via `@kolu/surface-remote` (provision and root the
 * runner through Nix, then run it over ssh; localhost runs it directly) and
 * paints a live dashboard: a node-status
 * table (from the `nodes` cell) plus the attached node's log tail (from the
 * `nodeLog` stream). The default pipeline runs real CI for the
 * remote-process-monitor example. Keys:
 *
 *   digits 1-9  attach node N        r  rerun the attached node
 *   n / p       next / prev node     q  quit (Ctrl-C / Ctrl-D too)
 *
 * Usage: `just run [host]` (default localhost). Non-interactive modes for
 * scripting / CI: `--headless` streams transitions, `--json` prints the final
 * state and exits non-zero on failure.
 *
 * Every member call is a `Stream` or a `Promise` off `./members` — including the
 * teardown story: detaching a log is interrupting its fiber, which unwinds the
 * wire subscription. There is no `AbortController` anywhere in this file.
 *
 * Note on detach: kolu-tui's Phase-2 ssh-style `~`-escape exists because that
 * client is a *raw VT passthrough* where every byte must reach the inner
 * program. mini-ci's dashboard renders *structured state* and owns the
 * keyboard directly, so it binds plain keys.
 */

import { parseArgs as nodeParseArgs } from "node:util";
import { Effect, Stream } from "effect";
import type { NodesSnapshot } from "../common/surface";
import { type Connection, connect } from "./connect";
import { nodeLogStream, nodesStream, rerunNode, runStream } from "./members";
import {
  applyLogFrame,
  defaultAttachId,
  renderDashboard,
  summarize,
} from "./render";

interface Args {
  host: string;
  attach?: string;
  headless: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  // `pnpm start -- …` forwards a literal `--`; node:util treats `--` as
  // end-of-options, so strip a leading one. The first positional is the host.
  const cleaned = argv[0] === "--" ? argv.slice(1) : argv;
  const { values, positionals } = nodeParseArgs({
    args: cleaned,
    allowPositionals: true,
    options: {
      attach: { type: "string" },
      headless: { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  return {
    host: positionals[0] ?? "localhost",
    attach: values.attach,
    headless: values.headless ?? false,
    json: values.json ?? false,
  };
}

/** Follow the `nodes` cell until the pipeline settles, calling `onState` for
 *  every frame. `takeUntil` ends the stream on the settling frame — which
 *  finalizes the subscription, so there is nothing left to unsubscribe. Flips
 *  the session to `connected` on the first frame (the session watchdog reaps the
 *  link otherwise). */
async function pumpUntilDone(
  conn: Connection,
  onState: (state: NodesSnapshot) => void,
): Promise<NodesSnapshot> {
  let last: NodesSnapshot | undefined;
  let first = true;
  await Effect.runPromise(
    Stream.runForEach(
      Stream.takeUntil(nodesStream(conn.client), (s) => summarize(s).done),
      (state) =>
        Effect.sync(() => {
          if (first) {
            first = false;
            conn.session.markConnected();
          }
          last = state;
          onState(state);
        }),
    ),
  );
  if (last === undefined) {
    throw new Error("mini-ci: runner closed before any state");
  }
  return last;
}

/** `--json`: run to completion, print the final state, exit. */
async function runJson(conn: Connection): Promise<never> {
  const final = await pumpUntilDone(conn, () => {});
  process.stdout.write(`${JSON.stringify(final, null, 2)}\n`);
  conn.dispose();
  process.exit(summarize(final).failedOverall ? 1 : 0);
}

/** `--headless` / non-tty: stream status transitions as plain lines. */
async function runHeadless(conn: Connection): Promise<never> {
  const seen = new Map<string, string>();
  const final = await pumpUntilDone(conn, (state) => {
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
  // `attachedId` is the *active* (subscribed) node; `args.attach` is only the
  // initial *request*, validated + seeded on the first frame so attach()
  // actually subscribes (it short-circuits when id === attachedId).
  let attachedId: string | undefined;
  let log = "";
  // The current log subscription's stopper — `attachedId` is navigation
  // state (render, keyboard nav, rerun), so only the subscription *lifecycle*
  // lives in one handle here.
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
    // Stopping the previous subscription interrupts its fiber, which unwinds
    // the wire subscription — and after the stopper runs it reports nothing,
    // so a late frame can never contaminate the newly attached node's log.
    detachLog?.();
    detachLog = runStream(nodeLogStream(client, id), {
      onFrame: (frame) => {
        log = applyLogFrame(log, frame);
        repaint();
      },
      // Surface a broken log stream in the log pane instead of freezing it.
      onFailure: (err) => {
        log = applyLogFrame(log, {
          kind: "append",
          text: `\n[mini-ci] log stream error: ${err.message}\n`,
        });
        repaint();
      },
    });
    repaint();
  };

  // State pump — keeps the table live and seeds the initial attachment.
  let first = true;
  const stateDone = new Promise<void>((resolveDone, rejectDone) => {
    runStream(nodesStream(client), {
      onFrame: (next) => {
        if (first) {
          first = false;
          conn.session.markConnected();
          // Seed the attachment once: honour --attach if it names a real node,
          // else the default. attachedId is undefined here, so attach()
          // subscribes rather than short-circuiting on `id === attachedId`.
          const initial =
            args.attach !== undefined && next.nodes[args.attach] !== undefined
              ? args.attach
              : defaultAttachId(next);
          attach(initial);
        }
        state = next;
        repaint();
      },
      onEnd: resolveDone,
      onFailure: rejectDone,
    });
  });

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
      void rerunNode(client, attachedId);
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const interactive =
    !args.json &&
    !args.headless &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true;

  // The session's provisioning/connecting progress goes to stderr; a one-liner
  // up front frames it while the closure is prepared.
  process.stderr.write(`mini-ci: connecting to ${args.host}…\n`);
  const conn = await connect({ host: args.host });

  if (args.json) {
    await runJson(conn);
  } else if (!interactive) {
    await runHeadless(conn);
  } else {
    await runInteractive(conn, args);
  }
}

main().catch((err) => {
  process.stderr.write(`mini-ci: ${(err as Error).message}\n`);
  process.exit(1);
});

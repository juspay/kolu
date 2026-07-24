/**
 * vazhi (Tamil: *way, passage*) — a standalone TUI for port forwards.
 *
 * One screen, three keys: `a` opens a forward to a `host:port`, `x` cancels the
 * selected one, `q` quits and takes every forward it opened down with it. No
 * subcommands, no daemon, no config — run it, forward a port, quit.
 *
 *     pu-dev:5173  →  0.0.0.0:61010  up 12m
 *
 * That line means: whatever is listening on pu-dev's own `127.0.0.1:5173` now
 * answers on port 61010 of THIS machine, on every interface — so a browser
 * anywhere on the network can open it, which loopback on pu-dev could never do.
 *
 * vazhi is deliberately independent of kolu: its only import is
 * `@kolu/port-forward`, the shared library kolu's Inspector uses too. The two
 * never talk. They do share ssh connections — both compute the same
 * `ControlMaster` path, so a forward here rides the master kolu already opened
 * (and vice versa) with no coordination code at all. Run vazhi inside a kolu
 * terminal and kolu's PTY persistence keeps it alive across browser reloads for
 * free; run it on a box with no kolu at all and it works the same.
 */

import { hostname } from "node:os";
import {
  createForwardManager,
  type Forward,
  formatTarget,
  parseTarget,
} from "@kolu/port-forward";
import { splitKeys } from "./keys.ts";
import {
  clampSelection,
  type Mode,
  renderScreen,
  type Status,
} from "./render.ts";

/** Alternate screen in, cursor hidden — and the exact inverse on the way out. */
const ENTER_TUI = "\x1b[?1049h\x1b[?25l";
const LEAVE_TUI = "\x1b[?25h\x1b[?1049l";
/** Home the cursor and clear what was below it — one write per frame, so the
 *  table never flickers through a blank screen. */
const FRAME_START = "\x1b[H\x1b[J";

/** How often the uptime column re-renders. */
const TICK_MS = 1000;

function fail(message: string): never {
  process.stderr.write(`vazhi: ${message}\n`);
  process.exit(1);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function main(): void {
  // A TUI with no terminal is a category error, not something to degrade into a
  // log-printing mode — say so and stop.
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    fail(
      "this is an interactive TUI and needs a terminal on stdin and stdout (it has no subcommands to script).",
    );
  }

  let mode: Mode = { kind: "table" };
  let status: Status | undefined;
  let selected = 0;
  let quitting = false;

  const forwards = createForwardManager({
    // A forward can die without being cancelled — the host drops, the ssh
    // master goes away. It leaves the table AND says why; a dead row that still
    // looks live is the one thing this screen must never show.
    onLost: ({ forward, reason }) => {
      status = { kind: "error", text: `lost ${forward.key} — ${reason}` };
      draw();
    },
  });

  const machine = hostname();

  function draw(): void {
    if (quitting) return;
    const list = forwards.list();
    selected = clampSelection(selected, list.length);
    const lines = renderScreen({
      forwards: list,
      selected,
      mode,
      status,
      now: Date.now(),
      // A PTY that reports no size at all (0 columns — a harness, a detached
      // pty) would otherwise clip every line to nothing; 80 is the terminal
      // default and the only sane frame to draw when the size is unknown.
      width: process.stdout.columns > 0 ? process.stdout.columns : 80,
      hostname: machine,
    });
    process.stdout.write(`${FRAME_START}${lines.join("\r\n")}\r\n`);
  }

  function restoreTerminal(): void {
    process.stdin.setRawMode(false);
    process.stdout.write(LEAVE_TUI);
  }

  /** Quit: every forward this process opened goes down with it. A teardown that
   *  refuses is reported on the way out (and exits non-zero) — never swallowed,
   *  because a leftover listener is a door left open. */
  async function quit(): Promise<never> {
    quitting = true;
    process.stdout.write(`${FRAME_START}tearing down forwards…\r\n`);
    let failure: string | undefined;
    try {
      await forwards.dispose();
    } catch (err) {
      failure = messageOf(err);
    }
    restoreTerminal();
    if (failure !== undefined) {
      process.stderr.write(`vazhi: ${failure}\n`);
      process.exit(1);
    }
    process.exit(0);
  }

  async function add(text: string): Promise<void> {
    let target: ReturnType<typeof parseTarget>;
    try {
      target = parseTarget(text);
    } catch (err) {
      status = { kind: "error", text: messageOf(err) };
      draw();
      return;
    }
    status = { kind: "info", text: `opening ${formatTarget(target)}…` };
    draw();
    try {
      const forward = await forwards.create(target);
      status = {
        kind: "info",
        text: `${forward.key} is answering on http://${machine}:${forward.localPort}`,
      };
      selected = forwards.list().findIndex((f) => f.key === forward.key);
    } catch (err) {
      status = { kind: "error", text: messageOf(err) };
    }
    draw();
  }

  async function cancelSelected(): Promise<void> {
    const list = forwards.list();
    const forward: Forward | undefined =
      list[clampSelection(selected, list.length)];
    if (forward === undefined) {
      status = { kind: "info", text: "no forwards to cancel." };
      draw();
      return;
    }
    status = { kind: "info", text: `cancelling ${forward.key}…` };
    draw();
    try {
      await forwards.cancel(forward.key);
      status = { kind: "info", text: `cancelled ${forward.key}.` };
    } catch (err) {
      status = { kind: "error", text: messageOf(err) };
    }
    draw();
  }

  function onTableKey(key: string): void {
    if (key === "q" || key === "\x03") {
      void quit();
      return;
    }
    if (key === "a") {
      mode = { kind: "add", input: "" };
      status = undefined;
      draw();
      return;
    }
    if (key === "x") {
      void cancelSelected();
      return;
    }
    if (key === "j" || key === "\x1b[B") {
      selected += 1;
      draw();
      return;
    }
    if (key === "k" || key === "\x1b[A") {
      selected -= 1;
      draw();
      return;
    }
  }

  function onAddKey(key: string, input: string): void {
    if (key === "\x1b" || key === "\x03") {
      mode = { kind: "table" };
      draw();
      return;
    }
    if (key === "\r" || key === "\n") {
      mode = { kind: "table" };
      void add(input);
      return;
    }
    if (key === "\x7f" || key === "\b") {
      mode = { kind: "add", input: input.slice(0, -1) };
      draw();
      return;
    }
    // Printable characters only: an unhandled escape sequence must not land in
    // the prompt as mojibake that then fails to parse.
    if (key.length === 1 && key >= " " && key !== "\x7f") {
      mode = { kind: "add", input: input + key };
      draw();
      return;
    }
  }

  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdout.write(ENTER_TUI);

  process.stdin.on("data", (chunk: string) => {
    if (quitting) return;
    // Arrow keys arrive as one 3-byte escape sequence; everything else this
    // screen cares about is a single character, so a chunk is split into
    // sequences and handled one at a time.
    for (const key of splitKeys(chunk)) {
      if (mode.kind === "add") onAddKey(key, mode.input);
      else onTableKey(key);
    }
  });

  // An external stop must tear the forwards down exactly as `q` does.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      void quit();
    });
  }

  // The uptime column has to move on its own; `unref` keeps the ticker from
  // being the reason the process stays alive.
  const ticker = setInterval(draw, TICK_MS);
  ticker.unref();
  process.stdout.on("resize", draw);

  draw();
}

main();

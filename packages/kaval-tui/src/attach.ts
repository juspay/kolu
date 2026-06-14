/**
 * `kaval-tui attach` — the raw-tty passthrough loop (R-4 Phase 2). The design
 * decisions live in `docs/atlas/src/content/atlas/pty-daemon-tui.mdx` (Phase 2
 * section) and are echoed at their sites below: device-query reply filtering,
 * resize-then-attach, one-shot notices only, exit-stream discrimination with
 * no auto-retry, and one deterministic restore on every exit path (the restore
 * itself — `@kolu/terminal-protocol`'s `SNAPSHOT_TTY_RESET` + un-raw — is the
 * caller's job, in `main.ts`, so it can also run on signals and crashes that
 * never return through this function).
 *
 * Factored over `AttachTty` (streams + size, no `process.*`) so the loop is
 * integration-testable against a real pty-host over a real unix socket with no
 * actual tty — see `attach.test.ts`.
 */
import { StringDecoder } from "node:string_decoder";
import { SURFACE_STDIO_TRANSPORT_CLOSED } from "@kolu/surface/client";
import { createTerminalResponseStripper } from "@kolu/terminal-protocol";
import type { PtyTuiClient } from "./connect.ts";
import { createEscapeScanner } from "./escape.ts";

/** The local terminal, abstracted: `main.ts` binds the real process streams;
 *  tests bind PassThroughs and a fixed size. */
export interface AttachTty {
  /** Raw keyboard bytes from the user (no encoding set — Buffer chunks). */
  input: NodeJS.ReadableStream;
  /** Write VT bytes to the user's terminal (the passthrough sink). */
  write(data: string): Promise<void>;
  /** Current local dimensions. */
  size(): { cols: number; rows: number };
  /** Subscribe to local size changes; returns unsubscribe. */
  onResize(cb: () => void): () => void;
  /** Switch the local tty in/out of raw mode (no-op in tests). */
  setRawMode(on: boolean): void;
}

export type AttachOutcome =
  /** The id matched no live PTY (and we never attached — not an exit). */
  | { kind: "not-found" }
  /** `~.` (or stdin EOF): the CLI leaves, the daemon keeps the PTY. */
  | { kind: "detached" }
  /** The PTY's child exited; `exitCode` is the real code (exit tombstone). */
  | { kind: "exited"; exitCode: number }
  /** Transport/contract failure — `message` is ready to print. */
  | { kind: "error"; message: string };

export function helpText(escapeChar: string): string {
  const e = escapeChar;
  return (
    `\r\nkaval-tui escapes (recognised at line start only):\r\n` +
    `  ${e}.  detach — the daemon keeps the terminal\r\n` +
    `  ${e}${e}  send a literal ${e}\r\n` +
    `  ${e}?  this help\r\n`
  );
}

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

const isNotFound = (err: unknown): boolean => errorCode(err) === "NOT_FOUND";

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // The link's dead-transport rejection (and the rawer shapes a mid-stream
  // socket death can surface) get the actionable copy; anything else prints
  // as-is.
  if (
    errorCode(err) === SURFACE_STDIO_TRANSPORT_CLOSED ||
    /transport is closed|ECONNRESET|EPIPE|socket/i.test(message)
  ) {
    return `the daemon went away mid-attach (${message}) — re-run \`kaval-tui attach\` once it's back.`;
  }
  return message;
}

/** The PTY is gone — fetch its real exit code. Exit codes tombstone in the
 *  pty-host past teardown, so the one-shot `exit` stream resolves immediately
 *  here (it only blocks while the PTY is alive, which it no longer is). */
async function readExitCode(client: PtyTuiClient, id: string): Promise<number> {
  for await (const msg of await client.surface.exit.get({ id })) {
    return msg.exitCode;
  }
  return 0;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface AttachOptions {
  escape?: string;
  tty: AttachTty;
}

/**
 * Attach to PTY `id` and pump until detach, PTY exit, or transport death.
 * Re-attaches by itself when the output stream drops with the PTY still live
 * (the slow-consumer drop: the pty-host bounds each subscriber's queue and
 * silently ends laggards — a fresh attach repaints from the snapshot, which is
 * exactly the right recovery). Never opts into stream auto-retry: a transparent
 * re-subscribe would replay the snapshot mid-session into a live screen.
 */
export async function runAttach(
  client: PtyTuiClient,
  id: string,
  opts: AttachOptions,
): Promise<AttachOutcome> {
  const { tty } = opts;
  const escapeChar = opts.escape ?? "~";
  const scanner = createEscapeScanner(escapeChar);
  // Streaming reply-strip — see `onStdin`. Stateful across chunks, so it lives
  // for the whole attach, not per-chunk.
  const stripper = createTerminalResponseStripper();
  // Forwarded bytes → UTF-8 at the write boundary only: the scanner runs on
  // bytes, and a multibyte char split across stdin chunks must reassemble
  // before it crosses the wire as a string.
  const decoder = new StringDecoder("utf8");

  let detachRequested = false;
  let transportError: unknown;
  let currentAbort: AbortController | undefined;

  // One ordered queue for everything stdin-driven that crosses the wire:
  // write RPCs are async, and two keystrokes racing each other must not
  // reorder. A failed write means the transport died — surface it through
  // the read loop by aborting the live attach stream.
  let wire: Promise<void> = Promise.resolve();
  const enqueue = (call: () => Promise<unknown>): void => {
    wire = wire.then(call).then(
      () => undefined,
      (err) => {
        transportError ??= err;
        currentAbort?.abort();
      },
    );
  };

  const detach = (): void => {
    detachRequested = true;
    currentAbort?.abort();
  };

  // ssh-style escape ordering: bytes the user sent BEFORE `~.` (or before stdin
  // EOF) must reach the PTY before the local client leaves — `echo work\r~.`
  // has to land `echo work` on the remote. Those writes are only *enqueued* on
  // the ordered `wire` chain when detach fires, so every `detached` return
  // awaits the chain to empty first. Each enqueued call may itself enqueue
  // (none do today, but the loop is cheap insurance), so we await until the
  // tail stops moving. A write that failed surfaced its error through
  // `transportError`; we propagate that instead of reporting a clean detach.
  const drainWire = async (): Promise<AttachOutcome> => {
    let seen: Promise<void> | undefined;
    while (seen !== wire) {
      seen = wire;
      await seen;
    }
    if (transportError !== undefined) {
      return { kind: "error", message: describeError(transportError) };
    }
    return { kind: "detached" };
  };

  // `AttachTty.input` carries Buffer chunks by contract (no encoding set —
  // the interface doc says so, and the byte machines below depend on it).
  const onStdin = (chunk: Buffer): void => {
    // Reply strip — the passthrough makes the user's REAL terminal answer the
    // device queries riding in the snapshot/deltas (DA1, DSR, XTVERSION…), but
    // the headless mirror already answered them server-side. Forwarding the
    // duplicate corrupts the inner program's stdin (the yazi escape-soup bug).
    // Unlike the browser path (`Terminal.tsx` onData), a raw tty read does NOT
    // give us one discrete reply per event — replies split across reads,
    // coalesce, or sit against a keystroke — so we run the STREAMING stripper
    // (boundary-aware, state across chunks) rather than the whole-chunk
    // predicate. Same response grammars, same client-suppressed ⇒
    // server-answered invariant.
    for (const ev of scanner.feed(stripper.push(chunk))) {
      if (ev.kind === "forward") {
        const data = decoder.write(ev.data);
        if (data !== "")
          enqueue(() => client.surface.terminal.write({ id, data }));
      } else if (ev.kind === "help") {
        void tty.write(helpText(escapeChar));
      } else {
        detach();
      }
    }
  };

  // stdin EOF can't happen on a healthy interactive tty; if the input stream
  // dies under us, leaving cleanly (server keeps the PTY) is the only sane
  // reading.
  const onStdinEnd = (): void => detach();

  const offResize = tty.onResize(() => {
    const { cols, rows } = tty.size();
    enqueue(() => client.surface.terminal.resize({ id, cols, rows }));
  });

  tty.setRawMode(true);
  tty.input.on("data", onStdin);
  tty.input.on("end", onStdinEnd);

  let attachedOnce = false;
  // A PTY that's gone is `not-found` if we never attached, else `exited` with
  // the tombstone code. The deltas stream ends identically for the inventory
  // miss and the isNotFound attach error, so both sites resolve it here.
  const resolveGone = async (): Promise<AttachOutcome> =>
    attachedOnce
      ? { kind: "exited", exitCode: await readExitCode(client, id) }
      : { kind: "not-found" };

  try {
    for (;;) {
      // A detach can land between streams (the previous one already ended, or
      // none has started) — honour it before dialing a fresh attach whose
      // AbortController the earlier detach() couldn't reach.
      if (detachRequested) return drainWire();
      // Inventory pre-flight: an honest not-found before any screen takeover,
      // the pid for the attach notice, and — on re-attach — the live/exited
      // discrimination (the deltas stream ends identically for PTY exit,
      // server abort, and the silent slow-consumer drop; whether the PTY is
      // still listed is what tells them apart).
      let pid: number;
      try {
        const { entries } = await client.surface.terminal.list({});
        const entry = entries.find((e) => e.id === id);
        if (!entry) return resolveGone();
        pid = entry.pid;
      } catch (err) {
        return { kind: "error", message: describeError(err) };
      }

      const abort = new AbortController();
      currentAbort = abort;
      try {
        // Resize-then-attach (design decision): the snapshot serializes at
        // the server-side grid, so resizing FIRST makes it render at the
        // local dimensions. Cross-client policy is last-resize-wins — a
        // concurrently-attached browser tile may show wrap artifacts until
        // its own next resize (a size-change tap would be contract 2.2).
        const { cols, rows } = tty.size();
        await client.surface.terminal.resize({ id, cols, rows });
        const stream = await client.surface.terminalAttach.get(
          { id },
          { signal: abort.signal },
        );
        const iter = stream[Symbol.asyncIterator]();
        // First-frame guard — same fail-loud stance as the web path
        // (terminalEndpoint/local.ts): a non-snapshot first frame is a
        // contract violation, not something to paint.
        const first = await iter.next();
        if (!first.done) {
          if (first.value.kind !== "snapshot") {
            return {
              kind: "error",
              message: `attach(${id}): expected a snapshot first frame, got "${first.value.kind}"`,
            };
          }
          const snapshot = first.value.data;
          // One-shot notice (design decision: no persistent footer — the
          // passthrough owns zero pixels while attached). It survives only
          // until the clear below on most paints; the durable trailers are
          // the detach/exit lines main.ts prints after restore.
          const lines = snapshot === "" ? 0 : snapshot.split("\n").length;
          await tty.write(
            `↻ snapshot restored — ${lines} line${lines === 1 ? "" : "s"} · PTY pid ${pid}${attachedOnce ? " unchanged" : ""}\r\n`,
          );
          // Home + clear before painting: the serialized snapshot is built to
          // replay into a FRESH same-size terminal (its final cursor moves are
          // relative, and the inner program's later absolute addressing
          // assumes its row 1 is the screen's row 1). Painting mid-screen
          // would misalign every absolute escape that follows.
          await tty.write("\x1b[H\x1b[2J");
          await tty.write(snapshot);
          attachedOnce = true;
          for await (const msg of { [Symbol.asyncIterator]: () => iter }) {
            // Backpressure-aware: tty.write resolves on drain, so a slow
            // local terminal slows this consumer rather than ballooning
            // memory. (The server side bounds its queue regardless; if we
            // lag past it, the stream drops and the loop re-attaches.)
            await tty.write(msg.data);
          }
        }
      } catch (err) {
        if (detachRequested) return drainWire();
        // The PTY vanished between the inventory and the attach (or during a
        // re-attach) — same gone discrimination as the pre-flight.
        if (isNotFound(err)) return resolveGone();
        return {
          kind: "error",
          message: describeError(transportError ?? err),
        };
      }
      if (detachRequested) return drainWire();
      // Clean stream end: PTY exit or slow-consumer drop — loop back; the
      // inventory pre-flight discriminates. The pause keeps a pathological
      // immediate-drop server from spinning us hot.
      await delay(150);
    }
  } finally {
    currentAbort?.abort();
    tty.input.off("data", onStdin);
    tty.input.off("end", onStdinEnd);
    offResize();
    tty.setRawMode(false);
  }
}

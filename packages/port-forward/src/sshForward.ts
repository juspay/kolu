/**
 * The mechanism for a `remote` target: an `ssh -L` tunnel on a SHARED master.
 *
 * Nothing here manages an ssh connection. `ControlMaster=auto` plus the
 * deterministic `ControlPath` from `controlOpts.ts` means the first process to
 * reach a host becomes the master and everyone else rides it as a channel — so
 * when kolu already mirrors that host, a forward opened here adds no second ssh
 * connection, and when nothing else is running, this opens the master others
 * will later ride. That is the entire integration.
 *
 * Two facts about ssh shape the design:
 *
 *  1. `ssh -O forward` / `-O cancel` ask a RUNNING master to add or drop a
 *     listener. There must therefore be a master before the first forward.
 *  2. A forward listener does NOT keep a master busy. A `ControlPersist`
 *     master with nothing but forwards on it reaps itself on the idle timer
 *     and takes every forward down with it (measured: master gone, listener
 *     gone, connections refused).
 *
 * So each host with at least one forward gets an ANCHOR: one ssh child running
 * `cat` on the far end with a pipe we hold open and never write to. It costs no
 * traffic, it establishes the master when there isn't one, and it keeps the
 * master out of its idle timer for exactly as long as we hold a forward. It is
 * our child, so it dies when we do — and the forwards die with the master
 * shortly after, which is why a hard-killed process cannot leak tunnels
 * forever. `close()`/`dispose()` are the deliberate path and drop them at once.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { sshControlArgs } from "./controlOpts.ts";
import { pickFreePort } from "./freePort.ts";
import type { OpenedForward } from "./opened.ts";
import { assertHost, assertPort } from "./target.ts";

/** The dead-peer policy for every ssh we spawn — the same pairs kolu's own ssh
 *  uses (`SSH_OPT_PAIRS` in `@kolu/surface-remote`). `BatchMode=yes` matters
 *  most here: these commands run under a TUI that has no way to host a password
 *  prompt, so a host that would prompt must fail fast instead of hanging. */
const SSH_KEEPALIVE_OPTS: readonly string[] = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ServerAliveInterval=10",
  "-o",
  "ServerAliveCountMax=3",
  "-o",
  "ConnectTimeout=10",
];

/** What the anchor runs on the far end: a process that does nothing and exits
 *  the moment its stdin closes — i.e. the moment we go away. */
const ANCHOR_COMMAND = "cat";

/** How long to wait for the anchor's master to come up before failing loud.
 *  Generous because a cold host pays a real handshake (and possibly a
 *  known-hosts round trip); a wrong host still fails inside `ConnectTimeout`. */
const MASTER_TIMEOUT_MS = 30_000;

/** How often to ask ssh whether the master is up yet. */
const MASTER_POLL_MS = 200;

/** The keepalive policy plus the multiplexing opts — the argv prefix every ssh
 *  here is built on. Not pure: `sshControlArgs()` creates the owner-only
 *  control directory on first use (and throws if it can't). */
export function sshBaseArgs(): readonly string[] {
  return [...SSH_KEEPALIVE_OPTS, ...sshControlArgs()];
}

/** The `-L` argument. `*:` is load-bearing: it binds the listener on ALL
 *  interfaces regardless of `GatewayPorts`, which is the whole point — the
 *  browser that opens this port is on another machine. The far end is always
 *  the target host's own loopback, since a port already bound to `0.0.0.0`
 *  there needs no forward at all. */
export function forwardSpec(opts: {
  localPort: number;
  remotePort: number;
}): string {
  return `*:${opts.localPort}:127.0.0.1:${opts.remotePort}`;
}

/** `ssh … -O forward|cancel -L <spec> <host>` — the argv that adds or drops a
 *  listener on the running master. */
export function forwardCommandArgs(opts: {
  base: readonly string[];
  host: string;
  verb: "forward" | "cancel";
  localPort: number;
  remotePort: number;
}): string[] {
  return [...opts.base, "-O", opts.verb, "-L", forwardSpec(opts), opts.host];
}

/** `ssh … -O check <host>` — does a master exist for this host? */
export function checkCommandArgs(opts: {
  base: readonly string[];
  host: string;
}): string[] {
  return [...opts.base, "-O", "check", opts.host];
}

/** `ssh … <host> cat` — the anchor session (see the module doc). */
export function anchorCommandArgs(opts: {
  base: readonly string[];
  host: string;
}): string[] {
  return [...opts.base, opts.host, ANCHOR_COMMAND];
}

/** Run an ssh command to completion. Rejects with the exit code AND ssh's own
 *  stderr, because that text ("bind: Address already in use", "Host key
 *  verification failed") is the only useful thing to show a user. */
function runSsh(args: readonly string[], what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (err) => {
      reject(
        new Error(`port-forward: ${what} — could not run ssh: ${err.message}`),
      );
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(
        new Error(
          `port-forward: ${what} — ssh exited ${code}${detail === "" ? "" : `: ${detail}`}`,
        ),
      );
    });
  });
}

/** Is a master already up for `host`? A false here is an ordinary answer, not
 *  a failure — `-O check` exits non-zero when there is simply no socket yet. */
function masterIsUp(base: readonly string[], host: string): Promise<boolean> {
  return runSsh(
    checkCommandArgs({ base, host }),
    `checking the ssh master for ${host}`,
  )
    .then(() => true)
    .catch(() => false);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One host's anchor: the ssh child that holds its master open, plus the
 *  forwards counting on it. */
interface Anchor {
  readonly child: ChildProcess;
  /** How many forwards are riding this anchor. At zero the anchor is killed. */
  refs: number;
  /** Set once the anchor's ssh died — the master (and every forward on it) is
   *  gone, so `close()` must not try to cancel through it. */
  lost: boolean;
  /** Per-forward loss callbacks to fire if the anchor dies under them. */
  readonly onLost: Set<(reason: string) => void>;
}

/** The ssh side of the forward map: opens `-L` tunnels on shared masters and
 *  owns one anchor per host. */
export interface SshForwards {
  open(
    host: string,
    remotePort: number,
    onLost: (reason: string) => void,
  ): Promise<OpenedForward>;
}

export function createSshForwards(): SshForwards {
  const anchors = new Map<string, Anchor>();
  const opening = new Map<string, Promise<Anchor>>();

  async function startAnchor(host: string): Promise<Anchor> {
    const base = sshBaseArgs();
    // stdin is a pipe we never write to: `cat` blocks on it forever and gets
    // EOF the instant this process goes away, so the anchor cannot outlive us.
    const child = spawn("ssh", anchorCommandArgs({ base, host }), {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const anchor: Anchor = { child, refs: 0, lost: false, onLost: new Set() };

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    let death: string | undefined;
    child.once("error", (err) => {
      death = `could not run ssh: ${err.message}`;
    });
    child.once("exit", (code, signal) => {
      death ??= `ssh exited ${signal ?? code}`;
      anchor.lost = true;
      const reason = `the ssh connection to ${host} ended (${death}${stderr.trim() === "" ? "" : `: ${stderr.trim()}`})`;
      for (const notify of anchor.onLost) notify(reason);
      anchor.onLost.clear();
      anchors.delete(host);
    });

    const deadline = Date.now() + MASTER_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (death !== undefined) {
        throw new Error(
          `port-forward: could not open an ssh session to ${host} — ${death}${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`,
        );
      }
      if (await masterIsUp(base, host)) return anchor;
      await delay(MASTER_POLL_MS);
    }
    child.kill();
    throw new Error(
      `port-forward: no ssh master for ${host} after ${MASTER_TIMEOUT_MS}ms. Check that \`ssh ${host}\` works without a prompt.`,
    );
  }

  /** The anchor for `host`, started if needed, with one more forward on it.
   *  Concurrent acquires share the one in-flight start — two forwards to the
   *  same host must never race into two anchors. */
  async function acquireAnchor(host: string): Promise<Anchor> {
    const existing = anchors.get(host);
    if (existing !== undefined) {
      existing.refs += 1;
      return existing;
    }
    const inflight = opening.get(host);
    if (inflight !== undefined) {
      const anchor = await inflight;
      anchor.refs += 1;
      return anchor;
    }
    const start = startAnchor(host).then((anchor) => {
      anchors.set(host, anchor);
      return anchor;
    });
    opening.set(host, start);
    try {
      const anchor = await start;
      anchor.refs += 1;
      return anchor;
    } finally {
      opening.delete(host);
    }
  }

  /** Drop one forward's claim on the anchor; the last one out kills it. */
  function releaseAnchor(host: string, anchor: Anchor): void {
    anchor.refs -= 1;
    if (anchor.refs > 0) return;
    anchors.delete(host);
    if (!anchor.lost) anchor.child.kill();
  }

  return {
    async open(host, remotePort, onLost) {
      assertHost(host);
      assertPort(remotePort, `the port on ${host}`);
      const base = sshBaseArgs();
      const anchor = await acquireAnchor(host);
      let localPort: number;
      try {
        localPort = await pickFreePort();
        await runSsh(
          forwardCommandArgs({
            base,
            host,
            verb: "forward",
            localPort,
            remotePort,
          }),
          `opening a forward to ${host}:${remotePort}`,
        );
      } catch (err) {
        releaseAnchor(host, anchor);
        throw err;
      }
      anchor.onLost.add(onLost);
      return {
        localPort,
        close: async () => {
          anchor.onLost.delete(onLost);
          try {
            // A lost anchor means the master is already gone, and with it every
            // listener it held — there is nothing left to cancel.
            if (!anchor.lost) {
              await runSsh(
                forwardCommandArgs({
                  base,
                  host,
                  verb: "cancel",
                  localPort,
                  remotePort,
                }),
                `cancelling the forward to ${host}:${remotePort}`,
              );
            }
          } finally {
            releaseAnchor(host, anchor);
          }
        },
      };
    },
  };
}

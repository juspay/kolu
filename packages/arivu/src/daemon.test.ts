/**
 * arivu's integration proof — the single biggest unknown P1c retires: do the
 * awareness sensors run correctly as a SEPARATE, kaval-dialing process, with no
 * in-process handle? This wires the real thing end to end in one process but
 * over real unix sockets: an in-process kaval served over a socket, a real
 * shell spawned in a real git repo, the arivu daemon dialing that kaval and
 * serving its `awareness` surface, and a surface client mirroring the result.
 *
 * The load-bearing assertion is `git.branch`: it can only be right if arivu
 * dialed kaval, seeded the record from the spawn cwd, ran the git sensor in its
 * own process, and published the slice into the served collection — the whole
 * spine. Then a kill must reconcile the terminal back out of the collection.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  arivuSurface,
  AwarenessValue,
  TerminalId,
} from "@kolu/arivu-contract";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import {
  createInProcessPtyHost,
  type PtyHostSpawnInput,
  servePtyHostOverUnixSocket,
} from "kaval";
import pino from "pino";
import { afterEach, expect, it } from "vitest";
import { runArivuDaemon } from "./daemon.ts";

type AwarenessClient = UnixSocketConnection<
  typeof arivuSurface.contract
>["client"];

// A no-op surface-daemon Logger for the in-process pty-host, and a silent pino
// for arivu (the sensors call `log.child`, so it must be a real pino).
const hostLog = { debug() {}, info() {}, warn() {}, error() {} };
const arivuLog = pino({ level: "silent" });

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) {
    try {
      await c();
    } catch {
      // best-effort teardown
    }
  }
});

async function firstValue<T>(stream: AsyncIterable<T>): Promise<T | undefined> {
  for await (const v of stream) return v;
  return undefined;
}

/** A one-shot snapshot of arivu's awareness collection (keys + first value each).
 *  Reading the `keys` first frame is bounded (it always yields the current set),
 *  and each present key's `get` yields its current value, so this never hangs. */
async function snapshot(
  client: AwarenessClient,
): Promise<Map<TerminalId, AwarenessValue>> {
  const abort = new AbortController();
  const out = new Map<TerminalId, AwarenessValue>();
  try {
    const keys =
      (await firstValue(await client.surface.awareness.keys({}))) ?? [];
    for (const key of keys) {
      // A live, reconciling collection: a key listed by `keys()` can be removed
      // (its terminal reconciled out) before its `get()` resolves, surfacing as
      // an oRPC stream error ("key not found at first snapshot"). Suppress ONLY
      // that vanished-key race — confirmed by re-reading `keys()` — so a real
      // `get` failure on a still-present key surfaces instead of silently
      // dropping the key (which would let the reconciliation assertion below
      // pass for the wrong reason). The message isn't reliable across the wire,
      // so we re-check membership rather than match on it.
      try {
        const v = await firstValue(
          await client.surface.awareness.get({ key }, { signal: abort.signal }),
        );
        if (v) out.set(key, v);
      } catch (e) {
        const stillListed =
          (await firstValue(await client.surface.awareness.keys({})))?.includes(
            key,
          ) ?? false;
        if (stillListed) throw e; // a real failure on a present key
        // else: key vanished between keys() and get() — omit it
      }
    }
  } finally {
    abort.abort();
  }
  return out;
}

async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  ms = 10000,
): Promise<T> {
  const deadline = Date.now() + ms;
  let lastErr: unknown;
  for (;;) {
    try {
      const r = await fn();
      if (r !== undefined) return r;
    } catch (e) {
      // Transient while the live collection settles (e.g. an oRPC stream error
      // as a sensor starts up or a key reconciles out mid-read) — retry until
      // the deadline rather than failing the test on a benign race.
      lastErr = e;
    }
    if (Date.now() >= deadline)
      throw new Error(
        `condition not met in time${lastErr ? `: ${String(lastErr)}` : ""}`,
      );
    await sleep(75);
  }
}

it("dials a kaval, runs the sensors for a real terminal, serves correct awareness, and reconciles on exit", async () => {
  // ── a kaval (in-process pty-host) served over a real unix socket ──
  const ptyHost = createInProcessPtyHost({
    log: hostLog,
    rcDir: tmp("arivu-it-rc-"),
  });
  const kavalSocket = join(tmp("arivu-it-kaval-"), "pty-host.sock");
  const listener = await servePtyHostOverUnixSocket({
    socketPath: kavalSocket,
    router: ptyHost.servedRouter,
    log: hostLog,
  });
  cleanups.push(() => listener.close());

  // ── a real git repo + a shell spawned in it ──────────────────────
  const repo = tmp("arivu-it-repo-");
  const BRANCH = "feat/arivu-it";
  execFileSync("git", ["init", "-q", "-b", BRANCH, repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "it@arivu.test"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "arivu it"]);
  execFileSync("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "x"]);

  const info = await ptyHost.client.surface.system.info({});
  const spawnInput: PtyHostSpawnInput = {
    argv: [info.shell],
    cwd: repo,
    env: { PATH: process.env.PATH ?? "", HOME: info.home },
    initFiles: [],
  };
  const { id } = await ptyHost.client.surface.terminal.spawn(spawnInput);
  const terminalId = id as TerminalId;
  cleanups.push(async () => {
    await ptyHost.client.surface.terminal.kill({ id });
  });

  // ── arivu, dialing that kaval, serving on its own socket ─────────
  const abort = new AbortController();
  const arivuSocket = join(tmp("arivu-it-arivu-"), "awareness.sock");
  const ready = new Promise<void>((resolve) => {
    void runArivuDaemon({
      kavalSocket,
      serve: { kind: "socket", socketPath: arivuSocket },
      log: arivuLog,
      signal: abort.signal,
      onReady: () => resolve(),
      pollIntervalMs: 100,
    });
  });
  cleanups.push(() => abort.abort());
  await ready;

  // ── a surface client mirrors arivu's awareness ───────────────────
  const conn = await unixSocketLink<typeof arivuSurface.contract>({
    socketPath: arivuSocket,
  });
  cleanups.push(() => conn.dispose());

  // The terminal appears AND the git sensor resolved its branch from the
  // spawn cwd — the whole spine, in a separate kaval-dialing process.
  const value = await waitFor(async () => {
    const v = (await snapshot(conn.client)).get(terminalId);
    return v && v.git?.branch === BRANCH ? v : undefined;
  });
  expect(value.cwd).toBe(repo);
  expect(value.git?.branch).toBe(BRANCH);
  // The PR field is present (pending or, lacking an origin remote, resolved as
  // absent/unavailable) — we only assert it exists, not gh's verdict.
  expect(value.pr.kind).toBeTruthy();

  // ── kill the terminal → arivu reconciles it out of the collection ─
  await ptyHost.client.surface.terminal.kill({ id });
  await waitFor(async () =>
    (await snapshot(conn.client)).has(terminalId) ? undefined : true,
  );
  expect((await snapshot(conn.client)).has(terminalId)).toBe(false);
}, 30000);

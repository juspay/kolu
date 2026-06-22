/**
 * pulam's integration proof — the single biggest unknown P1c retires: do the
 * awareness sensors run correctly as a SEPARATE, kaval-dialing process, with no
 * in-process handle? This wires the real thing end to end in one process but
 * over real unix sockets: an in-process kaval served over a socket, a real
 * shell spawned in a real git repo, the pulam daemon dialing that kaval and
 * serving its `awareness` surface, and a surface client mirroring the result.
 *
 * The load-bearing assertion is `git.branch`: it can only be right if pulam
 * dialed kaval, seeded the record from the spawn cwd, ran the git sensor in its
 * own process, and published the slice into the served collection — the whole
 * spine. Then a kill must reconcile the terminal back out of the collection.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  terminalWorkspaceSurface,
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
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
  typeof terminalWorkspaceSurface.contract
>["client"];

// A no-op surface-daemon Logger for the in-process pty-host, and a silent pino
// for pulam (the sensors call `log.child`, so it must be a real pino).
const hostLog = { debug() {}, info() {}, warn() {}, error() {} };
const pulamLog = pino({ level: "silent" });

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

/** The `keys()` first frame errored while the surface was still coming up (a
 *  sensor starting up). Semantically "collection not ready yet" — a transient
 *  that `waitFor` retries — but it carries the underlying cause so a PERSISTENT
 *  startup failure surfaces in the deadline message instead of a bare timeout
 *  (honoring `caught-error-must-not-collapse-to-empty`: the failure stays
 *  distinguishable from a legitimately empty collection). */
class SurfaceNotReadyError extends Error {
  constructor(cause: unknown) {
    super("awareness surface not ready (keys() first frame errored)", {
      cause,
    });
    this.name = "SurfaceNotReadyError";
  }
}

/** A one-shot snapshot of pulam's awareness collection (keys + first value each).
 *  Reading the `keys` first frame is bounded (it always yields the current set),
 *  and each present key's `get` yields its current value, so this never hangs. */
async function snapshot(
  client: AwarenessClient,
): Promise<Map<TerminalId, AwarenessValue>> {
  const abort = new AbortController();
  const out = new Map<TerminalId, AwarenessValue>();
  try {
    // `snapshot` is the SINGLE place that understands the live, reconciling
    // collection, so it owns the entire transient/real distinction — `waitFor`
    // below stays a pure condition-poller that retries ONLY the one tagged
    // transient (`SurfaceNotReadyError`) and lets every other exception
    // propagate immediately with its stack (a blanket catch there would bury
    // the surgical present-key rethrow at the end of this function, plus
    // TypeErrors/assertion bugs, as timeout-shaped failures with no stack).
    // Two transient sources, two narrow suppressions:
    //
    //   1. The `keys()` first frame can error while the surface is still coming
    //      up (a sensor starting up) — that's "collection not ready yet", which
    //      is indistinguishable from (and semantically) an empty key set. Tag
    //      it as `SurfaceNotReadyError` so `waitFor` retries (callers poll until
    //      the expected key appears); if it never clears, the deadline message
    //      carries the original cause rather than a bare timeout.
    let keys: readonly TerminalId[];
    try {
      keys = (await firstValue(await client.surface.awareness.keys({}))) ?? [];
    } catch (e) {
      throw new SurfaceNotReadyError(e); // surface not ready — no keys yet
    }
    for (const key of keys) {
      //   2. A key listed by `keys()` can be removed (its terminal reconciled
      //      out) before its `get()` resolves, surfacing as an oRPC stream error
      //      ("key not found at first snapshot"). Suppress ONLY that vanished-key
      //      race — confirmed by re-reading `keys()` — so a real `get` failure on
      //      a still-present key surfaces (rethrown below) instead of silently
      //      dropping the key (which would let the reconciliation assertion pass
      //      for the wrong reason). The message isn't reliable across the wire,
      //      so we re-check membership rather than match on it.
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

/** Poll `fn` until it returns a defined value or the deadline passes. Retries on
 *  an `undefined` ("not yet") result OR a tagged `SurfaceNotReadyError` (the one
 *  startup transient `snapshot` raises) — and lets EVERY other exception (a real
 *  present-key `get` failure, a TypeError, an assertion bug) propagate
 *  immediately with its stack intact rather than swallow it into a timeout. The
 *  last `SurfaceNotReadyError` is stashed so a startup error that never clears
 *  surfaces its cause in the deadline message instead of a bare timeout. */
async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  ms = 10000,
): Promise<T> {
  const deadline = Date.now() + ms;
  let lastNotReady: SurfaceNotReadyError | undefined;
  for (;;) {
    try {
      const r = await fn();
      if (r !== undefined) return r;
    } catch (e) {
      if (!(e instanceof SurfaceNotReadyError)) throw e;
      lastNotReady = e;
    }
    if (Date.now() >= deadline) {
      throw new Error("condition not met in time", {
        cause: lastNotReady?.cause,
      });
    }
    await sleep(75);
  }
}

it("dials a kaval, runs the sensors for a real terminal, serves correct awareness, and reconciles on exit", async () => {
  // ── a kaval (in-process pty-host) served over a real unix socket ──
  const ptyHost = createInProcessPtyHost({
    log: hostLog,
    rcDir: tmp("pulam-it-rc-"),
  });
  const kavalSocket = join(tmp("pulam-it-kaval-"), "pty-host.sock");
  const listener = await servePtyHostOverUnixSocket({
    socketPath: kavalSocket,
    router: ptyHost.servedRouter,
    log: hostLog,
  });
  cleanups.push(() => listener.close());

  // ── a real git repo + a shell spawned in it ──────────────────────
  const repo = tmp("pulam-it-repo-");
  const BRANCH = "feat/pulam-it";
  execFileSync("git", ["init", "-q", "-b", BRANCH, repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "it@pulam.test"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "pulam it"]);
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

  // ── pulam, dialing that kaval, serving on its own socket ─────────
  const abort = new AbortController();
  const pulamSocket = join(tmp("pulam-it-pulam-"), "awareness.sock");
  const ready = new Promise<void>((resolve) => {
    void runArivuDaemon({
      kavalSocket,
      serve: { kind: "socket", socketPath: pulamSocket },
      log: pulamLog,
      signal: abort.signal,
      onReady: () => resolve(),
      pollIntervalMs: 100,
    });
  });
  cleanups.push(() => abort.abort());
  await ready;

  // ── a surface client mirrors pulam's awareness ───────────────────
  const conn = await unixSocketLink<typeof terminalWorkspaceSurface.contract>({
    socketPath: pulamSocket,
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

  // ── R6: pulam serves the workspace fs/git too, over the SAME socket ──
  // The second home of @kolu/terminal-workspace: the Code tab's fs/git reads
  // (and R8's remote kolu) are answered by pulam, not just awareness.
  writeFileSync(join(repo, "note.txt"), "hi\n");
  const listed = await conn.client.surface.fs.listAll({ repoPath: repo });
  expect(listed.paths).toContain("note.txt");
  const status = await conn.client.surface.git.getStatus({
    repoPath: repo,
    mode: "local",
  });
  expect(Array.isArray(status.files)).toBe(true);
  // R4.7: local-mode getStatus also carries the branch tracking header and the
  // working-tree section counts (computed off the same `git status`), proven
  // over the real served link rather than only in kolu-git's unit tests.
  expect(status.branch?.name).toBe(BRANCH);
  expect(status.workingTree?.untracked ?? 0).toBeGreaterThanOrEqual(1); // note.txt

  // ── R4.7: a working-tree change PULSES subscribeRepoChange, and re-querying
  //    getStatus reflects it — the {seq}+requery loop the fleet board's
  //    git-status view runs, exercised end to end over a real link (the gate for
  //    kolu's remote Code tab, which had no standalone proof before this). ─────
  const pulses = await conn.client.surface.subscribeRepoChange.get({
    repoPath: repo,
  });
  const iter = pulses[Symbol.asyncIterator]();
  expect((await iter.next()).value).toEqual({ seq: 0 }); // the snapshot pulse
  await sleep(100); // let the working-tree watcher arm before the change
  writeFileSync(join(repo, "fresh.txt"), "new\n");
  const pulsed = await iter.next(); // a real fs change → the next {seq} pulse
  expect(pulsed.done).toBe(false);
  const after = await conn.client.surface.git.getStatus({
    repoPath: repo,
    mode: "local",
  });
  expect(after.files.some((f) => f.path === "fresh.txt")).toBe(true);
  expect(after.workingTree?.untracked ?? 0).toBeGreaterThanOrEqual(2); // +fresh.txt
  await iter.return?.(); // close the subscription before the kill below

  // ── kill the terminal → pulam reconciles it out of the collection ─
  await ptyHost.client.surface.terminal.kill({ id });
  await waitFor(async () =>
    (await snapshot(conn.client)).has(terminalId) ? undefined : true,
  );
  expect((await snapshot(conn.client)).has(terminalId)).toBe(false);
}, 30000);

/**
 * kolu-watcher server — hermetic in-process composition test.
 *
 * The strongest proof of the P3 serve+front design that does NOT need a live
 * host: a FAKE in-process kaval (a stubbed `ptyHostSurface`, no real PTY), the
 * real `buildWatcherServer` over it, and a `directLink` client to the watcher.
 * It proves, with no ssh and no nix and no spawned shell:
 *   - the absorbed pty verbs FORWARD to the kaval sub-client (spawn returns
 *     kaval's pid),
 *   - spawning starts the host-side provider DAG, which publishes into the
 *     served `terminalMetadata` collection (the mirror source),
 *   - the absorbed pty taps FORWARD snapshot-first (terminalAttach),
 *   - fs/git are served from the real filesystem (a tmp git repo).
 *
 * Only git CLI one-shots + an in-process file watcher run — no daemon, no ssh.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directLink } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryChannelByName } from "@kolu/surface/server";
import {
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostDataMsg,
  ptyHostSurface,
} from "kaval";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { buildWatcherServer, type WatcherServer } from "./server.ts";
import { watcherSurface } from "./watcherSurface.ts";

const silentLog = pino({ level: "silent" });

/** A stream that stays open until aborted, yielding nothing — the idle shape
 *  for taps with no events in this test. */
async function* idle(
  _input: unknown,
  signal: AbortSignal | undefined,
): AsyncGenerator<never> {
  if (!signal) return;
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

/** A fake in-process kaval — the `ptyHostSurface` stubbed with canned
 *  responses, no node-pty. `terminalAttach` yields one snapshot frame so the
 *  forward-snapshot-first assertion has something to read. */
function makeFakeKaval() {
  const fragment = implementSurface(ptyHostSurface, {
    channel: inMemoryChannelByName(),
    streams: {
      terminalAttach: {
        source: async function* (
          _input,
          signal,
        ): AsyncGenerator<PtyHostDataMsg> {
          yield { kind: "snapshot", data: "screen-snapshot" };
          yield* idle(_input, signal);
        },
      },
      cwd: { source: idle },
      title: { source: idle },
      commandRun: { source: idle },
      foreground: { source: idle },
      exit: { source: idle },
    },
    procedures: {
      terminal: {
        spawn: ({ input }) => ({
          id: input.id ?? "fake-terminal",
          pid: 4242,
          cwd: input.cwd,
        }),
        kill: () => ({ ok: true }),
        killAll: () => ({ killed: 0 }),
        write: () => ({ ok: true }),
        resize: () => ({ ok: true }),
        list: () => ({ entries: [] }),
        getScreenState: () => ({ data: "" }),
        getScreenText: () => ({ text: "" }),
      },
      system: {
        version: () => ({
          contractVersion: PTY_HOST_CONTRACT_VERSION,
          pid: 1,
          startedAt: 0,
        }),
        heartbeat: () => ({ ts: 0 }),
        info: () => ({
          shell: "/bin/sh",
          home: "/tmp",
          platform: "linux",
          rcDir: "/tmp",
        }),
      },
    },
  });
  const client = directLink<typeof ptyHostSurface.contract>(fragment.router);
  return { client, dispose: () => {} };
}

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "kolu-watcher-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# test\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"],
    { cwd: dir },
  );
  return dir;
}

async function firstFrame<T>(
  stream: AsyncIterable<T> | PromiseLike<AsyncIterable<T>>,
): Promise<T> {
  for await (const value of await stream) return value;
  throw new Error("stream ended with no frames");
}

const tmpDirs: string[] = [];
let server: WatcherServer | undefined;
afterEach(() => {
  server?.dispose();
  server = undefined;
  for (const d of tmpDirs.splice(0))
    rmSync(d, { recursive: true, force: true });
});

describe("buildWatcherServer — serve + forward composition", () => {
  it("forwards spawn to kaval, starts the DAG, and mirrors terminalMetadata", async () => {
    const repo = makeGitRepo();
    tmpDirs.push(repo);
    server = buildWatcherServer({ kaval: makeFakeKaval(), log: silentLog });
    const client = directLink<typeof watcherSurface.contract>(server.router);

    const res = await client.surface.terminal.spawn({
      argv: ["/bin/sh"],
      cwd: repo,
      env: {},
      initFiles: [],
    });
    // Forwarded to the (fake) kaval, which returns its pid.
    expect(res.pid).toBe(4242);
    expect(res.cwd).toBe(repo);

    // The spawn started the host-side DAG, which published the new terminal
    // into the served terminalMetadata collection (the mirror source).
    const keys = await firstFrame(client.surface.terminalMetadata.keys());
    expect(keys).toContain(res.id);
  });

  it("forwards the terminalAttach tap snapshot-first", async () => {
    server = buildWatcherServer({ kaval: makeFakeKaval(), log: silentLog });
    const client = directLink<typeof watcherSurface.contract>(server.router);
    const { id } = await client.surface.terminal.spawn({
      argv: ["/bin/sh"],
      cwd: tmpdir(),
      env: {},
      initFiles: [],
    });
    const frame = await firstFrame(client.surface.terminalAttach.get({ id }));
    // kaval's snapshot frame, forwarded through the watcher untouched.
    expect(frame).toEqual({ kind: "snapshot", data: "screen-snapshot" });
  });

  it("serves git status + fs listing from the real host filesystem", async () => {
    const repo = makeGitRepo();
    tmpDirs.push(repo);
    server = buildWatcherServer({ kaval: makeFakeKaval(), log: silentLog });
    const client = directLink<typeof watcherSurface.contract>(server.router);

    const status = await client.surface.git.getStatus({
      repoPath: repo,
      mode: "local",
    });
    expect(Array.isArray(status.files)).toBe(true);

    const listing = await client.surface.fs.listAll({ repoPath: repo });
    expect(listing.paths).toContain("README.md");
  });

  it("rejects fs/git on a non-repo with a typed error (kolu-git wiring)", async () => {
    const plain = mkdtempSync(join(tmpdir(), "kolu-watcher-plain-"));
    tmpDirs.push(plain);
    server = buildWatcherServer({ kaval: makeFakeKaval(), log: silentLog });
    const client = directLink<typeof watcherSurface.contract>(server.router);
    await expect(
      client.surface.git.getStatus({ repoPath: plain, mode: "local" }),
    ).rejects.toThrow();
  });
});

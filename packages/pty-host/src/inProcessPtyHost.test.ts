/**
 * Contract-level lifecycle coverage for the in-process serving — exercises
 * `ptyHostSurface` end-to-end through `createInProcessPtyHostClient` (the identity
 * link) over a real PTY. Two layers: serving glue that needs no child (version
 * handshake, the NOT_FOUND existence guard) and a real shell driven through
 * the contract (spawn → list → snapshot-first attach → exit-on-kill), plus the
 * abort/kill-silence mechanism the consumer relies on.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "kolu-shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInProcessPtyHostClient,
  type PtyHostClient,
} from "./inProcessPtyHost.ts";
import { PTY_HOST_CONTRACT_VERSION } from "./ptyHostSurface.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as Logger;

function makeClient(): PtyHostClient {
  return createInProcessPtyHostClient({
    log: silentLog,
    shellDir: mkdtempSync(join(tmpdir(), "kolu-pty-shell-")),
    version: "test",
  });
}

describe("createInProcessPtyHostClient — contract serving (no child)", () => {
  let client: PtyHostClient;
  beforeAll(() => {
    client = makeClient();
  });

  it("serves a self-compatible version handshake with a build identity", async () => {
    const v = await client.surface.system.version({});
    expect(v.contractVersion).toBe(PTY_HOST_CONTRACT_VERSION);
    expect(v.pid).toBe(process.pid);
    expect(typeof v.startedAt).toBe("number");
    // A2: the optional identity is always populated in-process — two strings
    // (empty off-nix, where KOLU_PTY_HOST_BUILD_ID / KOLU_COMMIT_HASH aren't
    // baked). Phase B compares staleKey against the server's expected build.
    expect(typeof v.identity?.staleKey).toBe("string");
    expect(typeof v.identity?.navigableCommit).toBe("string");
  });

  it("heartbeat returns a timestamp", async () => {
    const { ts } = await client.surface.system.heartbeat({});
    expect(typeof ts).toBe("number");
  });

  it("lists no terminals before any spawn", async () => {
    const { entries } = await client.surface.terminal.list({});
    expect(entries).toEqual([]);
  });

  it("getScreenState on an unknown PTY rejects rather than returning a blank string", async () => {
    // The existence check is `host.has(id)`, not `getCwd(id)` truthiness — and
    // a missing PTY must surface as an error, not masquerade as an empty
    // (legitimately blank) screen.
    await expect(
      client.surface.terminal.getScreenState({
        id: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow();
  });
});

describe("createInProcessPtyHostClient — real PTY lifecycle through the contract", () => {
  let client: PtyHostClient;
  beforeAll(() => {
    client = makeClient();
  });
  afterAll(async () => {
    await client.surface.terminal.killAll({});
  });

  it("spawns a real shell, lists it, attaches snapshot-first, and yields an exit code when the PTY dies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-inproc-"));
    const { id, pid, cwd } = await client.surface.terminal.spawn({ cwd: dir });
    expect(pid).toBeGreaterThan(0);
    expect(cwd).toBe(dir);

    // The spawned PTY shows up in list with its resolved id + pid.
    const { entries } = await client.surface.terminal.list({});
    expect(entries.some((e) => e.id === id && e.pid === pid)).toBe(true);

    // attach is race-free snapshot-then-deltas: the first frame is the snapshot.
    const first = await (await client.surface.terminalAttach.get({ id }))
      [Symbol.asyncIterator]()
      .next();
    expect(first.done).toBe(false);
    if (!first.done) expect(first.value.kind).toBe("snapshot");

    // Subscribe to the exit tap, then kill: the tap yields the exit code once.
    const exitNext = (await client.surface.exit.get({ id }))
      [Symbol.asyncIterator]()
      .next();
    await client.surface.terminal.kill({ id });
    const exit = await exitNext;
    expect(exit.done).toBe(false);
    if (!exit.done) expect(typeof exit.value.exitCode).toBe("number");
  });

  it("an aborted exit subscription stops without delivering the exit (the kill-silence mechanism)", async () => {
    // The mechanism `local.ts` relies on to keep an intentional kill silent:
    // `teardownProviders` aborts the exit-tap signal BEFORE the kill, so the
    // tap ends via abort rather than yielding an exit code that would become a
    // `terminalExit`. Verify the contract honors that abort.
    const dir = mkdtempSync(join(tmpdir(), "kolu-inproc-"));
    const { id } = await client.surface.terminal.spawn({ cwd: dir });
    const ac = new AbortController();
    const it = (await client.surface.exit.get({ id }, { signal: ac.signal }))[
      Symbol.asyncIterator
    ]();
    const next = it.next();
    ac.abort();
    let deliveredExit = false;
    try {
      const r = await next;
      if (!r.done) deliveredExit = true; // yielded despite the abort
    } catch {
      // abort surfaced as a throw — also "stopped without delivering"
    }
    expect(deliveredExit).toBe(false);
    await client.surface.terminal.kill({ id });
  });
});

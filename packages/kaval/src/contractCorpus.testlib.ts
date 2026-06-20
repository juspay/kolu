/**
 * The pty-host contract corpus — a reusable suite that exercises EVERY
 * procedure and stream of `ptyHostSurface` against a `PtyHostClient`, whatever
 * link backs it. B1 instantiates it twice: over the in-process identity link
 * (`inProcessPtyHost.test.ts`, the fast path) and over a REAL spawned `kaval`
 * daemon's unix socket (`socketDaemon.test.ts`). One corpus, two links — so the
 * daemon can never drift from in-process behaviour unnoticed.
 *
 * This is a `.testlib.ts`, NOT a `.test.ts`: vitest's `include` is
 * `*.test.ts`, so this file is never run as a standalone suite (it has no
 * top-level `describe`), and default.nix's staleKey fileFilter excludes
 * `.testlib.ts` so a shared test helper does not land in the daemon's hashed
 * closure (which would fail `buildId.closure.test.ts`'s reachable==hashed
 * assertion — the lesson paid for in B0's review).
 *
 * `CONTRACT_COVERAGE` is the manifest of what this corpus touches; the
 * `coverage.test.ts` ledger asserts it equals `ptyHostSurface`'s actual key set,
 * so adding a procedure or stream without covering it fails CI — "full
 * coverage" is mechanical, not aspirational.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PtyHostClient } from "./inProcessPtyHost.ts";
import {
  DEFAULT_SPAWN_SHELL,
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostSpawnInput,
} from "./ptyHostSurface.ts";
import { nextFrame } from "./streamFrame.testlib.ts";

/** Every contract entry the corpus exercises. Asserted against the live surface
 *  by `coverage.test.ts` — keep it in lockstep with the `it`s below AND with
 *  `ptyHostSurface`. */
export const CONTRACT_COVERAGE = {
  procedures: [
    "terminal.spawn",
    "terminal.kill",
    "terminal.killAll",
    "terminal.write",
    "terminal.resize",
    "terminal.list",
    "terminal.getScreenState",
    "terminal.getScreenText",
    "system.version",
    "system.heartbeat",
    "system.info",
  ],
  streams: [
    "terminalAttach",
    "cwd",
    "title",
    "commandRun",
    "foreground",
    "exit",
    "inventory",
  ],
} as const;

/** A minimal fully-specified spawn — a plain `$SHELL` run with no login flag,
 *  no rc files. Since B0
 *  the host derives nothing from policy, so a bare client supplies the complete
 *  `{argv, env, initFiles}` (and this exercises exactly that no-hooks path). The
 *  env crosses the wire verbatim on the socket link. */
export function spawnInput(cwd: string): PtyHostSpawnInput {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v != null) env[k] = v;
  return {
    argv: [process.env.SHELL || DEFAULT_SPAWN_SHELL],
    cwd,
    env,
    initFiles: [],
  };
}

/** A client plus the teardown that releases whatever backs it (the socket
 *  connection, and — for the daemon — the daemon process). */
export interface CorpusHost {
  client: PtyHostClient;
  /** An INDEPENDENT client over the same host, for negative-path tests that can
   *  tear down a multiplexed transport (a stream that errors at its source can
   *  close the whole stdio connection over the socket). Provided by the socket
   *  host so such a test never poisons the shared connection; omitted by the
   *  identity link, where each call is independent and the shared client is
   *  safe. */
  isolated?: () => Promise<{
    client: PtyHostClient;
    dispose: () => Promise<void> | void;
  }>;
  dispose: () => Promise<void> | void;
}

/** Resolve a stream's first yielded value, or reject on timeout — so a stream
 *  that never fires fails loudly instead of hanging the suite. ALWAYS closes the
 *  iterator before returning: over the socket link a left-open subscription
 *  rejects with `AbortError` when the connection later disposes, surfacing as an
 *  unhandled rejection that fails the whole file. `return()` ends the
 *  subscription cleanly at the point we stop caring about it. */
async function firstYield<T>(stream: AsyncIterable<T>, ms = 5000): Promise<T> {
  const iterator = stream[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("stream timed out")), ms);
  });
  try {
    const result = await Promise.race([iterator.next(), timeout]);
    if (result.done) throw new Error("stream ended without yielding");
    return result.value;
  } finally {
    if (timer) clearTimeout(timer);
    // Close the subscription, fire-and-forget. Over the socket a left-open pull
    // rejects with `AbortError` when the connection later disposes (an
    // unhandled rejection that fails the file); `return()` ends it. NOT awaited:
    // on the in-process identity link `return()` on a generator suspended in an
    // upstream `for await` settles late, and awaiting it here would stall the
    // next subscription. Swallow — `return()` on an already-errored stream can
    // reject.
    void Promise.resolve(iterator.return?.()).catch(() => {});
  }
}

/** Pull frames until `match` is satisfied, discarding the rest — the corpus runs
 *  on a SHARED host, so unrelated created/exited deltas from a neighbouring test
 *  may interleave on the host-global inventory feed. */
async function frameUntil<T>(
  it: AsyncIterator<T>,
  match: (v: T) => boolean,
  ms = 8000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await nextFrame(it, Math.max(0, deadline - Date.now()));
    if (match(v)) return v;
  }
}

/** The corpus. `makeHost` is awaited once per run; `dispose` is called after.
 *  Drives every procedure and stream in `CONTRACT_COVERAGE`. */
export function runContractCorpus(opts: {
  label: string;
  makeHost: () => Promise<CorpusHost>;
  makeCwd: () => string;
}): void {
  describe(`pty-host contract corpus — ${opts.label}`, () => {
    let host: CorpusHost;
    const client = (): PtyHostClient => host.client;

    /** Run `body` against an isolated client when the host provides one (the
     *  socket), else the shared client (identity). Always disposes the isolated
     *  one — so a transport-closing negative path never poisons the corpus's
     *  shared connection. */
    const withIsolated = async (
      body: (c: PtyHostClient) => Promise<void>,
    ): Promise<void> => {
      if (!host.isolated) return body(client());
      const probe = await host.isolated();
      try {
        await body(probe.client);
      } finally {
        await probe.dispose();
      }
    };

    beforeAll(async () => {
      host = await opts.makeHost();
    });
    afterAll(async () => {
      try {
        await client().surface.terminal.killAll({});
      } catch {
        // The connection may already be torn down by a prior failure — the
        // dispose below still runs.
      } finally {
        await host.dispose();
      }
    });

    it("system.version: a self-compatible handshake with a build identity", async () => {
      const v = await client().surface.system.version({});
      expect(v.contractVersion).toBe(PTY_HOST_CONTRACT_VERSION);
      expect(typeof v.pid).toBe("number");
      expect(typeof v.startedAt).toBe("number");
      // The optional identity is always populated by the in-process serving —
      // two strings (empty off-nix, where KAVAL_BUILD_ID / KAVAL_COMMIT_HASH
      // aren't baked).
      expect(typeof v.identity?.staleKey).toBe("string");
      expect(typeof v.identity?.navigableCommit).toBe("string");
    });

    it("system.heartbeat: returns a timestamp", async () => {
      const { ts } = await client().surface.system.heartbeat({});
      expect(typeof ts).toBe("number");
    });

    it("system.info: host facts a client composes spawn policy against", async () => {
      const info = await client().surface.system.info({});
      expect(info.shell.length).toBeGreaterThan(0);
      expect(typeof info.home).toBe("string");
      expect(info.platform).toBe(process.platform);
      expect(info.rcDir.startsWith("/")).toBe(true);
    });

    it("terminal.list: empty before any spawn (a fresh host)", async () => {
      const { entries } = await client().surface.terminal.list({});
      expect(Array.isArray(entries)).toBe(true);
    });

    it("terminalAttach on an unknown PTY rejects rather than yielding an empty stream", async () => {
      // A stream that errors at its source closes the multiplexed stdio
      // transport over the socket, so this runs on an ISOLATED connection (it
      // would otherwise poison the corpus's shared one). The reject CODE is
      // link-dependent — the identity link surfaces the server's structured
      // NOT_FOUND, the socket may surface either NOT_FOUND or a transport-closed
      // error depending on which frame wins the race — so the corpus asserts
      // only "it rejects"; the precise NOT_FOUND shape `local.ts` reads is
      // pinned deterministically on the identity link in `inProcessPtyHost.test.ts`.
      await withIsolated(async (c) => {
        const drain = async (): Promise<void> => {
          for await (const _ of await c.surface.terminalAttach.get({
            id: "00000000-0000-0000-0000-000000000000",
          })) {
            // unreachable — the first pull rejects
          }
        };
        await expect(drain()).rejects.toThrow();
      });
    });

    it("getScreenState on an unknown PTY rejects NOT_FOUND (not a blank string)", async () => {
      // A procedure carries its error as a response frame (no transport close),
      // so NOT_FOUND is deterministic over both links — but run it isolated too,
      // for symmetry and to keep the shared connection pristine.
      await withIsolated(async (c) => {
        await expect(
          c.surface.terminal.getScreenState({
            id: "00000000-0000-0000-0000-000000000000",
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });

    it("spawn → list → attach (snapshot-first) → write → getScreenText/getScreenState → resize → kill → exit", {
      timeout: 20000,
    }, async () => {
      const dir = opts.makeCwd();
      const { id, pid, cwd } = await client().surface.terminal.spawn(
        spawnInput(dir),
      );
      expect(pid).toBeGreaterThan(0);
      expect(cwd).toBe(dir);

      // list shows it with the resolved id + pid.
      const { entries } = await client().surface.terminal.list({});
      expect(entries.some((e) => e.id === id && e.pid === pid)).toBe(true);

      // attach is snapshot-then-deltas: the first frame is the snapshot.
      const attach = await client().surface.terminalAttach.get({ id });
      const first = await firstYield(attach);
      expect(first.kind).toBe("snapshot");

      // write a marker, then read it back through the rendered buffer.
      await client().surface.terminal.write({
        id,
        data: "printf 'CORPUS-MARK-%s\\n' 7\n",
      });
      let text = "";
      for (let i = 0; i < 60; i++) {
        ({ text } = await client().surface.terminal.getScreenText({ id }));
        if (text.includes("CORPUS-MARK-7")) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(text).toContain("CORPUS-MARK-7");

      // getScreenState returns the serialized screen (a non-empty string here).
      const { data } = await client().surface.terminal.getScreenState({ id });
      expect(typeof data).toBe("string");

      // resize is accepted.
      const resized = await client().surface.terminal.resize({
        id,
        cols: 100,
        rows: 40,
      });
      expect(resized.ok).toBe(true);

      // exit tap yields once on kill.
      const exitStream = await client().surface.exit.get({ id });
      const exitP = firstYield(exitStream, 8000);
      const killed = await client().surface.terminal.kill({ id });
      expect(killed.ok).toBe(true);
      const exit = await exitP;
      expect(typeof exit.exitCode).toBe("number");
    });

    it("streams: cwd (OSC 7) and commandRun (OSC 633) yield on raw drives", {
      timeout: 20000,
    }, async () => {
      // Drive the OSC sequences DIRECTLY over `write` rather than via shell rc
      // hooks — a bare corpus shell has none (those are kolu's client-side
      // policy), so this exercises the host's own VT parsing of the taps.
      const { id } = await client().surface.terminal.spawn(
        spawnInput(opts.makeCwd()),
      );

      const cwdStream = await client().surface.cwd.get({ id });
      const cwdP = firstYield(cwdStream);
      await client().surface.terminal.write({
        id,
        data: "printf '\\033]7;file://host/tmp/corpus-cwd\\033\\\\'\n",
      });
      expect((await cwdP).cwd).toContain("/tmp/corpus-cwd");

      const cmdStream = await client().surface.commandRun.get({ id });
      const cmdP = firstYield(cmdStream);
      // OSC 633 ; E ; <command-line> ST — the preexec mark kolu's hook emits.
      await client().surface.terminal.write({
        id,
        data: "printf '\\033]633;E;corpus-command\\033\\\\'\n",
      });
      expect((await cmdP).command).toContain("corpus-command");

      await client().surface.terminal.kill({ id });
    });

    it("streams: title (OSC 2) and foreground reach the title tap + list", {
      timeout: 20000,
    }, async () => {
      const { id } = await client().surface.terminal.spawn(
        spawnInput(opts.makeCwd()),
      );

      // foreground tap yields a snapshot first (the host pushes current state).
      const fgStream = await client().surface.foreground.get({ id });
      const fg = await firstYield(fgStream);
      expect(typeof fg.process).toBe("string");

      // The title stream yields on the OSC 2 escape directly. Subscribe FIRST,
      // then drive the title at an idle prompt (no trailing `sleep` — a busy
      // foreground wouldn't process the stdin write until it returned).
      const titleStream = await client().surface.title.get({ id });
      const titleP = firstYield(titleStream);
      await client().surface.terminal.write({
        id,
        data: "printf '\\033]2;corpus-title\\033\\\\'\n",
      });
      expect((await titleP).title).toContain("corpus-title");

      // For the LIST projection, drive a title under a long-lived foreground
      // command so it isn't clobbered by the prompt redraw before we read it —
      // and so `foregroundProcess` reflects a known running process.
      await client().surface.terminal.write({
        id,
        data: "printf '\\033]2;corpus-title-2\\033\\\\'; sleep 5\n",
      });
      let entry: { title?: string; foregroundProcess?: string } | undefined;
      for (let i = 0; i < 80; i++) {
        const { entries } = await client().surface.terminal.list({});
        entry = entries.find((e) => e.id === id);
        if (entry?.title === "corpus-title-2") break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(entry?.title).toBe("corpus-title-2");
      expect(typeof entry?.foregroundProcess).toBe("string");

      await client().surface.terminal.kill({ id });
    });

    it("inventory: a snapshot first, then created/exited as PTYs come and go", {
      timeout: 20000,
    }, async () => {
      // The host-global membership feed kolu-server's live reconciler reads: one
      // ISOLATED subscription kept open across a spawn and a kill, so this never
      // poisons the shared connection (a left-open socket stream rejects on
      // dispose). Subscribe FIRST — the spawn below must land as a `created`
      // delta, not be missed.
      await withIsolated(async (c) => {
        const inv = await c.surface.inventory.get({});
        const it = inv[Symbol.asyncIterator]();
        try {
          // First frame: a snapshot of every live PTY (snapshot-then-deltas).
          const snapshot = await nextFrame(it);
          expect(snapshot.kind).toBe("snapshot");

          // A fresh spawn arrives as a `created` for its id (intervening deltas
          // from the shared host are skipped by `frameUntil`).
          const { id } = await c.surface.terminal.spawn(
            spawnInput(opts.makeCwd()),
          );
          const created = await frameUntil(
            it,
            (e) => e.kind === "created" && e.entry.id === id,
          );
          expect(created).toMatchObject({ kind: "created", entry: { id } });

          // …and its kill arrives as an `exited` for the same id.
          await c.surface.terminal.kill({ id });
          const exited = await frameUntil(
            it,
            (e) => e.kind === "exited" && e.id === id,
          );
          expect(exited).toEqual({ kind: "exited", id });
        } finally {
          // Close the subscription (the socket-safety `firstYield` documents).
          void Promise.resolve(it.return?.()).catch(() => {});
        }
      });
    });

    it("terminal.killAll reaps every live PTY", {
      timeout: 20000,
    }, async () => {
      await client().surface.terminal.spawn(spawnInput(opts.makeCwd()));
      await client().surface.terminal.spawn(spawnInput(opts.makeCwd()));
      const { killed } = await client().surface.terminal.killAll({});
      expect(killed).toBeGreaterThanOrEqual(2);
      // kill is async — the entry is removed on the PTY's exit event, not
      // synchronously — so poll list until it drains rather than racing it.
      let entries: unknown[] = [];
      for (let i = 0; i < 80; i++) {
        ({ entries } = await client().surface.terminal.list({}));
        if (entries.length === 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(entries).toEqual([]);
    });
  });
}

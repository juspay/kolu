/** Characterization tests for the extracted provider DAG (P4w).
 *
 *  These pin the package's load-bearing contract at its seam — that the DAG
 *  folds PTY-tap signals onto metadata through the injected `ProviderHooks`,
 *  and routes each signal through the CORRECT half of the persisted-vs-live
 *  fence (the DAG's side of it): foreground is a LIVE write (never fires the
 *  `terminals:dirty` autosave), a recognized agent command-run is a PERSISTED
 *  write plus an activity-feed signal. The fence's *enforcement* lives in
 *  kolu-server's `metadata.ts` (the hook impls); here we assert the DAG calls
 *  the right hook, which is what the host's fence relies on.
 *
 *  Hermetic: only the foreground/title/command-run taps are driven, and those
 *  fold synchronously onto the injected hooks; the git/pr/agent providers also
 *  start (against a throwaway non-repo cwd) but stay quiet, so the assertions
 *  never depend on their I/O. */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAgentCommand } from "anyagent";
import type { ForegroundSample } from "kaval";
import { inMemoryChannel } from "@kolu/surface/server";
import {
  LOCAL_LOCATION,
  type LiveTerminalFields,
  type ServerPersistedTerminalFields,
  type TerminalId,
  type TerminalServerMetadata,
} from "kolu-common/surface";
import type { GitInfo } from "kolu-git/schemas";
import type { Logger } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ProviderChannels,
  type ProviderHooks,
  type ProviderRecord,
  startProviders,
} from "./providers.ts";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** Drain the in-memory channels' async-iterator consume loops. */
const flush = async (): Promise<void> => {
  await tick();
  await tick();
};

/** A `Logger` stub that swallows everything — the DAG only logs. */
const silentLog: Logger = (() => {
  const noop = (): void => {};
  const l = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    trace: noop,
    fatal: noop,
    child: () => l,
  };
  return l as unknown as Logger;
})();

function freshMeta(cwd: string): TerminalServerMetadata {
  return {
    cwd,
    git: null,
    location: LOCAL_LOCATION,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    lastActivityAt: 0,
  };
}

/** Which metadata fields a recorded mutator writes — run it against a blank
 *  probe and read back the keys it set (every mutator is a pure assignment). */
function fieldsTouched<T extends object>(mutate: (m: T) => void): string[] {
  const probe = {} as T;
  mutate(probe);
  return Object.keys(probe);
}

describe("startProviders (the watcherDeps DAG)", () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  function harness() {
    const meta = freshMeta(mkdtempSync(join(tmpdir(), "terminal-providers-")));
    const live: Array<(m: LiveTerminalFields) => void> = [];
    const persisted: Array<(m: ServerPersistedTerminalFields) => void> = [];
    const recentAgents: string[] = [];
    const hooks: ProviderHooks = {
      updateServerMetadata: (_record, mutate) => {
        persisted.push(mutate);
        mutate(meta);
      },
      updateServerLiveMetadata: (_record, mutate) => {
        live.push(mutate);
        mutate(meta);
      },
      trackRecentAgent: (cmd) => recentAgents.push(cmd),
      trackRecentRepo: () => {},
    };
    const channels: ProviderChannels = {
      cwd: inMemoryChannel<string>(),
      title: inMemoryChannel<string>(),
      commandRun: inMemoryChannel<string>(),
      foreground: inMemoryChannel<ForegroundSample>(),
      git: inMemoryChannel<GitInfo | null>(),
    };
    const record: ProviderRecord = { pid: 4242, meta, currentAgent: null };
    stop = startProviders(
      record,
      "term-1" as TerminalId,
      channels,
      hooks,
      silentLog,
    );
    return { meta, live, persisted, recentAgents, channels };
  }

  it("folds foreground/title taps onto LIVE metadata, never the persisted fence", async () => {
    const h = harness();
    h.channels.foreground.publish({
      process: "/usr/bin/vim",
      foregroundPid: 4321,
    });
    h.channels.title.publish("vim — providers.ts");
    await flush();

    expect(h.meta.foreground).toEqual({
      name: "vim",
      title: "vim — providers.ts",
    });
    // The DAG routes foreground through the LIVE hook (no terminals:dirty)…
    expect(h.live.some((m) => fieldsTouched(m).includes("foreground"))).toBe(
      true,
    );
    // …and NEVER through the persisted hook (which would arm the autosave).
    expect(
      h.persisted.some((m) => fieldsTouched(m).includes("foreground")),
    ).toBe(false);
  });

  it("folds a recognized agent command-run onto PERSISTED metadata + activity feed", async () => {
    const h = harness();
    const normalized = parseAgentCommand("claude");
    expect(normalized).toBeTruthy(); // "claude" is a known agent

    h.channels.commandRun.publish("claude");
    await flush();

    expect(h.meta.lastAgentCommand).toBe(normalized);
    expect(h.recentAgents).toContain(normalized);
    // lastAgentCommand is persisted (fires terminals:dirty) — the persisted hook.
    expect(
      h.persisted.some((m) => fieldsTouched(m).includes("lastAgentCommand")),
    ).toBe(true);
  });

  it("ignores a non-agent command-run", async () => {
    const h = harness();
    h.channels.commandRun.publish("ls -la");
    await flush();

    expect(h.meta.lastAgentCommand).toBeUndefined();
    expect(h.recentAgents).toEqual([]);
  });

  it("returns an idempotent teardown", () => {
    harness();
    expect(() => {
      stop?.();
      stop?.();
    }).not.toThrow();
    stop = undefined;
  });
});

/**
 * THE RECORD — padi's `orchestrator` key, through the real `config.json`.
 *
 * Three things, and each is a different kind of promise:
 *  - a ROUND TRIP: a conversation written by one host comes back whole to the
 *    next one, through the same `Conf` the saved session rides;
 *  - the 1.4.0 MIGRATION RUNG: a state-root written before the orchestrator
 *    existed opens, answers the empty record and carries today's version;
 *  - FAIL-LOUD: a parseable-but-wrong record refuses by name instead of being
 *    normalized into a transcript with holes in it.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Harness, HarnessChange, HarnessOptions } from "@kolu/acp-harness";
import {
  DEFAULT_ORCHESTRATOR_STATE,
  type OrchestratorFrame,
  type OrchestratorRow,
} from "@kolu/padi-client/surface";
import { Schema } from "effect";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import {
  PADI_STATE_SCHEMA_VERSION,
  padiConfigPath,
  requirePadiStateStores,
} from "../session/stateStore.ts";
import { ACP_AGENT_ENV, KOLU_MCP_BIN_ENV } from "./bake.ts";
import {
  type OrchestratorHost,
  startOrchestratorHost,
} from "./orchestrator.ts";
import {
  EMPTY_PERSISTED_ORCHESTRATOR,
  PersistedOrchestratorSchema,
} from "./persisted.ts";

const HOME = "/home/tester";

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as Logger;

const row = (id: string, seq: number, text = id): OrchestratorRow => ({
  id,
  seq,
  since: "2026-01-01T00:00:00.000Z",
  kind: "agent",
  text,
});

let stateRoot: string;
const SAVED_AGENT = process.env[ACP_AGENT_ENV];
const SAVED_BIN = process.env[KOLU_MCP_BIN_ENV];

beforeEach(() => {
  stateRoot = mkdtempSync(join(tmpdir(), "padi-orch-"));
  __resetPadiSurfaceCtxForTest();
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  process.env[ACP_AGENT_ENV] = "/nix/store/fake-acp-adapter";
  process.env[KOLU_MCP_BIN_ENV] = "/nix/store/fake-kolu";
});

afterEach(() => {
  __resetPadiSurfaceCtxForTest();
  if (SAVED_AGENT === undefined) delete process.env[ACP_AGENT_ENV];
  else process.env[ACP_AGENT_ENV] = SAVED_AGENT;
  if (SAVED_BIN === undefined) delete process.env[KOLU_MCP_BIN_ENV];
  else process.env[KOLU_MCP_BIN_ENV] = SAVED_BIN;
});

/** A host over THIS state-root's real conf store, with the conversation itself
 *  stubbed — the subject here is the file, not the protocol. */
function hostOver(root: string): {
  host: OrchestratorHost;
  push: () => (change: HarnessChange) => void;
  resumedSeq: () => number | undefined;
} {
  const stores = requirePadiStateStores(root);
  let onChange: ((change: HarnessChange) => void) | undefined;
  let options: HarnessOptions | undefined;
  const host = startOrchestratorHost({
    log,
    home: HOME,
    hostName: "test-box",
    socketPath: () => "/run/padi.sock",
    store: stores.orchestrator,
    storePath: () => padiConfigPath(root),
    spawn: async (opts) => {
      options = opts;
      onChange = opts.onChange;
      const harness: Harness = {
        state: () => ({ ...DEFAULT_ORCHESTRATOR_STATE, phase: "idle" }),
        rows: () => [],
        alive: () => true,
        prompt: async () => ({ rowId: "sent" }),
        cancel: async () => {},
        answer: async () => true,
        signIn: async () => "signed-in",
        signInInput: async () => {},
        signInCancel: async () => false,
        setOption: async () => {},
        newSession: async () => {},
        stop: async () => {},
      };
      return harness;
    },
  });
  return {
    host,
    push: () => {
      if (onChange === undefined) throw new Error("nothing was spawned");
      return onChange;
    },
    resumedSeq: () => options?.resumedSeq,
  };
}

describe("the conversation survives a restart", () => {
  it("round-trips the transcript through padi's own `config.json`", async () => {
    const first = hostOver(stateRoot);
    await first.host.prompt("hello", []);
    first.push()({
      kind: "rows",
      upserts: [row("a", 1, "one"), row("b", 2, "two")],
      removes: [],
      appends: [],
    });
    first.push()({
      kind: "rows",
      upserts: [],
      removes: [],
      appends: [{ of: "b", at: 3, text: " and a half" }],
    });
    // The flush the shutdown runs — everything the throttle still owes.
    await first.host.dispose();

    // The BYTES, read back the way the next padi reads them: through the
    // record's own schema, so "it round-trips" means "it round-trips as a
    // value this code would accept", not "the JSON looked about right".
    const file: unknown = JSON.parse(
      readFileSync(padiConfigPath(stateRoot), "utf8"),
    );
    if (typeof file !== "object" || file === null || !("orchestrator" in file))
      throw new Error("padi's state-root kept no orchestrator record");
    const onDisk = Schema.decodeUnknownSync(PersistedOrchestratorSchema)(
      file.orchestrator,
    );
    expect(onDisk.rows).toEqual([
      row("a", 1, "one"),
      row("b", 2, "two and a half"),
    ]);

    const second = hostOver(stateRoot);
    const seen: OrchestratorFrame[] = [];
    second.host.watch((frame) => seen.push(frame));
    const snapshot = seen[0];
    if (snapshot?.kind !== "snapshot") throw new Error("expected a snapshot");
    expect(snapshot.rows).toEqual([
      row("a", 1, "one"),
      row("b", 2, "two and a half"),
    ]);
    // …and the count does not double: the restored rows are the whole of it,
    // and the fence tells the resumed conversation to count from past them.
    await second.host.prompt("still here?", []);
    expect(second.resumedSeq()).toBe(2);
    await second.host.dispose();
  });
});

describe("the 1.4.0 rung", () => {
  it("costs a pre-orchestrator state-root nothing, and carries the version", () => {
    writeFileSync(
      padiConfigPath(stateRoot),
      JSON.stringify({
        session: null,
        activityFeed: { recentRepos: [], recentAgents: [] },
        lastPairedDaemon: null,
        importedLegacyConfig: true,
        __internal__: { migrations: { version: "1.3.0" } },
      }),
    );
    const stores = requirePadiStateStores(stateRoot);
    // A file written before the orchestrator existed has no `orchestrator` key
    // at all; `Conf`'s defaults answer it, which is exactly why the rung is a
    // no-op rather than a backfill.
    expect(stores.orchestrator.get()).toEqual(EMPTY_PERSISTED_ORCHESTRATOR);
    const after = JSON.parse(
      readFileSync(padiConfigPath(stateRoot), "utf8"),
    ) as { __internal__: { migrations: { version: string } } };
    expect(after.__internal__.migrations.version).toBe(
      PADI_STATE_SCHEMA_VERSION,
    );
  });
});

describe("a record that parses but is wrong", () => {
  it("REFUSES by name rather than restoring a transcript with holes in it", () => {
    requirePadiStateStores(stateRoot);
    const config = JSON.parse(
      readFileSync(padiConfigPath(stateRoot), "utf8"),
    ) as Record<string, unknown>;
    // A row with no `kind` — the shape a hand-edit, a half-written file or a
    // rolled-back binary leaves behind. `confStore` casts, so without the
    // re-validation this reaches the panel as a row nothing can draw.
    config.orchestrator = {
      sessionId: null,
      cwd: HOME,
      model: null,
      rows: [{ id: "a", seq: 1, since: "2026-01-01T00:00:00.000Z" }],
      fleet: [],
    };
    writeFileSync(padiConfigPath(stateRoot), JSON.stringify(config));

    const host = hostOver(stateRoot).host;
    expect(() => host.watch(() => {})).toThrow(/does not match schema/);
    expect(() => host.watch(() => {})).toThrow(padiConfigPath(stateRoot));
  });
});

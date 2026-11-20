import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SavedSessionSchema } from "@kolu/padi-client/surface";
import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { trackRecentAgent } from "../activity/activity.ts";
import { importLegacyConfigOnce } from "./importLegacy.ts";
import {
  PADI_STATE_SCHEMA_VERSION,
  requirePadiStateStores as openPadiStateStores,
} from "./stateStore.ts";

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const SAVED_STATE_DIR = process.env.KOLU_STATE_DIR;
let legacyDir: string;
let stateRoot: string;

beforeEach(() => {
  legacyDir = mkdtempSync(join(tmpdir(), "padi-legacy-"));
  stateRoot = mkdtempSync(join(tmpdir(), "padi-sr-"));
  process.env.KOLU_STATE_DIR = legacyDir;
});
afterEach(() => {
  if (SAVED_STATE_DIR === undefined) delete process.env.KOLU_STATE_DIR;
  else process.env.KOLU_STATE_DIR = SAVED_STATE_DIR;
});

function writeLegacy(blob: unknown): string {
  const p = join(legacyDir, "config.json");
  writeFileSync(p, typeof blob === "string" ? blob : JSON.stringify(blob));
  return p;
}

const legacyBlob = () => ({
  session: {
    terminals: [{ id: "11111111-1111-1111-1111-111111111111" }],
    activeTerminalId: null,
  },
  activityFeed: {
    recentRepos: [{ repoRoot: "/repo/a", repoName: "a", lastSeen: 5 }],
    recentAgents: [{ command: "claude --yolo", lastSeen: 5 }],
  },
  lastPairedDaemon: { startedAt: 1234 },
  preferences: { theme: "dark", newTerminalTheme: "x", shuffleBehavior: "y" },
});

describe("importLegacyConfigOnce", () => {
  it("carries session/activityFeed/lastPairedDaemon across, but NOT preferences", () => {
    writeLegacy(legacyBlob());
    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);

    expect(stores.session.get()?.terminals).toHaveLength(1);
    expect(stores.activityFeed.get().recentRepos).toEqual([
      { repoRoot: "/repo/a", repoName: "a", lastSeen: 5 },
    ]);
    expect(stores.activityFeed.get().recentAgents).toEqual([]);
    expect(stores.lastPairedDaemon.get()).toEqual({ startedAt: 1234 });
    expect(stores.conf.get("importedLegacyConfig")).toBe(true);
    expect(
      (stores.conf as unknown as { get(k: string): unknown }).get(
        "preferences",
      ),
    ).toBeUndefined();
  });

  it("takes the backup BEFORE reading — `config.json.pre-padi-import.bak`", () => {
    const oldPath = writeLegacy(legacyBlob());
    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);

    const bak = `${oldPath}.pre-padi-import.bak`;
    expect(existsSync(bak)).toBe(true);
    expect(readFileSync(bak, "utf8")).toBe(readFileSync(oldPath, "utf8"));
  });

  it("imports EXACTLY once — a second call is a no-op even if the file changes", () => {
    writeLegacy(legacyBlob());
    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);
    expect(stores.activityFeed.get().recentRepos).toEqual([
      { repoRoot: "/repo/a", repoName: "a", lastSeen: 5 },
    ]);
    expect(stores.activityFeed.get().recentAgents).toEqual([]);

    writeLegacy({
      ...legacyBlob(),
      activityFeed: { recentRepos: ["/repo/b"], recentAgents: [] },
    });
    importLegacyConfigOnce(stores, log);
    expect(stores.activityFeed.get().recentRepos).toEqual([
      { repoRoot: "/repo/a", repoName: "a", lastSeen: 5 },
    ]);
    expect(stores.activityFeed.get().recentAgents).toEqual([]);
  });

  it("an imported legacy MRU row cannot crash the first live track", () => {
    writeLegacy(legacyBlob());
    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);
    expect(stores.activityFeed.get().recentAgents).toEqual([]);

    __resetPadiSurfaceCtxForTest();
    const base = noopPadiSurfaceCtxForTest();
    setPadiSurfaceCtx({
      ...base,
      cells: new Proxy({} as never, {
        get: (_t, name) =>
          name === "activityFeed"
            ? stores.activityFeed
            : (base.cells as Record<string, unknown>)[name as string],
      }),
    } as ReturnType<typeof noopPadiSurfaceCtxForTest>);
    try {
      expect(() =>
        trackRecentAgent("claude-code", ["--model", "sonnet"]),
      ).not.toThrow();
      expect(stores.activityFeed.get().recentAgents).toEqual([
        {
          kind: "claude-code",
          argv: ["--model", "sonnet"],
          lastSeen: expect.any(Number),
        },
      ]);
    } finally {
      __resetPadiSurfaceCtxForTest();
    }
  });

  it("CRASHES loudly on a malformed old file — never starts empty", () => {
    writeLegacy("{ this is not valid json ");
    const stores = openPadiStateStores(stateRoot);
    expect(() => importLegacyConfigOnce(stores, log)).toThrow();
    expect(stores.conf.get("importedLegacyConfig")).toBe(false);
  });

  it("SKIPS the import when padi already holds its OWN session — padi's state wins (never clobbered)", () => {
    const stores = openPadiStateStores(stateRoot);
    stores.session.set({
      terminals: [{ id: "99999999-9999-9999-9999-999999999999" }],
      activeTerminalId: null,
      // biome-ignore lint/suspicious/noExplicitAny: a minimal SavedSession for the clobber-guard test.
    } as any);
    writeLegacy(legacyBlob());

    importLegacyConfigOnce(stores, log);

    expect(stores.session.get()?.terminals).toHaveLength(1);
    expect(stores.session.get()?.terminals[0]?.id).toBe(
      "99999999-9999-9999-9999-999999999999",
    );
    expect(stores.conf.get("importedLegacyConfig")).toBe(true);
    expect(existsSync(join(legacyDir, "config.json.pre-padi-import.bak"))).toBe(
      false,
    );
  });

  it("is a clean no-op with no $KOLU_STATE_DIR (a dev/e2e padi with its own root)", () => {
    delete process.env.KOLU_STATE_DIR;
    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);
    expect(stores.session.get()).toBeNull();
    expect(stores.conf.get("importedLegacyConfig")).toBe(false);
  });

  it("marks done (no re-scan) when $KOLU_STATE_DIR is set but no old file exists", () => {
    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);
    expect(stores.conf.get("importedLegacyConfig")).toBe(true);
    expect(stores.session.get()).toBeNull();
  });

  it("DIRECT pre-W2.2 → W2.3 upgrade: imports from the strip-backup when the live file is already stripped — session intact, zero loss", () => {
    const oldPath = writeLegacy({
      preferences: {
        theme: "dark",
        newTerminalTheme: "x",
        shuffleBehavior: "y",
      },
    });
    writeFileSync(
      `${oldPath}.pre-1.31-strip.bak`,
      JSON.stringify(legacyBlob()),
    );

    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);

    expect(stores.session.get()?.terminals).toHaveLength(1);
    expect(stores.session.get()?.terminals[0]?.id).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(stores.activityFeed.get().recentRepos).toEqual([
      { repoRoot: "/repo/a", repoName: "a", lastSeen: 5 },
    ]);
    expect(stores.activityFeed.get().recentAgents).toEqual([]);
    expect(stores.lastPairedDaemon.get()).toEqual({ startedAt: 1234 });
    expect(stores.conf.get("importedLegacyConfig")).toBe(true);
    expect(existsSync(`${oldPath}.pre-padi-import.bak`)).toBe(false);
  });

  it("prefers the LIVE file when it still carries the keys, even if a strip-backup also exists", () => {
    const oldPath = writeLegacy(legacyBlob());
    writeFileSync(
      `${oldPath}.pre-1.31-strip.bak`,
      JSON.stringify({
        ...legacyBlob(),
        session: {
          terminals: [{ id: "00000000-0000-0000-0000-000000000000" }],
          activeTerminalId: null,
        },
      }),
    );

    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);

    expect(stores.session.get()?.terminals[0]?.id).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(existsSync(`${oldPath}.pre-padi-import.bak`)).toBe(true);
  });

  it("brings a legacy session's nullable `git` up to padi's current shape on import", () => {
    writeLegacy({
      session: {
        terminals: [
          { id: "11111111-1111-1111-1111-111111111111", cwd: "/r", git: null },
        ],
        activeTerminalId: null,
      },
    });
    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);
    expect(stores.session.get()?.terminals[0]?.git).toEqual({
      kind: "unresolved",
    });
  });
});

describe("padi's own migration ladder", () => {
  it("1.1.0: a 1.0.0 file's saved `git` becomes the three-case fact", () => {
    const info = {
      repoRoot: "/r",
      repoName: "r",
      worktreePath: "/r",
      branch: "main",
      isWorktree: false,
      mainRepoRoot: "/r",
      remoteUrl: null,
    };
    writeFileSync(
      join(stateRoot, "config.json"),
      JSON.stringify({
        session: {
          terminals: [
            { id: "a", state: "active", cwd: "/tmp", git: null },
            { id: "b", state: "active", cwd: "/r", git: info },
          ],
          activeTerminalId: "a",
          savedAt: 1,
        },
        __internal__: { migrations: { version: "1.0.0" } },
      }),
    );
    const stores = openPadiStateStores(stateRoot);
    expect(stores.session.get()?.terminals.map((t) => t.git)).toEqual([
      { kind: "unresolved" },
      { kind: "repo", info },
    ]);
    const onDisk = JSON.parse(
      readFileSync(join(stateRoot, "config.json"), "utf8"),
    ) as { __internal__: { migrations: { version: string } } };
    expect(onDisk.__internal__.migrations.version).toBe(
      PADI_STATE_SCHEMA_VERSION,
    );
  });

  it("1.2.0: a 1.1.0 file's old-shape `agents` stamp is dropped; a current one is kept", () => {
    const current = {
      bundle: "/nix/store/aaa-agent-distro",
      profiles: [
        {
          reference: "github:juspay/skills",
          name: "juspay",
          rev: "a1b2c3d",
          path: "/nix/store/bbb-profile-juspay",
        },
      ],
    };
    const terminal = (id: string, agents?: unknown) => ({
      id,
      state: "active",
      cwd: "/tmp",
      git: { kind: "unresolved" },
      ...(agents === undefined ? {} : { agents }),
    });
    writeFileSync(
      join(stateRoot, "config.json"),
      JSON.stringify({
        session: {
          terminals: [
            terminal("old", {
              profile: "juspay",
              bundle: "/nix/store/ccc-agent-distro-juspay",
            }),
            terminal("new", current),
            terminal("none"),
          ],
          activeTerminalId: "old",
          savedAt: 1,
        },
        __internal__: { migrations: { version: "1.1.0" } },
      }),
    );
    const stores = openPadiStateStores(stateRoot);
    const terminals = stores.session.get()?.terminals ?? [];
    expect(terminals.map((t) => [t.id, t.agents])).toEqual([
      ["old", undefined],
      ["new", current],
      ["none", undefined],
    ]);
    expect("agents" in (terminals[0] ?? {})).toBe(false);
    const onDisk = JSON.parse(
      readFileSync(join(stateRoot, "config.json"), "utf8"),
    ) as {
      session: { terminals: Record<string, unknown>[] };
      __internal__: { migrations: { version: string } };
    };
    expect(onDisk.__internal__.migrations.version).toBe(
      PADI_STATE_SCHEMA_VERSION,
    );
    expect(onDisk.session.terminals[0]).not.toHaveProperty("agents");
  });

  it("1.3.0: a captured command line and the old MRU rows are DROPPED, never re-parsed", () => {
    const sessionId = "0192f3a1-4c5b-7d8e-9f01-23456789abcd";
    writeFileSync(
      join(stateRoot, "config.json"),
      JSON.stringify({
        session: {
          terminals: [
            {
              id: "exact",
              state: "active",
              cwd: "/tmp",
              git: { kind: "unresolved" },
              pr: { kind: "absent" },
              location: { kind: "local" },
              lastActivityAt: 5,
              promptedAt: null,
              lastAgentCommand: "LD_PRELOAD=/x claude --settings '{}'",
              restoreTarget: {
                kind: "exact",
                command: "LD_PRELOAD=/x claude --settings '{}'",
                agent: {
                  kind: "claude-code",
                  sessionId,
                  resumeRef: sessionId,
                },
              },
            },
            {
              id: "legacy",
              state: "active",
              cwd: "/tmp",
              git: { kind: "unresolved" },
              pr: { kind: "absent" },
              location: { kind: "local" },
              lastActivityAt: 5,
              promptedAt: null,
              restoreTarget: { kind: "legacyMostRecent", command: "codex" },
            },
          ],
          activeTerminalId: "exact",
          savedAt: 1,
        },
        activityFeed: {
          recentRepos: [
            { repoRoot: "/repo/kept", repoName: "kept", lastSeen: 5 },
          ],
          recentAgents: [{ command: "claude --yolo", lastSeen: 5 }],
        },
        __internal__: { migrations: { version: "1.2.0" } },
      }),
    );
    const stores = openPadiStateStores(stateRoot);
    const terminals = stores.session.get()?.terminals ?? [];
    expect(terminals[0]?.restoreTarget).toEqual({
      kind: "exact",
      agent: { kind: "claude-code", sessionId, resumeRef: sessionId },
      argv: [],
    });
    expect(terminals[1]?.restoreTarget).toEqual({ kind: "none" });
    expect("lastAgentCommand" in (terminals[0] ?? {})).toBe(false);
    expect(stores.activityFeed.get().recentAgents).toEqual([]);
    expect(stores.activityFeed.get().recentRepos).toEqual([
      { repoRoot: "/repo/kept", repoName: "kept", lastSeen: 5 },
    ]);
    expect(readFileSync(join(stateRoot, "config.json"), "utf8")).not.toContain(
      "LD_PRELOAD",
    );
  });

  it("1.6.0: a 1.5.0 file's resolved PR that never said draft becomes pending", () => {
    const oldOk = {
      kind: "ok",
      value: {
        number: 7,
        title: "Fix the parser",
        url: "https://github.example/o/r/pull/7",
        state: "open",
        checks: "pass",
        checkRuns: [],
        reviewDecision: null,
        mergeStateStatus: "CLEAN",
        headSha: "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3",
      },
    };
    const saysDraft = {
      kind: "ok",
      value: { ...oldOk.value, number: 8, isDraft: true },
    };
    const unavailable = {
      kind: "unavailable",
      source: { provider: "gh", code: "not-authenticated" },
    };
    const terminal = (n: number, pr: unknown, sleptAt?: number) => ({
      cwd: "/r",
      git: { kind: "none" },
      pr,
      location: { kind: "local" },
      restoreTarget: { kind: "none" },
      lastActivityAt: null,
      promptedAt: null,
      ...(sleptAt === undefined
        ? { state: "active" }
        : { state: "sleeping", sleptAt }),
      id: `${n}1111111-1111-4111-8111-111111111111`,
    });
    writeFileSync(
      join(stateRoot, "config.json"),
      JSON.stringify({
        session: {
          terminals: [
            terminal(1, oldOk),
            terminal(2, oldOk, 1_700_000_000_000),
            terminal(3, saysDraft),
            terminal(4, { kind: "absent" }),
            terminal(5, unavailable),
          ],
          activeTerminalId: terminal(1, oldOk).id,
          savedAt: 1,
        },
        __internal__: { migrations: { version: "1.5.0" } },
      }),
    );
    const stores = openPadiStateStores(stateRoot);
    const expected = [
      { kind: "pending" },
      { kind: "pending" },
      saysDraft,
      { kind: "absent" },
      unavailable,
    ];
    expect(stores.session.get()?.terminals.map((t) => t.pr)).toEqual(expected);
    const readDisk = () =>
      JSON.parse(readFileSync(join(stateRoot, "config.json"), "utf8")) as {
        session: unknown;
        __internal__: { migrations: { version: string } };
      };
    const onDisk = readDisk();
    expect(onDisk.__internal__.migrations.version).toBe("1.6.0");
    expect(
      Schema.decodeUnknownSync(SavedSessionSchema)(
        onDisk.session,
      ).terminals.map((t) => t.pr),
    ).toEqual(expected);
    openPadiStateStores(stateRoot);
    expect(readDisk()).toEqual(onDisk);
  });

  it("a fresh state-root has no session to migrate", () => {
    const stores = openPadiStateStores(stateRoot);
    expect(stores.session.get()).toBeNull();
  });
});

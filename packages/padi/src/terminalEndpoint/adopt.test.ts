import {
  AuthoredActiveSchema,
  PersistedSnapshotSchema,
  type SavedActiveTerminal,
  SavedActiveTerminalSchema,
} from "@kolu/padi-client/surface";
import type { PtyHostListEntry } from "kaval";
import { describe, expect, it } from "vitest";
import { adoptedAuthored, adoptedSnapshot, orphanSnapshot } from "./local.ts";

function liveEntry(over: Partial<PtyHostListEntry> = {}): PtyHostListEntry {
  return {
    id: "term-sentinel",
    pid: 4242,
    cwd: "/sentinel/cwd",
    lastActivity: 0,
    ...over,
  };
}

const sentinel: SavedActiveTerminal = {
  id: "term-sentinel",
  state: "active",
  cwd: "/sentinel/cwd",
  location: { kind: "remote", hostId: "sentinel-host" },
  git: {
    kind: "repo",
    info: {
      repoRoot: "/sentinel/repo",
      repoName: "sentinel-repo",
      worktreePath: "/sentinel/wt",
      branch: "sentinel-branch",
      isWorktree: true,
      mainRepoRoot: "/sentinel/main",
      remoteUrl: "git@example.com:sentinel.git",
      isBare: false,
    },
  },
  pr: {
    kind: "ok",
    value: {
      number: 1275,
      title: "Sentinel PR",
      url: "https://example.com/o/sentinel/pull/1275",
      state: "open",
      checks: "pass",
      checkRuns: [],
      reviewDecision: null,
      mergeStateStatus: "UNKNOWN",
      headSha: null,
      isDraft: false,
    },
  },
  restoreTarget: {
    kind: "exact",
    agent: {
      kind: "claude-code",
      sessionId: "edb66a3b-9f17-4c39-9050-3b77904c313a",
      resumeRef: "edb66a3b-9f17-4c39-9050-3b77904c313a",
    },
    argv: ["--model", "sonnet"],
  },
  lastActivityAt: 1_718_000_000_000,
  promptedAt: null,
  agents: {
    bundle: "/nix/store/00000000sentinel-agent-distro",
    profiles: [
      {
        reference: "github:sentinel/profile",
        name: "sentinel",
        rev: "0123456789abcdef",
        path: "/nix/store/11111111sentinel-profile",
      },
    ],
  },
  themeName: "Dracula",
  parentId: "term-parent",
  canvasLayout: { x: 11, y: 22, w: 33, h: 44 },
  subPanel: { collapsed: true, panelSize: 257 },
  rightPanel: {
    collapsed: true,
    activeTab: "code",
    codeMode: "branch",
    selectedFileByMode: { local: "a.ts", branch: "b.ts", browse: "c.ts" },
  },
  intent: "sentinel intent line\nsecond line",
};

describe("adoption preserves the whole record — the #1275 lossy-adoption class", () => {
  it("the sentinel covers EVERY persisted SavedTerminal key", () => {
    expect(Object.keys(sentinel).sort()).toEqual(
      Object.keys(SavedActiveTerminalSchema.fields).sort(),
    );
  });

  it("adoptedSnapshot carries every persisted OBSERVATION field verbatim", () => {
    const aw = adoptedSnapshot(sentinel, liveEntry({ cwd: sentinel.cwd }));
    for (const key of Object.keys(PersistedSnapshotSchema.fields)) {
      expect(aw[key as keyof typeof aw]).toEqual(
        sentinel[key as keyof SavedActiveTerminal],
      );
    }
  });

  it("adoptedAuthored carries location + memory + restoreTarget + client chrome + the active discriminant", () => {
    const authored = adoptedAuthored(sentinel);
    for (const key of Object.keys(AuthoredActiveSchema.fields)) {
      expect(authored[key as keyof typeof authored]).toEqual(
        sentinel[key as keyof SavedActiveTerminal],
      );
    }
  });

  it("re-seeds the LIVE-only fields (agent + foreground) while the persisted pr carries", () => {
    const aw = adoptedSnapshot(sentinel, liveEntry());
    expect(aw.agent).toBeNull();
    expect(aw.foreground).toBeNull();
    expect(aw.pr).toEqual(sentinel.pr);
  });

  it("the LIVE daemon cwd wins over the stale SAVED cwd (F2)", () => {
    const aw = adoptedSnapshot(
      sentinel,
      liveEntry({ cwd: "/moved/since/save" }),
    );
    expect(aw.cwd).toBe("/moved/since/save");
    expect(aw.cwd).not.toBe(sentinel.cwd);
  });

  it("seeds foreground from the live snapshot's foregroundProcess (F2)", () => {
    const aw = adoptedSnapshot(
      sentinel,
      liveEntry({ foregroundProcess: "vim", title: "vim file.ts" }),
    );
    expect(aw.foreground).toEqual({
      name: "vim",
      title: "vim file.ts",
      shell: false,
    });
  });
});

describe("orphanSnapshot — adopting a live PTY with no saved record (F1)", () => {
  it("seeds entirely from the live daemon snapshot", () => {
    const aw = orphanSnapshot(
      liveEntry({ cwd: "/orphan/cwd", foregroundProcess: "claude" }),
    );
    expect(aw.cwd).toBe("/orphan/cwd");
    expect(aw.foreground).toEqual({
      name: "claude",
      title: null,
      shell: false,
    });
    expect(aw.pr).toEqual({ kind: "pending" });
    expect(aw.agent).toBeNull();
  });

  it("null foreground when the daemon reports no foreground process", () => {
    expect(orphanSnapshot(liveEntry()).foreground).toBeNull();
  });
});

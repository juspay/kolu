import { AwarenessPersistedFieldsSchema } from "@kolu/pulam-library/schema";
import type { PtyHostListEntry } from "kaval";
import {
  AuthoredActiveSchema,
  type SavedActiveTerminal,
  SavedActiveTerminalSchema,
} from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { adoptedAuthored, adoptedAwareness, orphanAwareness } from "./local.ts";

/** A live `terminal.list` entry for the sentinel id. The daemon snapshot is the
 *  authority for `cwd`/`foreground` during adoption (F2), so the builder lets a
 *  test set a cwd that DIFFERS from the saved record's. */
function liveEntry(over: Partial<PtyHostListEntry> = {}): PtyHostListEntry {
  return {
    id: "term-sentinel",
    pid: 4242,
    cwd: "/sentinel/cwd",
    lastActivity: 0,
    ...over,
  };
}

// An EXHAUSTIVE sentinel: every persisted field of `SavedTerminal` set to a
// distinct, non-default value. The exhaustiveness assertion below fails if a new
// persisted field is added to the schema without being added here — which forces
// it into the round-trip rather than letting it slip the adoption path silently
// (exactly how #1275 dropped `parentId` and `lastAgentCommand`). lastActivityAt
// is a real, non-zero epoch so a drop-to-default can't pass by coincidence.
const sentinel: SavedActiveTerminal = {
  id: "term-sentinel",
  state: "active",
  cwd: "/sentinel/cwd",
  // Deliberately the REMOTE variant: `adoptedAuthored` parses `location` straight
  // off the saved record, so a distinct host proves the saved `location` rides
  // the round-trip rather than coincidentally matching a `{ kind: "local" }` seed.
  location: { kind: "remote", hostId: "sentinel-host" },
  git: {
    repoRoot: "/sentinel/repo",
    repoName: "sentinel-repo",
    worktreePath: "/sentinel/wt",
    branch: "sentinel-branch",
    isWorktree: true,
    mainRepoRoot: "/sentinel/main",
    remoteUrl: "git@example.com:sentinel.git",
  },
  lastAgentCommand: "claude --model sonnet",
  agentSession: {
    kind: "claude-code",
    id: "edb66a3b-9f17-4c39-9050-3b77904c313a",
  },
  lastActivityAt: 1_718_000_000_000,
  themeName: "Dracula",
  parentId: "term-parent",
  canvasLayout: { x: 11, y: 22, w: 33, h: 44 },
  subPanel: { collapsed: true, panelSize: 257 },
  rightPanel: {
    activeTab: "code",
    codeMode: "branch",
    selectedFileByMode: { local: "a.ts", branch: "b.ts", browse: "c.ts" },
  },
  intent: "sentinel intent line\nsecond line",
};

describe("adoption preserves the whole record — the #1275 lossy-adoption class", () => {
  it("the sentinel covers EVERY persisted SavedTerminal key", () => {
    // A persisted field added to the schema but not to the sentinel fails here,
    // forcing it into the round-trip below rather than silently slipping the
    // adoption path — the structural guard that closes the #1275 class.
    expect(Object.keys(sentinel).sort()).toEqual(
      Object.keys(SavedActiveTerminalSchema.shape).sort(),
    );
  });

  it("adoptedAwareness carries every persisted AWARENESS field verbatim", () => {
    // Use a live entry whose cwd MATCHES the saved record so this test isolates
    // the whole-record carry-through; the live-cwd-wins case is asserted below.
    const aw = adoptedAwareness(sentinel, liveEntry({ cwd: sentinel.cwd }));
    for (const key of Object.keys(AwarenessPersistedFieldsSchema.shape)) {
      expect(aw[key as keyof typeof aw]).toEqual(
        sentinel[key as keyof SavedActiveTerminal],
      );
    }
  });

  it("adoptedAuthored carries location + client chrome + the active discriminant", () => {
    const authored = adoptedAuthored(sentinel);
    for (const key of Object.keys(AuthoredActiveSchema.shape)) {
      expect(authored[key as keyof typeof authored]).toEqual(
        sentinel[key as keyof SavedActiveTerminal],
      );
    }
  });

  it("seeds the live awareness fields at their defaults (the providers re-derive them)", () => {
    const aw = adoptedAwareness(sentinel, liveEntry());
    // The live fields are NOT persisted: adoption seeds the awareness defaults,
    // and the provider DAG re-derives them against the surviving taps (the
    // freshness guarantee — never a stale carried-over value).
    expect(aw.pr).toEqual({ kind: "pending" });
    expect(aw.agent).toBeNull();
    expect(aw.foreground).toBeNull();
  });

  it("the LIVE daemon cwd wins over the stale SAVED cwd (F2)", () => {
    // The shell cd'd while kolu-server was down (or after the last debounced
    // autosave). kaval's cwd tap does NOT replay a snapshot, so the saved cwd
    // would otherwise stick and be re-persisted over the live truth. The live
    // `list` entry's cwd is the authority.
    const aw = adoptedAwareness(
      sentinel,
      liveEntry({ cwd: "/moved/since/save" }),
    );
    expect(aw.cwd).toBe("/moved/since/save");
    expect(aw.cwd).not.toBe(sentinel.cwd);
  });

  it("seeds foreground from the live snapshot's foregroundProcess (F2)", () => {
    const aw = adoptedAwareness(
      sentinel,
      liveEntry({ foregroundProcess: "vim", title: "vim file.ts" }),
    );
    expect(aw.foreground).toEqual({ name: "vim", title: "vim file.ts" });
  });
});

describe("orphanAwareness — adopting a live PTY with no saved record (F1)", () => {
  it("seeds entirely from the live daemon snapshot", () => {
    const aw = orphanAwareness(
      liveEntry({ cwd: "/orphan/cwd", foregroundProcess: "claude" }),
    );
    expect(aw.cwd).toBe("/orphan/cwd");
    expect(aw.foreground).toEqual({ name: "claude", title: null });
    // Live fields the providers re-derive start at their defaults.
    expect(aw.pr).toEqual({ kind: "pending" });
    expect(aw.agent).toBeNull();
    expect(aw.lastActivityAt).toBe(0);
  });

  it("null foreground when the daemon reports no foreground process", () => {
    expect(orphanAwareness(liveEntry()).foreground).toBeNull();
  });
});

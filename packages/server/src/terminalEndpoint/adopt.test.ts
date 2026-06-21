import type { PtyHostListEntry } from "kaval";
import {
  type SavedActiveTerminal,
  SavedActiveTerminalSchema,
} from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { adoptedMeta, orphanMeta } from "./local.ts";

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
  // Deliberately the REMOTE variant: `adoptedMeta` seeds `createMetadata(_,
  // LOCAL_LOCATION)` then spreads the persisted record over it, so a distinct
  // host proves the saved `location` wins the round-trip rather than
  // coincidentally matching the `{ kind: "local" }` seed.
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

  it("adoptedMeta carries every persisted field through verbatim", () => {
    // Use a live entry whose cwd MATCHES the saved record so this test isolates
    // the whole-record carry-through; the live-cwd-wins case is asserted below.
    const meta = adoptedMeta(sentinel, liveEntry({ cwd: sentinel.cwd }));
    for (const key of Object.keys(SavedActiveTerminalSchema.shape)) {
      if (key === "id") continue; // `id` is the registry key, not a `meta` field
      expect(meta[key as keyof typeof meta]).toEqual(
        sentinel[key as keyof SavedActiveTerminal],
      );
    }
  });

  it("seeds the live fields at their defaults (the providers re-derive them)", () => {
    const meta = adoptedMeta(sentinel, liveEntry());
    // The live fields are NOT persisted: adoption seeds `createMetadata`'s
    // defaults, and the provider DAG re-derives them against the surviving taps
    // (the freshness guarantee — never a stale carried-over value).
    expect(meta.pr).toEqual({ kind: "pending" });
    expect(meta.agent).toBeNull();
    expect(meta.foreground).toBeNull();
  });

  it("the LIVE daemon cwd wins over the stale SAVED cwd (F2)", () => {
    // The shell cd'd while kolu-server was down (or after the last debounced
    // autosave). kaval's cwd tap does NOT replay a snapshot, so the saved cwd
    // would otherwise stick and be re-persisted over the live truth. The live
    // `list` entry's cwd is the authority.
    const meta = adoptedMeta(sentinel, liveEntry({ cwd: "/moved/since/save" }));
    expect(meta.cwd).toBe("/moved/since/save");
    expect(meta.cwd).not.toBe(sentinel.cwd);
  });

  it("seeds foreground from the live snapshot's foregroundProcess (F2)", () => {
    const meta = adoptedMeta(
      sentinel,
      liveEntry({ foregroundProcess: "vim", title: "vim file.ts" }),
    );
    expect(meta.foreground).toEqual({ name: "vim", title: "vim file.ts" });
  });
});

describe("orphanMeta — adopting a live PTY with no saved record (F1)", () => {
  it("seeds entirely from the live daemon snapshot", () => {
    const meta = orphanMeta(
      liveEntry({ cwd: "/orphan/cwd", foregroundProcess: "claude" }),
    );
    expect(meta.cwd).toBe("/orphan/cwd");
    expect(meta.foreground).toEqual({ name: "claude", title: null });
    // Live fields the providers re-derive start at their defaults.
    expect(meta.pr).toEqual({ kind: "pending" });
    expect(meta.agent).toBeNull();
    expect(meta.lastActivityAt).toBe(0);
  });

  it("null foreground when the daemon reports no foreground process", () => {
    expect(orphanMeta(liveEntry()).foreground).toBeNull();
  });
});

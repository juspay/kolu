import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backfillSavedSession,
  SavedSessionSchema,
} from "@kolu/padi-client/surface";
import {
  pinPreviousShapeRecovery,
  plantYesterdayDaemon,
} from "@kolu/surface-daemon/upgrade-window.testlib";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { requirePadiStateStores as openPadiStateStores } from "../session/stateStore.ts";
import { padiYesterdayDaemonOptions } from "./yesterdayDaemon.fixture.testlib.ts";

const decodeSavedSession = Schema.decodeUnknownSync(SavedSessionSchema);

function previousShapeSession() {
  return {
    terminals: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        cwd: "/home/user/project",
        git: {
          repoRoot: "/home/user/project",
          repoName: "project",
          worktreePath: "/home/user/project",
          branch: "main",
          isWorktree: false,
          mainRepoRoot: "/home/user/project",
        },
        lastActivityAt: 42,
        themeName: "nord",
      },
    ],
    savedAt: 1_700_000_000_000,
  };
}

describe("old session file under new padi (upgrade-window)", () => {
  it("openPadiStateStores keeps a previous-shape session present (never silently empty)", async () => {
    const d = await plantYesterdayDaemon(
      padiYesterdayDaemonOptions({
        session: previousShapeSession(),
        withSocket: false,
        gate: { kind: "absent" },
      }),
    );
    try {
      if (d.state.kind !== "planted") throw new Error("expected planted state");
      const stores = openPadiStateStores(d.state.stateRoot);
      const session = stores.session.get();
      expect(session).not.toBeNull();
      expect(session?.terminals).toHaveLength(1);
      expect(session?.terminals[0]?.id).toBe(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      );
      expect(session?.terminals[0]).not.toHaveProperty("state");
      expect(session?.terminals[0]).not.toHaveProperty("location");
    } finally {
      await d.dispose();
    }
  });

  it("backfillSavedSession + parse RESTORES a known previous shape (named recovery)", () => {
    pinPreviousShapeRecovery({
      previous: previousShapeSession(),
      irrecoverable: { terminals: "not-an-array", savedAt: "nope" },
      recover: backfillSavedSession,
      parse: (value) => decodeSavedSession(value),
      assertRecovered: (recovered) => {
        expect(recovered.terminals).toHaveLength(1);
        expect(recovered.terminals[0]).toMatchObject({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          state: "active",
          location: { kind: "local" },
          cwd: "/home/user/project",
        });
        expect(recovered.activeTerminalId).toBeNull();
        expect(recovered.savedAt).toBe(1_700_000_000_000);
      },
    });
  });

  it("a previous-shape session holding a RESOLVED PR recovers, with that PR pending", () => {
    const withResolvedPr = {
      terminals: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          cwd: "/home/user/project",
          git: { kind: "none" },
          pr: {
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
          },
          location: { kind: "local" },
          restoreTarget: { kind: "none" },
          lastActivityAt: 42,
          promptedAt: null,
          state: "active",
        },
      ],
      activeTerminalId: null,
      savedAt: 1_700_000_000_000,
    };
    expect(() => decodeSavedSession(withResolvedPr)).toThrow();
    pinPreviousShapeRecovery({
      previous: withResolvedPr,
      irrecoverable: { terminals: "not-an-array", savedAt: "nope" },
      recover: backfillSavedSession,
      parse: (value) => decodeSavedSession(value),
      assertRecovered: (recovered) => {
        expect(recovered.terminals[0]).toMatchObject({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          pr: { kind: "pending" },
        });
      },
    });
  });

  it("irrecoverable garbage REFUSES by name (throws) — never collapses to empty", () => {
    const garbage = {
      terminals: "not-an-array",
      savedAt: "nope",
    };
    expect(() => decodeSavedSession(backfillSavedSession(garbage))).toThrow();

    const stateRoot = mkdtempSync(join(tmpdir(), "old-sess-garbage-"));
    const stores = openPadiStateStores(stateRoot);
    stores.conf.set("session", garbage as never);
    const raw = stores.session.get() as unknown;
    expect(raw).toEqual(garbage);
  });
});

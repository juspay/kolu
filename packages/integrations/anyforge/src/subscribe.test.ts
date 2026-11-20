/// <reference types="node" />

import type { Logger } from "@kolu/log";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import type { ForgeAdapter, PrGitContext, PrResolveCause } from "./adapter.ts";
import type { PrResult } from "./schemas.ts";
import { subscribePr } from "./subscribe.ts";

function spyLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function stubAdapter(result: PrResult): ForgeAdapter {
  return { kind: "github", resolve: async () => result };
}

function ctx(overrides: Partial<PrGitContext> = {}): PrGitContext {
  return {
    repoRoot: "/repo",
    branch: "feature",
    remoteUrl: null,
    ...overrides,
  };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 50));

describe("subscribePr", () => {
  let unhandled: Mock<(reason: unknown, promise: Promise<unknown>) => void>;

  beforeEach(() => {
    unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
  });

  afterEach(() => {
    process.off("unhandledRejection", unhandled);
  });

  it("contains a throwing onChange instead of escaping as an unhandled rejection", async () => {
    const log = spyLogger();
    let calls = 0;
    const watcher = subscribePr(
      stubAdapter({ kind: "absent" }),
      () => {
        calls += 1;
        throw new Error("metadata write blew up");
      },
      log,
    );

    try {
      watcher.setGit(ctx());
      await settle();

      expect(calls).toBeGreaterThan(0);
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        "pr watcher: emit failed",
      );
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      watcher.stop();
    }
  });

  it("contains a throwing onChange on the synchronous pending emit after the watcher has left its initial pending state", async () => {
    const log = spyLogger();
    let shouldThrow = false;
    const watcher = subscribePr(
      stubAdapter({ kind: "absent" }),
      () => {
        if (shouldThrow) throw new Error("metadata write blew up");
      },
      log,
    );

    try {
      watcher.setGit(ctx());
      await settle();

      shouldThrow = true;
      expect(() =>
        watcher.setGit(ctx({ branch: "other-branch" })),
      ).not.toThrow();

      await settle();

      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        "pr watcher: emit failed",
      );
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      watcher.stop();
    }
  });

  it("contains a throwing adapter instead of escaping as an unhandled rejection", async () => {
    const log = spyLogger();
    const onChange = vi.fn();
    const watcher = subscribePr(
      {
        kind: "github",
        resolve: () => Promise.reject(new Error("adapter bug")),
      },
      onChange,
      log,
    );

    try {
      watcher.setGit(ctx());
      await settle();

      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        "pr watcher: resolve threw",
      );
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      watcher.stop();
    }
  });

  it("drops a stale in-flight resolve when the branch switches mid-flight", async () => {
    const deferred = new Map<string, (pr: PrResult) => void>();
    const adapter: ForgeAdapter = {
      kind: "github",
      resolve: (g) =>
        new Promise<PrResult>((resolve) => {
          deferred.set(g.branch, resolve);
        }),
    };
    const seen: PrResult[] = [];
    const watcher = subscribePr(adapter, (pr) => seen.push(pr));

    try {
      watcher.setGit(ctx({ branch: "A" }));
      watcher.setGit(ctx({ branch: "B" }));
      await settle();

      const prB: PrResult = {
        kind: "ok",
        value: {
          number: 2,
          title: "B",
          url: "u",
          state: "open",
          checks: null,
          checkRuns: [],
          reviewDecision: null,
          mergeStateStatus: "UNKNOWN",
          headSha: null,
          isDraft: false,
        },
      };
      deferred.get("B")?.({ ...prB });
      await settle();
      deferred.get("A")?.({
        kind: "ok",
        value: {
          number: 1,
          title: "A",
          url: "u",
          state: "open",
          checks: null,
          checkRuns: [],
          reviewDecision: null,
          mergeStateStatus: "UNKNOWN",
          headSha: null,
          isDraft: false,
        },
      });
      await settle();

      const last = seen.at(-1);
      expect(last?.kind).toBe("ok");
      if (last?.kind === "ok") expect(last.value.number).toBe(2);
    } finally {
      watcher.stop();
    }
  });

  it("drops a stale in-flight resolve when the terminal leaves the repo", async () => {
    const box: { resolve: ((pr: PrResult) => void) | null } = { resolve: null };
    const adapter: ForgeAdapter = {
      kind: "github",
      resolve: () =>
        new Promise<PrResult>((resolve) => {
          box.resolve = resolve;
        }),
    };
    const seen: PrResult[] = [];
    const watcher = subscribePr(adapter, (pr) => seen.push(pr));

    try {
      watcher.setGit(ctx());
      await settle();
      watcher.setGit(null);
      await settle();

      box.resolve?.({
        kind: "ok",
        value: {
          number: 9,
          title: "stale",
          url: "u",
          state: "open",
          checks: null,
          checkRuns: [],
          reviewDecision: null,
          mergeStateStatus: "UNKNOWN",
          headSha: null,
          isDraft: false,
        },
      });
      await settle();

      expect(seen.some((p) => p.kind === "ok")).toBe(false);
    } finally {
      watcher.stop();
    }
  });

  it("re-resolves and re-emits pending on a remoteUrl-only change", async () => {
    const seenCtx: PrGitContext[] = [];
    const seen: PrResult[] = [];
    const adapter: ForgeAdapter = {
      kind: "github",
      resolve: async (g) => {
        seenCtx.push(g);
        return { kind: "absent" };
      },
    };
    const watcher = subscribePr(adapter, (pr) => seen.push(pr));

    try {
      watcher.setGit(ctx({ remoteUrl: "https://github.com/owner/repo.git" }));
      await settle();
      const before = seenCtx.length;
      watcher.setGit(ctx({ remoteUrl: "https://codeberg.org/owner/repo.git" }));
      await settle();

      expect(seenCtx.length).toBe(before + 1);
      expect(seenCtx.at(-1)?.remoteUrl).toBe(
        "https://codeberg.org/owner/repo.git",
      );
      expect(seen.some((p) => p.kind === "pending")).toBe(true);
    } finally {
      watcher.stop();
    }
  });

  it("drops a stale in-flight resolve when the remote changes mid-flight", async () => {
    const deferred = new Map<string, (pr: PrResult) => void>();
    const adapter: ForgeAdapter = {
      kind: "github",
      resolve: (g) =>
        new Promise<PrResult>((resolve) => {
          deferred.set(g.remoteUrl ?? "", resolve);
        }),
    };
    const seen: PrResult[] = [];
    const watcher = subscribePr(adapter, (pr) => seen.push(pr));
    const remoteA = "https://github.com/owner/repo.git";
    const remoteB = "https://codeberg.org/owner/repo.git";

    try {
      watcher.setGit(ctx({ remoteUrl: remoteA }));
      watcher.setGit(ctx({ remoteUrl: remoteB }));
      await settle();

      const prB: PrResult = {
        kind: "ok",
        value: {
          number: 2,
          title: "B",
          url: "u",
          state: "open",
          checks: null,
          checkRuns: [],
          reviewDecision: null,
          mergeStateStatus: "UNKNOWN",
          headSha: null,
          isDraft: false,
        },
      };
      deferred.get(remoteB)?.({ ...prB });
      await settle();
      deferred.get(remoteA)?.({
        kind: "ok",
        value: {
          number: 1,
          title: "A",
          url: "u",
          state: "open",
          checks: null,
          checkRuns: [],
          reviewDecision: null,
          mergeStateStatus: "UNKNOWN",
          headSha: null,
          isDraft: false,
        },
      });
      await settle();

      const last = seen.at(-1);
      expect(last?.kind).toBe("ok");
      if (last?.kind === "ok") expect(last.value.number).toBe(2);
    } finally {
      watcher.stop();
    }
  });

  it("dedups an unchanged git context", async () => {
    const resolves = vi.fn(async (): Promise<PrResult> => ({ kind: "absent" }));
    const watcher = subscribePr(
      { kind: "github", resolve: resolves },
      () => {},
    );

    try {
      watcher.setGit(ctx());
      await settle();
      watcher.setGit(ctx());
      await settle();

      expect(resolves).toHaveBeenCalledTimes(1);
    } finally {
      watcher.stop();
    }
  });

  it("tells the adapter why each resolve ran: context, poll, refresh", async () => {
    vi.useFakeTimers();
    const causes: PrResolveCause[] = [];
    const watcher = subscribePr(
      {
        kind: "github",
        resolve: async (_git, cause) => {
          causes.push(cause);
          return { kind: "absent" };
        },
      },
      () => {},
    );
    try {
      watcher.setGit(ctx());
      await vi.advanceTimersByTimeAsync(30_000);
      watcher.refresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(causes).toEqual(["context", "poll", "refresh"]);
    } finally {
      watcher.stop();
      vi.useRealTimers();
    }
  });
});

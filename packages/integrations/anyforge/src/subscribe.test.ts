import type { Logger } from "kolu-shared";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import type { PrGitContext, PrProvider } from "./provider.ts";
import type { PrResult } from "./schemas.ts";
import { subscribePr } from "./subscribe.ts";

/** A `Logger` whose `error` is a spy, so we can assert the watcher contained a
 *  throwing consumer instead of letting it escape as an unhandled rejection. */
function spyLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Stub adapter resolving to a fixed result — the fixture that replaces the
 *  real gh spawn now that the loop is decoupled from any one forge. */
function stubProvider(result: PrResult): PrProvider {
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

/** Wait for in-flight micro/macro tasks to settle (the stub resolves
 *  instantly, so 50 ms is generous headroom for the floated `fetchAndEmit`
 *  to land). */
const settle = () => new Promise<void>((r) => setTimeout(r, 50));

describe("subscribePr", () => {
  // Precise mock type: a bare `ReturnType<typeof vi.fn>` widens to the
  // `Procedure | Constructable` union (a construct signature), which doesn't
  // match `process.on`'s listener overload.
  let unhandled: Mock<(reason: unknown, promise: Promise<unknown>) => void>;

  beforeEach(() => {
    unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
  });

  afterEach(() => {
    process.off("unhandledRejection", unhandled);
  });

  it("contains a throwing onChange instead of escaping as an unhandled rejection", async () => {
    // The resolve lands, then `emit` runs our `onChange` with it. We make
    // that callback throw — the shape of a metadata write blowing up — and
    // assert it is logged, not propagated. Without the try/catch inside
    // `emit` this propagates back through the floated `fetchAndEmit` as an
    // unhandled rejection that crashes the process.
    const log = spyLogger();
    let calls = 0;
    const watcher = subscribePr(
      stubProvider({ kind: "absent" }),
      () => {
        calls += 1;
        throw new Error("metadata write blew up");
      },
      log,
    );

    try {
      // Real change → pending dedup is a no-op on first call, then a floated
      // `fetchAndEmit` resolves and calls our throwing `onChange`.
      watcher.setGit(ctx());
      await settle(); // let the floated async settle

      expect(calls).toBeGreaterThan(0); // the throwing consumer ran
      expect(log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() }),
        "pr watcher: emit failed",
      );
      expect(unhandled).not.toHaveBeenCalled(); // nothing escaped
    } finally {
      watcher.stop();
    }
  });

  it("contains a throwing onChange on the synchronous pending emit after the watcher has left its initial pending state", async () => {
    // Regression for the synchronous path: `setGit` emits `{ kind: "pending" }`
    // directly (not via the floated `fetchAndEmit`). On the *first* context the
    // initial `lastPr` is already pending, so dedup suppresses it. But once a
    // resolve has driven `lastPr` to a non-pending value, a *later* branch
    // change re-emits pending through the consumer — synchronously, inside
    // `setGit`. If the boundary lived only in `fetchAndEmit`, this throw would
    // escape straight out of `setGit` into the server's `channels.git.consume`
    // and freeze the subscription. The boundary belongs on the shared `emit`.
    const log = spyLogger();
    // First, let a real resolve land so `lastPr` becomes non-pending, *without*
    // throwing yet.
    let shouldThrow = false;
    const watcher = subscribePr(
      stubProvider({ kind: "absent" }),
      () => {
        if (shouldThrow) throw new Error("metadata write blew up");
      },
      log,
    );

    try {
      watcher.setGit(ctx());
      await settle(); // resolve settles → lastPr non-pending

      // Now arm the throw and change branch. This drives the synchronous
      // pending emit through the throwing consumer.
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

  it("contains a throwing provider instead of escaping as an unhandled rejection", async () => {
    // The provider contract says resolve() never throws — guard regardless,
    // since the floated `fetchAndEmit` would otherwise turn an adapter bug
    // into a process crash.
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
    // A resolve from branch A is slow; while it's pending the terminal
    // switches to branch B and B resolves first. A's late result must NOT
    // overwrite B's — the watcher gates each emit on the current context.
    const deferred = new Map<string, (pr: PrResult) => void>();
    const provider: PrProvider = {
      kind: "github",
      resolve: (g) =>
        new Promise<PrResult>((resolve) => {
          deferred.set(g.branch, resolve);
        }),
    };
    const seen: PrResult[] = [];
    const watcher = subscribePr(provider, (pr) => seen.push(pr));

    try {
      watcher.setGit(ctx({ branch: "A" })); // floats resolve(A), still pending
      watcher.setGit(ctx({ branch: "B" })); // floats resolve(B), still pending
      await settle();

      // B resolves first with a real PR, then the stale A resolves.
      const prB: PrResult = {
        kind: "ok",
        value: {
          number: 2,
          title: "B",
          url: "u",
          state: "open",
          checks: null,
          checkRuns: [],
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
        },
      });
      await settle();

      // Last emitted value must be B's PR, never re-overwritten by A.
      const last = seen.at(-1);
      expect(last?.kind).toBe("ok");
      if (last?.kind === "ok") expect(last.value.number).toBe(2);
    } finally {
      watcher.stop();
    }
  });

  it("drops a stale in-flight resolve when the terminal leaves the repo", async () => {
    // `setGit(null)` (leaving the repo) stops polling. A resolve that was
    // in flight when we left must NOT land afterward — there is no poll to
    // correct it, so a late stale emit would persist forever.
    // A boxed resolver — a plain `let` would be narrowed to `null` at the
    // call site because TS can't see the executor closure assign it.
    const box: { resolve: ((pr: PrResult) => void) | null } = { resolve: null };
    const provider: PrProvider = {
      kind: "github",
      resolve: () =>
        new Promise<PrResult>((resolve) => {
          box.resolve = resolve;
        }),
    };
    const seen: PrResult[] = [];
    const watcher = subscribePr(provider, (pr) => seen.push(pr));

    try {
      watcher.setGit(ctx()); // floats a resolve, still pending
      await settle();
      watcher.setGit(null); // leave the repo → emits pending, polling stops
      await settle();

      // The stale resolve lands after we've left.
      box.resolve?.({
        kind: "ok",
        value: {
          number: 9,
          title: "stale",
          url: "u",
          state: "open",
          checks: null,
          checkRuns: [],
        },
      });
      await settle();

      // The terminal left the repo: the stale `ok` must never reach the
      // consumer. (Both pending emits dedup against the watcher's initial
      // pending state, so the consumer legitimately sees nothing at all — the
      // load-bearing assertion is that no PR landed.)
      expect(seen.some((p) => p.kind === "ok")).toBe(false);
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
      watcher.setGit(ctx()); // same repoRoot/branch — a no-op
      await settle();

      expect(resolves).toHaveBeenCalledTimes(1);
    } finally {
      watcher.stop();
    }
  });
});

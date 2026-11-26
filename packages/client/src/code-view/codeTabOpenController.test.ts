import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { Deferred, Effect } from "effect";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
} from "solid-js";
import { describe, expect, it, vi } from "vitest";

// The REAL right-panel selection writer is the landing this controller's
// `onResolved` reaches in the product (`CodeTab`'s `finishOpenRequest` →
// `select`), and the write is the subject here — so it is driven, not spied.
// It needs the three singletons the panel reads: the wire's per-terminal
// report, the focused terminal, and the tile count.
const panel = vi.hoisted(() => ({
  activeId: null as string | null,
  setRightPanel: vi.fn(() => Effect.void),
}));

vi.mock("../wire", () => ({
  activePadiRpc: { chrome: { setRightPanel: panel.setRightPanel } },
  activeHost: () => "host-A",
  padiRpcOf: () => ({ chrome: { setRightPanel: panel.setRightPanel } }),
  updatePreferences: () => {},
  preferences: () => ({
    newTerminalCollapsed: false,
    rightPanel: { size: 0.25, codeTabTreeSize: 0.35 },
  }),
}));
vi.mock("../terminal/useTerminalStore", async () => {
  // Bound here: a `vi.mock` factory is hoisted above this file's imports.
  const { createSignal, flush } = await import("solid-js");
  const [activeId, setActiveId] = createSignal<string | null>(null);
  Object.defineProperty(panel, "activeId", {
    get: activeId,
    set: (value: string | null) => {
      setActiveId(() => value);
      flush();
    },
    configurable: true,
  });
  return {
    useTerminalStore: () => ({
      activeId,
      focusedTerminalId: activeId,
      getMetadata: () => undefined,
    }),
  };
});
vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({ tileCount: () => (panel.activeId ? 1 : 0) }),
}));
vi.mock("solid-sonner", () => ({ toast: { error: () => {} } }));

import { useRightPanel } from "../right-panel/useRightPanel";
import {
  codeOwner,
  codeTabSelectionInventoryVerdict,
  type CodeTabOpenSnapshot,
  type CodeTabScope,
  createCodeTabOpenController,
  type OpenInCodeTabRequest,
} from "./codeTabOpenController";

const scope = (terminalId: string): CodeTabScope => ({
  host: { kind: "local" },
  owner: codeOwner("pane", terminalId),
  repoRoot: "/repo",
  mode: "browse",
});

const request = (terminalId: string): OpenInCodeTabRequest => ({
  scope: scope(terminalId),
  ref: { path: "new.ts", startLine: 1, endLine: 1 },
});

/** One microtask, then the settle pass. Every landing verb writes from
 *  `onSettled` (see `complete`), so a fresh read that answers on its own
 *  fiber lands in the flush the settle enqueued — which is a microtask away
 *  in the app and is taken here by hand. */
const tick = async (): Promise<void> => {
  await Promise.resolve();
  flush();
};

/** The `readFresh` seam takes a DESCRIPTION now, so a fixture that must be
 *  settled BY HAND parks on a `Deferred` instead of holding a `resolve`. The
 *  plain-value fixtures stay written as async bodies — a throw is the readable
 *  way to state "this read fails" — with `Effect.tryPromise` turning it into the
 *  error channel the controller reads. */
function asEffect<R>(
  fn: (request: OpenInCodeTabRequest, from: Snapshot) => Promise<R>,
): (
  request: OpenInCodeTabRequest,
  from: Snapshot,
) => Effect.Effect<R, unknown> {
  return (request, from) =>
    Effect.tryPromise({
      try: () => fn(request, from),
      // Pass the thrown value THROUGH: these fixtures state a failure by
      // throwing the exact error the assertion reads, and `tryPromise`'s default
      // wrap would hide it behind an `UnknownError`.
      catch: (e) => e,
    });
}

type Paths = readonly string[];
type Snapshot = CodeTabOpenSnapshot<Paths>;

function createHarness(options?: {
  snapshot?: Partial<Snapshot>;
  readFresh?: (
    request: OpenInCodeTabRequest,
    from: Snapshot,
  ) => Effect.Effect<Paths, unknown>;
}) {
  const req = request("t1");
  const [snapshot, setSnapshot] = createSignal<Snapshot>({
    request: req,
    scope: req.scope,
    inventoryScope: req.scope,
    paths: [],
    inventoryPending: false,
    includeIgnored: false,
    lister: "git",
    ...options?.snapshot,
  });
  const readFresh = vi.fn(options?.readFresh ?? asEffect(async () => []));
  const onResolved = vi.fn();
  const onNotFound = vi.fn();
  const onError = vi.fn();
  const dispose = createRoot((dispose) => {
    createCodeTabOpenController<Paths, string>({
      snapshot,
      resolve: (_request, paths) =>
        paths.includes("new.ts") ? "new.ts" : null,
      readFresh,
      onResolved,
      onNotFound,
      onError,
    });
    return dispose;
  });
  return {
    req,
    readFresh,
    onResolved,
    onNotFound,
    onError,
    patchSnapshot: (patch: Partial<Snapshot>) =>
      setSnapshot((current) => ({ ...current, ...patch })),
    dispose,
  };
}

describe("createCodeTabOpenController", () => {
  it("labels retained and fresh resolutions", async () => {
    const retained = createHarness({ snapshot: { paths: ["new.ts"] } });
    await tick();
    expect(retained.onResolved).toHaveBeenCalledWith(
      retained.req,
      "new.ts",
      "inventory",
    );
    retained.dispose();

    const fresh = createHarness({
      readFresh: asEffect(async () => ["new.ts"]),
    });
    await tick();
    await tick();
    expect(fresh.onResolved).toHaveBeenCalledWith(fresh.req, "new.ts", "fresh");
    fresh.dispose();
  });

  it("lands a fresh read that answers at once, without subscribing the landing to the snapshot", async () => {
    // A read whose description needs no suspension (a cached or in-process
    // listing) lands INSIDE the effect phase that forked it — a strict-read
    // window. The currency check reads the snapshot there, as a point-in-time
    // fact; read reactively it would raise STRICT_READ_UNTRACKED and, worse,
    // claim a dependency for a computation that has already run.
    const h = createHarness({
      readFresh: () => Effect.succeed(["new.ts"] as Paths),
    });
    await tick();
    expect(h.onResolved).toHaveBeenCalledWith(h.req, "new.ts", "fresh");
    h.dispose();
  });

  it("waits through null and mismatched scope, then resolves on the owner", async () => {
    const h = createHarness({ snapshot: { scope: null } });
    await tick();
    expect(h.readFresh).not.toHaveBeenCalled();

    h.patchSnapshot({ scope: scope("t2") });
    await tick();
    expect(h.readFresh).not.toHaveBeenCalled();
    expect(h.onNotFound).not.toHaveBeenCalled();

    h.patchSnapshot({ scope: h.req.scope, paths: ["new.ts"] });
    await tick();
    expect(h.onResolved).toHaveBeenCalledOnce();
    expect(h.onResolved).toHaveBeenCalledWith(h.req, "new.ts", "inventory");
    h.dispose();
  });

  it("resolves a retained inventory hit without a fresh read", async () => {
    const h = createHarness({ snapshot: { paths: ["new.ts"] } });
    await tick();
    expect(h.onResolved).toHaveBeenCalledOnce();
    expect(h.readFresh).not.toHaveBeenCalled();
    h.dispose();
  });

  it("does not resolve retained paths stamped for another owner", async () => {
    const h = createHarness({
      snapshot: {
        inventoryScope: scope("t2"),
        paths: ["new.ts"],
      },
      readFresh: asEffect(async () => []),
    });
    await tick();
    await tick();
    expect(h.readFresh).toHaveBeenCalledOnce();
    expect(h.onResolved).not.toHaveBeenCalled();
    expect(h.onNotFound).toHaveBeenCalledOnce();
    h.dispose();
  });

  it("resolves a retained miss from the fresh inventory", async () => {
    const h = createHarness({ readFresh: asEffect(async () => ["new.ts"]) });
    await tick();
    await tick();
    expect(h.readFresh).toHaveBeenCalledOnce();
    expect(h.onResolved).toHaveBeenCalledOnce();
    expect(h.onNotFound).not.toHaveBeenCalled();
    h.dispose();
  });

  it("consumes a confirmed fresh miss as not found", async () => {
    const h = createHarness({ readFresh: asEffect(async () => []) });
    await tick();
    await tick();
    expect(h.onNotFound).toHaveBeenCalledOnce();
    expect(h.onResolved).not.toHaveBeenCalled();
    h.dispose();
  });

  it("consumes a current fresh-read error exactly once", async () => {
    const failure = new Error("fresh inventory failed");
    const h = createHarness({
      readFresh: asEffect(async () => {
        throw failure;
      }),
    });
    await tick();
    await tick();
    expect(h.onError).toHaveBeenCalledOnce();
    expect(h.onError).toHaveBeenCalledWith(h.req, failure);

    h.patchSnapshot({ paths: ["new.ts"] });
    await tick();
    expect(h.onResolved).not.toHaveBeenCalled();
    h.dispose();
  });

  it("waits for the retained inventory before starting a fresh read", async () => {
    const h = createHarness({ snapshot: { inventoryPending: true } });
    await tick();
    expect(h.readFresh).not.toHaveBeenCalled();

    h.patchSnapshot({ inventoryPending: false });
    await tick();
    expect(h.readFresh).toHaveBeenCalledOnce();
    h.dispose();
  });

  it("retires a late fresh read when the owning terminal changes", async () => {
    const req = request("t1");
    const [currentScope, setCurrentScope] = createSignal<CodeTabScope | null>(
      req.scope,
    );
    const onResolved = vi.fn();
    const gate = Deferred.makeUnsafe<readonly string[]>();

    const dispose = createRoot((dispose) => {
      createCodeTabOpenController<readonly string[], string>({
        snapshot: (): CodeTabOpenSnapshot<readonly string[]> => ({
          request: req,
          scope: currentScope(),
          inventoryScope: req.scope,
          paths: [],
          inventoryPending: false,
          includeIgnored: false,
          lister: "git",
        }),
        resolve: (_request, paths) =>
          paths.includes("new.ts") ? "new.ts" : null,
        readFresh: () => Deferred.await(gate),
        onResolved,
        onNotFound: vi.fn(),
        onError: vi.fn(),
      });
      return dispose;
    });

    await tick();
    setCurrentScope(scope("t2"));
    await tick();

    // The retirement is asserted on the OUTCOME, not on an abort flag: the read
    // carries no cancellation token any more (a padi call takes none under
    // Effect, D10/#18), so what must hold is that a late answer owns nothing.
    Deferred.doneUnsafe(gate, Effect.succeed(["new.ts"]));
    await tick();
    expect(onResolved).not.toHaveBeenCalled();
    dispose();
  });

  it("makes ignored-file policy part of the fresh attempt identity", async () => {
    const req = request("t1");
    const [includeIgnored, setIncludeIgnored] = createSignal(false);
    const reads: Array<{
      includeIgnored: boolean;
      settle: (paths: readonly string[]) => void;
    }> = [];
    const onResolved = vi.fn();

    const dispose = createRoot((dispose) => {
      createCodeTabOpenController<readonly string[], string>({
        snapshot: () => ({
          request: req,
          scope: req.scope,
          inventoryScope: req.scope,
          paths: [],
          inventoryPending: false,
          includeIgnored: includeIgnored(),
          lister: "git",
        }),
        resolve: (_request, paths) =>
          paths.includes("new.ts") ? "new.ts" : null,
        readFresh: (_request, from) => {
          const gate = Deferred.makeUnsafe<readonly string[]>();
          reads.push({
            includeIgnored: from.includeIgnored,
            settle: (paths) => {
              Deferred.doneUnsafe(gate, Effect.succeed(paths));
            },
          });
          return Deferred.await(gate);
        },
        onResolved,
        onNotFound: vi.fn(),
        onError: vi.fn(),
      });
      return dispose;
    });

    await tick();
    expect(reads.map((read) => read.includeIgnored)).toEqual([false]);

    setIncludeIgnored(true);
    await tick();
    expect(reads.map((read) => read.includeIgnored)).toEqual([false, true]);

    reads[0]?.settle(["new.ts"]);
    await tick();
    expect(onResolved).not.toHaveBeenCalled();

    reads[1]?.settle(["new.ts"]);
    await tick();
    expect(onResolved).toHaveBeenCalledOnce();
    dispose();
  });
});

/** THE LANDING'S PHASE, over the real selection writer.
 *
 *  The controller's compute reads the retained inventory, the scope and the
 *  mode; its landing writes the pane's selection, which is one of the roots
 *  those facts are keyed on. So every reader that takes BOTH — the Code tab's
 *  per-mode frame, the browse query's input — ran mid-flush against the facts
 *  the arm was answering and again after the write, unless the landing is
 *  settled. `EFFECT_RELAY_TEAR` is advisory on its first sighting and `warn`
 *  from the third, so these drive five opens and assert the judge is EMPTY —
 *  red at the first sighting, not the third. */
describe("createCodeTabOpenController — the landing writes settled", () => {
  const PICKS = ["one.ts", "two.ts", "three.ts", "four.ts", "five.ts"];

  /** A pane with a standing pick, and a reader of both the snapshot's own
   *  root and the selection leaf the landing writes — the victim. */
  const pane = (tile: string) => {
    panel.activeId = tile;
    const rp = useRightPanel();
    rp.code.setSelectedFile("browse", "seed.ts");
    flush();
    const paneScope: CodeTabScope = {
      host: { kind: "local" },
      owner: codeOwner("pane", tile),
      repoRoot: "/repo",
      mode: "browse",
    };
    const [snapshot, setSnapshot] = createSignal<Snapshot>({
      request: null,
      scope: paneScope,
      inventoryScope: paneScope,
      paths: ["seed.ts"],
      inventoryPending: false,
      includeIgnored: false,
      lister: "git",
    });
    const open = (path: string) => {
      setSnapshot((current) => ({
        ...current,
        paths: [...current.paths, path],
        request: { scope: paneScope, ref: { path, startLine: 1, endLine: 1 } },
      }));
      flush();
    };
    const watch = () =>
      createEffect(
        createMemo(
          () => `${snapshot().paths.length}|${rp.code.selectedFile("browse")}`,
          { name: "shownFrame" },
        ),
        () => {},
        { name: "paintShownFrame" },
      );
    return { rp, snapshot, open, watch };
  };

  it("lands its outcome off the arm's own frame, over the real selection writer", () => {
    const { rp, snapshot, open, watch } = pane("open-settled-tile");
    const dispose = createRoot((dispose) => {
      watch();
      createCodeTabOpenController<Paths, string>({
        snapshot,
        resolve: (request, paths) =>
          paths.includes(request.ref.path) ? request.ref.path : null,
        readFresh: asEffect(async () => []),
        // The product's landing: `CodeTab`'s `finishOpenRequest` → `select` →
        // the right panel's per-key selection write.
        onResolved: (_request, resolved) => {
          rp.code.setSelectedFile("browse", resolved);
        },
        onNotFound: () => {},
        onError: () => {},
      });
      return dispose;
    });
    flush();

    for (const path of PICKS) open(path);

    expect(rp.code.selectedFile("browse")).toBe("five.ts");
    expect(takeSolidDiagnostics()).toEqual([]);
    dispose();
  });

  it("tears when the same landing is written from the arm itself", () => {
    // THE CONTROL, so the case above cannot become a sleeping detector: the
    // same five opens and the same victim, with the landing written inline
    // from an effect's apply arm instead of settled out of it.
    const { rp, snapshot, open, watch } = pane("open-inline-tile");
    const dispose = createRoot((dispose) => {
      watch();
      createEffect(
        snapshot,
        (current) => {
          const path = current.request?.ref.path;
          if (path !== undefined && current.paths.includes(path))
            rp.code.setSelectedFile("browse", path);
        },
        { name: "inlinedLanding" },
      );
      return dispose;
    });
    flush();

    for (const path of PICKS) open(path);

    expect(rp.code.selectedFile("browse")).toBe("five.ts");
    const tears = takeSolidDiagnostics().filter(
      (event) => event.code === "EFFECT_RELAY_TEAR",
    );
    expect(tears.length).toBeGreaterThan(0);
    expect(tears.some((event) => event.message.includes("perTerminal"))).toBe(
      true,
    );
    dispose();
  });
});

describe("codeTabSelectionInventoryVerdict", () => {
  it("pins a freshly resolved path until the retained inventory catches up", () => {
    expect(
      codeTabSelectionInventoryVerdict("new.ts", false, [], "new.ts"),
    ).toBe("keep");
    expect(
      codeTabSelectionInventoryVerdict("new.ts", false, ["new.ts"], "new.ts"),
    ).toBe("confirm-fresh");
    expect(codeTabSelectionInventoryVerdict("new.ts", false, [], null)).toBe(
      "clear",
    );
  });

  it("keeps any selection while its inventory is pending", () => {
    expect(codeTabSelectionInventoryVerdict("old.ts", true, [], null)).toBe(
      "keep",
    );
  });
});

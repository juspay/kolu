import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import {
  codeTabSelectionInventoryVerdict,
  type CodeTabOpenSnapshot,
  type CodeTabScope,
  createCodeTabOpenController,
  type OpenInCodeTabRequest,
} from "./codeTabOpenController";

const scope = (terminalId: string): CodeTabScope => ({
  host: { kind: "local" },
  terminalId,
  repoRoot: "/repo",
  mode: "browse",
});

const request = (terminalId: string): OpenInCodeTabRequest => ({
  scope: scope(terminalId),
  ref: { path: "new.ts", startLine: 1, endLine: 1 },
});

const tick = () => Promise.resolve();

type Paths = readonly string[];
type Snapshot = CodeTabOpenSnapshot<Paths>;

function createHarness(options?: {
  snapshot?: Partial<Snapshot>;
  readFresh?: (
    request: OpenInCodeTabRequest,
    includeIgnored: boolean,
  ) => Promise<Paths>;
}) {
  const req = request("t1");
  const [snapshot, setSnapshot] = createSignal<Snapshot>({
    request: req,
    scope: req.scope,
    inventoryScope: req.scope,
    paths: [],
    inventoryPending: false,
    includeIgnored: false,
    ...options?.snapshot,
  });
  const readFresh = vi.fn(options?.readFresh ?? (async () => []));
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

    const fresh = createHarness({ readFresh: async () => ["new.ts"] });
    await tick();
    await tick();
    expect(fresh.onResolved).toHaveBeenCalledWith(fresh.req, "new.ts", "fresh");
    fresh.dispose();
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
      readFresh: async () => [],
    });
    await tick();
    await tick();
    expect(h.readFresh).toHaveBeenCalledOnce();
    expect(h.onResolved).not.toHaveBeenCalled();
    expect(h.onNotFound).toHaveBeenCalledOnce();
    h.dispose();
  });

  it("resolves a retained miss from the fresh inventory", async () => {
    const h = createHarness({ readFresh: async () => ["new.ts"] });
    await tick();
    await tick();
    expect(h.readFresh).toHaveBeenCalledOnce();
    expect(h.onResolved).toHaveBeenCalledOnce();
    expect(h.onNotFound).not.toHaveBeenCalled();
    h.dispose();
  });

  it("consumes a confirmed fresh miss as not found", async () => {
    const h = createHarness({ readFresh: async () => [] });
    await tick();
    await tick();
    expect(h.onNotFound).toHaveBeenCalledOnce();
    expect(h.onResolved).not.toHaveBeenCalled();
    h.dispose();
  });

  it("consumes a current fresh-read error exactly once", async () => {
    const failure = new Error("fresh inventory failed");
    const h = createHarness({
      readFresh: async () => {
        throw failure;
      },
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
    let settle: (paths: readonly string[]) => void = () => {};

    const dispose = createRoot((dispose) => {
      createCodeTabOpenController<readonly string[], string>({
        snapshot: (): CodeTabOpenSnapshot<readonly string[]> => ({
          request: req,
          scope: currentScope(),
          inventoryScope: req.scope,
          paths: [],
          inventoryPending: false,
          includeIgnored: false,
        }),
        resolve: (_request, paths) =>
          paths.includes("new.ts") ? "new.ts" : null,
        readFresh: () =>
          new Promise((resolve) => {
            settle = resolve;
          }),
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
    settle(["new.ts"]);
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
        }),
        resolve: (_request, paths) =>
          paths.includes("new.ts") ? "new.ts" : null,
        readFresh: (_request, policy) =>
          new Promise((resolve) => {
            reads.push({ includeIgnored: policy, settle: resolve });
          }),
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

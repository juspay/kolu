import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import {
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

describe("createCodeTabOpenController", () => {
  it("retires a late fresh read when the owning terminal changes", async () => {
    const req = request("t1");
    const [currentScope, setCurrentScope] = createSignal<CodeTabScope | null>(
      req.scope,
    );
    const onResolved = vi.fn();
    let settle: (paths: readonly string[]) => void = () => {};
    const freshSignals: AbortSignal[] = [];

    const dispose = createRoot((dispose) => {
      createCodeTabOpenController<readonly string[], string>({
        snapshot: (): CodeTabOpenSnapshot<readonly string[]> => ({
          request: req,
          scope: currentScope(),
          paths: [],
          inventoryPending: false,
          includeIgnored: false,
        }),
        resolve: (_request, paths) =>
          paths.includes("new.ts") ? "new.ts" : null,
        readFresh: (_request, _includeIgnored, signal) => {
          freshSignals.push(signal);
          return new Promise((resolve) => {
            settle = resolve;
          });
        },
        onResolved,
        onNotFound: vi.fn(),
        onError: vi.fn(),
      });
      return dispose;
    });

    await tick();
    setCurrentScope(scope("t2"));
    await tick();
    expect(freshSignals[0]?.aborted).toBe(true);

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
      signal: AbortSignal;
      settle: (paths: readonly string[]) => void;
    }> = [];
    const onResolved = vi.fn();

    const dispose = createRoot((dispose) => {
      createCodeTabOpenController<readonly string[], string>({
        snapshot: () => ({
          request: req,
          scope: req.scope,
          paths: [],
          inventoryPending: false,
          includeIgnored: includeIgnored(),
        }),
        resolve: (_request, paths) =>
          paths.includes("new.ts") ? "new.ts" : null,
        readFresh: (_request, policy, signal) =>
          new Promise((resolve) => {
            reads.push({ includeIgnored: policy, signal, settle: resolve });
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
    expect(reads[0]?.signal.aborted).toBe(true);
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

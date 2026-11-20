import type { CodeTabView } from "@kolu/padi-client/surface";
import { Effect, type Fiber } from "effect";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, onCleanup } from "solid-js";
import { match } from "ts-pattern";
import { runOwnedAction } from "../runAction";
import type { LineRef } from "../ui/lineRef";

export interface CodeTabScope {
  host: HostKey;
  terminalId: TerminalId;
  repoRoot: string;
  mode: CodeTabView;
}

export function codeTabScopesEqual(a: CodeTabScope, b: CodeTabScope): boolean {
  const left = codeTabScopeIdentity(a);
  const right = codeTabScopeIdentity(b);
  return left.every((value, index) => value === right[index]);
}

export type RepoSlot = Pick<CodeTabScope, "host" | "repoRoot" | "mode">;

export function codeTabRepoSlotKey(slot: RepoSlot | null): string | null {
  return slot === null
    ? null
    : JSON.stringify([encodeHostKey(slot.host), slot.repoRoot, slot.mode]);
}

function codeTabScopeIdentity(
  scope: CodeTabScope,
): readonly [string, TerminalId, string, CodeTabView] {
  return [
    encodeHostKey(scope.host),
    scope.terminalId,
    scope.repoRoot,
    scope.mode,
  ];
}

export interface OpenInCodeTabRequest {
  scope: CodeTabScope;
  ref: LineRef;
  cwd?: string;
  allowBasenameFallback?: boolean;
}

export interface CodeTabOpenSnapshot<Paths> {
  request: OpenInCodeTabRequest | null;
  scope: CodeTabScope | null;
  inventoryScope: CodeTabScope | null;
  paths: Paths;
  inventoryPending: boolean;
  includeIgnored: boolean;
}

interface CodeTabOpenControllerOptions<Paths, Resolved> {
  snapshot: () => CodeTabOpenSnapshot<Paths>;
  resolve: (request: OpenInCodeTabRequest, paths: Paths) => Resolved | null;
  readFresh: (
    request: OpenInCodeTabRequest,
    includeIgnored: boolean,
  ) => Effect.Effect<Paths, unknown>;
  onResolved: (
    request: OpenInCodeTabRequest,
    resolved: Resolved,
    source: CodeTabOpenResolutionSource,
  ) => void;
  onNotFound: (request: OpenInCodeTabRequest) => void;
  onError: (request: OpenInCodeTabRequest, error: Error) => void;
}

export type CodeTabOpenResolutionSource = "inventory" | "fresh";

export type CodeTabSelectionInventoryVerdict =
  | "keep"
  | "confirm-fresh"
  | "clear";

export function codeTabSelectionInventoryVerdict(
  selectedPath: string | null,
  inventoryPending: boolean,
  inventoryPaths: readonly string[],
  freshSelectionPath: string | null,
): CodeTabSelectionInventoryVerdict {
  if (selectedPath === null || inventoryPending) return "keep";
  if (inventoryPaths.includes(selectedPath)) {
    return freshSelectionPath === selectedPath ? "confirm-fresh" : "keep";
  }
  return freshSelectionPath === selectedPath ? "keep" : "clear";
}

interface RetirableFiber {
  readonly retired: boolean;
  hold: (fiber: Fiber.Fiber<unknown, never>) => void;
  retire: () => void;
}

function createRetirableFiber(): RetirableFiber {
  let held: Fiber.Fiber<unknown, never> | null = null;
  let retired = false;
  return {
    get retired(): boolean {
      return retired;
    },
    hold: (fiber) => {
      if (retired) fiber.interruptUnsafe();
      else held = fiber;
    },
    retire: () => {
      retired = true;
      held?.interruptUnsafe();
      held = null;
    },
  };
}

type OpenAttempt =
  | { kind: "idle" }
  | {
      kind: "refreshing";
      request: OpenInCodeTabRequest;
      includeIgnored: boolean;
      fiber: RetirableFiber;
    }
  | { kind: "complete"; request: OpenInCodeTabRequest };

export function createCodeTabOpenController<Paths, Resolved>(
  options: CodeTabOpenControllerOptions<Paths, Resolved>,
): void {
  let attempt: OpenAttempt = { kind: "idle" };

  const refreshingAttempt = (): Extract<
    OpenAttempt,
    { kind: "refreshing" }
  > | null =>
    match(attempt)
      .with({ kind: "refreshing" }, (refreshing) => refreshing)
      .otherwise(() => null);

  const stopRefreshing = (): void => {
    const refreshing = refreshingAttempt();
    if (refreshing === null) return;
    refreshing.fiber.retire();
  };

  const retire = (): void => {
    stopRefreshing();
    attempt = { kind: "idle" };
  };

  const complete = (request: OpenInCodeTabRequest, apply: () => void): void => {
    stopRefreshing();
    attempt = { kind: "complete", request };
    apply();
  };

  const stillOwnsLatestIntent = (
    request: OpenInCodeTabRequest,
    includeIgnored: boolean,
    fiber: RetirableFiber,
  ): boolean => {
    const refreshing = refreshingAttempt();
    if (
      refreshing === null ||
      refreshing.request !== request ||
      refreshing.includeIgnored !== includeIgnored ||
      refreshing.fiber !== fiber ||
      fiber.retired
    ) {
      return false;
    }
    const current = options.snapshot();
    return (
      current.request === request &&
      current.scope !== null &&
      codeTabScopesEqual(current.scope, request.scope) &&
      current.includeIgnored === includeIgnored
    );
  };

  createEffect(() => {
    const current = options.snapshot();
    const request = current.request;

    if (request === null) {
      retire();
      return;
    }
    if (
      match(attempt)
        .with(
          { kind: "complete" },
          (completeAttempt) => completeAttempt.request === request,
        )
        .otherwise(() => false)
    )
      return;

    if (
      current.scope === null ||
      !codeTabScopesEqual(current.scope, request.scope)
    ) {
      retire();
      return;
    }

    const refreshing = refreshingAttempt();
    if (
      refreshing !== null &&
      (refreshing.request !== request ||
        refreshing.includeIgnored !== current.includeIgnored ||
        current.inventoryPending)
    ) {
      retire();
    }

    if (current.inventoryPending) return;

    if (
      current.inventoryScope !== null &&
      codeTabScopesEqual(current.inventoryScope, request.scope)
    ) {
      const resolved = options.resolve(request, current.paths);
      if (resolved !== null) {
        complete(request, () =>
          options.onResolved(request, resolved, "inventory"),
        );
        return;
      }
    }

    if (refreshingAttempt() !== null) return;

    const includeIgnored = current.includeIgnored;
    const fiber = createRetirableFiber();
    attempt = { kind: "refreshing", request, includeIgnored, fiber };
    fiber.hold(
      runOwnedAction(
        "open in code tab",
        options.readFresh(request, includeIgnored).pipe(
          Effect.map((paths) => () => {
            const freshResolved = options.resolve(request, paths);
            if (freshResolved === null) {
              complete(request, () => options.onNotFound(request));
              return;
            }
            complete(request, () =>
              options.onResolved(request, freshResolved, "fresh"),
            );
          }),
          Effect.catch((raw) =>
            Effect.succeed(() => {
              const error = raw instanceof Error ? raw : new Error(String(raw));
              complete(request, () => options.onError(request, error));
            }),
          ),
          Effect.tap((land) =>
            Effect.sync(() => {
              if (stillOwnsLatestIntent(request, includeIgnored, fiber)) land();
            }),
          ),
        ),
      ),
    );
  });

  onCleanup(retire);
}

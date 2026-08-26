import type { CodeTabView } from "@kolu/padi-client/surface";
import { Effect, type Fiber } from "effect";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, onCleanup } from "solid-js";
import { match } from "ts-pattern";
import { runOwnedAction } from "../runAction";
import type { LineRef } from "../ui/lineRef";

/** The complete owner of a Code-tab selection slot and open request. */
export interface CodeTabScope {
  host: HostKey;
  terminalId: TerminalId;
  repoRoot: string;
  mode: CodeTabView;
}

/** Stable equality for the complete owner of a Code-tab request. */
export function codeTabScopesEqual(a: CodeTabScope, b: CodeTabScope): boolean {
  const left = codeTabScopeIdentity(a);
  const right = codeTabScopeIdentity(b);
  return left.every((value, index) => value === right[index]);
}

/** Collision-safe key for state that is scoped to one Code-tab owner. */
export function codeTabScopeKey(scope: CodeTabScope | null): string | null {
  return scope === null ? null : JSON.stringify(codeTabScopeIdentity(scope));
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

/** A captured user intent to navigate one exact Code-tab owner to a file ref. */
export interface OpenInCodeTabRequest {
  /** The exact host + terminal + repository + mode allowed to consume this request. */
  scope: CodeTabScope;
  /** Parsed `path:line[-end]` to navigate to. */
  ref: LineRef;
  /** Terminal cwd at dispatch time, for cwd-relative references. */
  cwd?: string;
  /** Whether a unique-basename match may resolve an otherwise missing path. */
  allowBasenameFallback?: boolean;
}

/** Current reactive facts used to decide whether and how a request may land. */
export interface CodeTabOpenSnapshot<Paths> {
  request: OpenInCodeTabRequest | null;
  scope: CodeTabScope | null;
  /** Owner stamped on the retained inventory, or null when it is unscoped. */
  inventoryScope: CodeTabScope | null;
  paths: Paths;
  inventoryPending: boolean;
  includeIgnored: boolean;
}

interface CodeTabOpenControllerOptions<Paths, Resolved> {
  snapshot: () => CodeTabOpenSnapshot<Paths>;
  resolve: (request: OpenInCodeTabRequest, paths: Paths) => Resolved | null;
  /** Read the authoritative inventory for this request — a DESCRIPTION, so this
   *  controller cancels a superseded read by interrupting its fiber. It takes no
   *  cancellation token because it no longer needs one: cancellation IS
   *  interruption (D10/#18).
   *
   *  Interruption does not REPLACE the `isCurrent` gate below, and must not: it
   *  is asynchronous, so a read already past its last suspension can still
   *  answer after the interrupt is requested. The gate is what refuses that
   *  answer. Two mechanisms, two jobs — stop the work, and refuse a stale
   *  result. */
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

/**
 * Reconcile the selected file with the retained tree inventory.
 *
 * A direct fresh read can resolve a just-created file before the retained tree
 * catches up. That fresh verdict pins the selection through the stale window;
 * once the retained inventory contains the path, the pin is consumed and later
 * removal is authoritative again.
 */
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

type OpenAttempt =
  | { kind: "idle" }
  | {
      kind: "refreshing";
      request: OpenInCodeTabRequest;
      includeIgnored: boolean;
      /** The read's own fiber — interrupting it IS the cancel. A mutable slot
       *  because the attempt is recorded BEFORE the fork: `Effect.runFork` runs
       *  on the calling stack until the effect suspends, so a read that answers
       *  without suspending (an in-process double) would otherwise land against
       *  an attempt this line had not yet stored, and be discarded as stale. */
      fiber: { current: Fiber.Fiber<unknown, never> | null };
      /** Latched by `retire`/`complete` BEFORE the interrupt, so a frame already
       *  queued behind the interruption is still refused. */
      retired: { value: boolean };
    }
  | { kind: "complete"; request: OpenInCodeTabRequest };

/**
 * Own the consume-once, latest-request-wins lifecycle for Code-tab opens.
 *
 * The presenter supplies current facts and atomic outcome verbs. This controller
 * alone owns request identity, cancellation, retained-then-fresh resolution,
 * and the final consume-once verdict.
 */
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

  /** Stop the live read: latch it retired FIRST, then interrupt. The order is
   *  the point — the latch is synchronous and the interrupt is not, so the
   *  window between them is exactly where a late frame would otherwise land. */
  const stopRefreshing = (): void => {
    const refreshing = refreshingAttempt();
    if (refreshing === null) return;
    refreshing.retired.value = true;
    refreshing.fiber.current?.interruptUnsafe();
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

  const isCurrent = (
    request: OpenInCodeTabRequest,
    includeIgnored: boolean,
    token: { value: boolean },
  ): boolean => {
    const refreshing = refreshingAttempt();
    if (
      refreshing === null ||
      refreshing.request !== request ||
      refreshing.includeIgnored !== includeIgnored ||
      refreshing.retired !== token ||
      token.value
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
      // A scope mismatch can be transient: the producer may have selected a
      // different terminal in the same batch, while this consumer still sees
      // the prior projection. Abort work tied to the departed scope, but keep
      // the latest request eligible for the matching scope to arrive.
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
    const retired = { value: false };
    const fiber: { current: Fiber.Fiber<unknown, never> | null } = {
      current: null,
    };
    attempt = { kind: "refreshing", request, includeIgnored, fiber, retired };
    // The whole read AND its landing live on one fiber, so interrupting it stops
    // both. Recovered to a total program before the fork: the outcome is applied
    // by `complete`, which is this controller's one landing verb.
    fiber.current = runOwnedAction(
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
            // A superseded read no longer belongs to the latest user intent; its
            // answer — success OR failure — must not land over the replacement
            // request. Checked HERE, after the read, because interruption alone
            // cannot guarantee this frame never runs.
            if (isCurrent(request, includeIgnored, retired)) land();
          }),
        ),
      ),
    );
  });

  onCleanup(retire);
}

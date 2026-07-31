import type { CodeTabView } from "@kolu/padi/surface";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, onCleanup } from "solid-js";
import { match } from "ts-pattern";
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
  readFresh: (
    request: OpenInCodeTabRequest,
    includeIgnored: boolean,
    signal: AbortSignal,
  ) => Promise<Paths>;
  onResolved: (request: OpenInCodeTabRequest, resolved: Resolved) => void;
  onNotFound: (request: OpenInCodeTabRequest) => void;
  onError: (request: OpenInCodeTabRequest, error: Error) => void;
}

type OpenAttempt =
  | { kind: "idle" }
  | {
      kind: "refreshing";
      request: OpenInCodeTabRequest;
      includeIgnored: boolean;
      controller: AbortController;
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

  const retire = (): void => {
    refreshingAttempt()?.controller.abort();
    attempt = { kind: "idle" };
  };

  const complete = (request: OpenInCodeTabRequest, apply: () => void): void => {
    refreshingAttempt()?.controller.abort();
    attempt = { kind: "complete", request };
    apply();
  };

  const isCurrent = (
    request: OpenInCodeTabRequest,
    includeIgnored: boolean,
    controller: AbortController,
  ): boolean => {
    const refreshing = refreshingAttempt();
    if (
      refreshing === null ||
      refreshing.request !== request ||
      refreshing.includeIgnored !== includeIgnored ||
      refreshing.controller !== controller ||
      controller.signal.aborted
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
        complete(request, () => options.onResolved(request, resolved));
        return;
      }
    }

    if (refreshingAttempt() !== null) return;

    const includeIgnored = current.includeIgnored;
    const controller = new AbortController();
    attempt = {
      kind: "refreshing",
      request,
      includeIgnored,
      controller,
    };
    void options
      .readFresh(request, includeIgnored, controller.signal)
      .then((paths) => {
        if (!isCurrent(request, includeIgnored, controller)) return;
        const freshResolved = options.resolve(request, paths);
        if (freshResolved === null) {
          complete(request, () => options.onNotFound(request));
        } else {
          complete(request, () => options.onResolved(request, freshResolved));
        }
      })
      .catch((raw: unknown) => {
        // A superseded/aborted read no longer belongs to the latest user
        // intent; its failure must not toast over the replacement request.
        if (!isCurrent(request, includeIgnored, controller)) return;
        const error = raw instanceof Error ? raw : new Error(String(raw));
        complete(request, () => options.onError(request, error));
      });
  });

  onCleanup(retire);
}

import type { CodeTabView } from "@kolu/padi/surface";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, onCleanup } from "solid-js";
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
  return (
    encodeHostKey(a.host) === encodeHostKey(b.host) &&
    a.terminalId === b.terminalId &&
    a.repoRoot === b.repoRoot &&
    a.mode === b.mode
  );
}

/** Collision-safe key for state that is scoped to one Code-tab owner. */
export function codeTabScopeKey(scope: CodeTabScope | null): string {
  if (scope === null) return "";
  return [
    encodeHostKey(scope.host),
    scope.terminalId,
    scope.repoRoot,
    scope.mode,
  ].join("\0");
}

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

export interface CodeTabOpenSnapshot<Paths> {
  request: OpenInCodeTabRequest | null;
  scope: CodeTabScope | null;
  paths: Paths;
  inventoryPending: boolean;
}

interface CodeTabOpenControllerOptions<Paths, Resolved> {
  snapshot: () => CodeTabOpenSnapshot<Paths>;
  resolve: (request: OpenInCodeTabRequest, paths: Paths) => Resolved | null;
  readFresh: (
    request: OpenInCodeTabRequest,
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

  const retire = (): void => {
    if (attempt.kind === "refreshing") attempt.controller.abort();
    attempt = { kind: "idle" };
  };

  const complete = (request: OpenInCodeTabRequest, apply: () => void): void => {
    if (attempt.kind === "refreshing") attempt.controller.abort();
    attempt = { kind: "complete", request };
    apply();
  };

  const isCurrent = (
    request: OpenInCodeTabRequest,
    controller: AbortController,
  ): boolean => {
    if (
      attempt.kind !== "refreshing" ||
      attempt.request !== request ||
      attempt.controller !== controller ||
      controller.signal.aborted
    ) {
      return false;
    }
    const current = options.snapshot();
    return (
      current.request === request &&
      current.scope !== null &&
      codeTabScopesEqual(current.scope, request.scope)
    );
  };

  createEffect(() => {
    const current = options.snapshot();
    const request = current.request;

    if (request === null) {
      retire();
      return;
    }
    if (attempt.kind === "complete" && attempt.request === request) return;

    if (
      current.scope === null ||
      !codeTabScopesEqual(current.scope, request.scope)
    ) {
      // Leaving any member of the request's scope permanently supersedes it.
      complete(request, () => {});
      return;
    }

    if (
      attempt.kind === "refreshing" &&
      (attempt.request !== request || current.inventoryPending)
    ) {
      retire();
    }

    if (current.inventoryPending) return;

    const resolved = options.resolve(request, current.paths);
    if (resolved !== null) {
      complete(request, () => options.onResolved(request, resolved));
      return;
    }

    if (attempt.kind === "refreshing") return;

    const controller = new AbortController();
    attempt = {
      kind: "refreshing",
      request,
      controller,
    };
    void options
      .readFresh(request, controller.signal)
      .then((paths) => {
        if (!isCurrent(request, controller)) return;
        const freshResolved = options.resolve(request, paths);
        if (freshResolved === null) {
          complete(request, () => options.onNotFound(request));
        } else {
          complete(request, () => options.onResolved(request, freshResolved));
        }
      })
      .catch((raw: unknown) => {
        if (!isCurrent(request, controller)) return;
        const error = raw instanceof Error ? raw : new Error(String(raw));
        complete(request, () => options.onError(request, error));
      });
  });

  onCleanup(retire);
}

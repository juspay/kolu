/**
 * Process-local diagnostics registry for long-lived runtime resources.
 *
 * Resource owners register at creation time and receive a cleanup function
 * to call beside the real close/clear call. This package is deliberately
 * neutral: server and integration packages can depend on it without pulling
 * in agent or server concepts.
 */

/** Kind of process-local resource that can remain open across user actions. */
export type DiagnosticResourceKind =
  | "fs-watch"
  | "timer"
  | "subscription"
  | "db";

/** JSON-safe scalar value included in diagnostic resource details. */
export type DiagnosticDetailValue = string | number | boolean | null;

/** Immutable view of one currently tracked runtime resource. */
export interface DiagnosticResourceSnapshot {
  id: number;
  kind: DiagnosticResourceKind;
  label: string;
  owner: string | null;
  target: string | null;
  createdAt: number;
  details: Record<string, DiagnosticDetailValue>;
}

interface DiagnosticResourceEntry {
  id: number;
  kind: DiagnosticResourceKind;
  label: string;
  owner: string | null;
  target: string | null;
  createdAt: number;
  details: () => Record<string, DiagnosticDetailValue>;
}

/** Registration metadata for a resource and its optional dynamic details. */
export interface TrackDiagnosticResourceInput {
  kind: DiagnosticResourceKind;
  label: string;
  owner?: string | null;
  target?: string | null;
  details?:
    | Record<string, DiagnosticDetailValue>
    | (() => Record<string, DiagnosticDetailValue>);
}

let nextId = 1;
const resources = new Map<number, DiagnosticResourceEntry>();

function trackDiagnosticResource(
  input: TrackDiagnosticResourceInput,
): () => void {
  const id = nextId++;
  const details: () => Record<string, DiagnosticDetailValue> =
    typeof input.details === "function"
      ? input.details
      : (() => {
          const value = input.details ?? {};
          return () => value;
        })();
  resources.set(id, {
    id,
    kind: input.kind,
    label: input.label,
    owner: input.owner ?? null,
    target: input.target ?? null,
    createdAt: Date.now(),
    details,
  });
  return () => {
    resources.delete(id);
  };
}

/** Register a resource and return an idempotent cleanup that releases both
 *  the underlying handle and its diagnostic entry. */
export function trackDiagnosticCleanup(
  input: TrackDiagnosticResourceInput,
  cleanup: () => void,
): () => void {
  const untrack = trackDiagnosticResource(input);
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    try {
      cleanup();
    } finally {
      untrack();
    }
  };
}

/** Return active resources in creation order for the one-shot diagnostics RPC. */
export function diagnosticResourcesSnapshot(): DiagnosticResourceSnapshot[] {
  return [...resources.values()]
    .map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      label: resource.label,
      owner: resource.owner,
      target: resource.target,
      createdAt: resource.createdAt,
      details: resource.details(),
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
}

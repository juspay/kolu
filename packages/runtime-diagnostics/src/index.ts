/**
 * Process-local diagnostics registry for long-lived runtime resources.
 *
 * Resource owners register at creation time and receive a cleanup function
 * to call beside the real close/clear call. This package is deliberately
 * neutral: server and integration packages can depend on it without pulling
 * in agent or server concepts.
 */

export type DiagnosticResourceKind =
  | "fs-watch"
  | "timer"
  | "subscription"
  | "process"
  | "db";

export type DiagnosticDetailValue = string | number | boolean | null;

export interface DiagnosticResourceSnapshot {
  id: number;
  kind: DiagnosticResourceKind;
  label: string;
  owner: string | null;
  target: string | null;
  createdAt: number;
  ageMs: number;
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

export function trackDiagnosticResource(
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

export function diagnosticResourcesSnapshot(
  now = Date.now(),
): DiagnosticResourceSnapshot[] {
  return [...resources.values()]
    .map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      label: resource.label,
      owner: resource.owner,
      target: resource.target,
      createdAt: resource.createdAt,
      ageMs: now - resource.createdAt,
      details: resource.details(),
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
}

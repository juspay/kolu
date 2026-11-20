import type {
  DaemonStatus,
  KavalSkewVersions,
} from "@kolu/padi-client/surface";

export type KavalAttention =
  | { kind: "none" }
  | { kind: "stale" }
  | ({ kind: "incompatible" } & KavalSkewVersions);

function kavalStale(
  expected: string | undefined,
  status: DaemonStatus | undefined,
): boolean {
  return (
    status?.state === "connected" &&
    !!expected &&
    expected !== status.identity?.staleKey
  );
}

export function kavalAttention(
  expected: string | undefined,
  status: DaemonStatus | undefined,
  live: boolean,
): KavalAttention {
  if (!live || status === undefined) return { kind: "none" };
  if (status.state === "incompatible") {
    return {
      kind: "incompatible",
      daemonVersion: status.daemonVersion,
      requiredVersion: status.requiredVersion,
    };
  }
  if (kavalStale(expected, status)) {
    return { kind: "stale" };
  }
  return { kind: "none" };
}

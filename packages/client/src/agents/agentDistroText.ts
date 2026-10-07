/**
 * The words kolu shows for agent-distro — pure functions of a status or a
 * bundle path, no subscriptions. Their volatility is the copy, which revs on its
 * own clock (a reworded status, a different short-hash length) apart from the
 * live facts `useAgentDistro.ts` subscribes to.
 */

import type { AgentDistroStatus } from "@kolu/padi-client/surface";

/** The short hash a tile's chip shows for a bundle: the first 8 characters of
 *  its store hash (`/nix/store/<hash>-name` → `<hash>[0..8]`). Not a store path
 *  (a from-source fixture, say) → the path's last segment, cut to 8. */
export function agentBundleShortHash(bundle: string): string {
  const base = bundle.split("/").filter(Boolean).at(-1) ?? bundle;
  return base.slice(0, 8);
}

/** "1.1 GB", "640 MB" — the unit a download reads in. */
export function formatBytes(bytes: number): string {
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${Math.round(bytes / 1e6)} MB`;
}

/** The words for a status that needs any: "Downloading agents… 1.1 GB of 2.0 GB",
 *  or the updater's own error message. `undefined` for the quiet states. */
export function agentDistroStatusText(
  status: AgentDistroStatus | undefined,
): { text: string; tone: "busy" | "error" } | undefined {
  if (status === undefined) return undefined;
  switch (status.kind) {
    case "downloading":
      return {
        tone: "busy",
        text:
          // A total of 0 is a run with nothing left to fetch (the host already
          // had every path): "0 MB of 0 MB" would be noise, not progress.
          status.progress === undefined || status.progress.total === 0
            ? "Downloading agents…"
            : `Downloading agents… ${formatBytes(status.progress.done)} of ${formatBytes(status.progress.total)}`,
      };
    case "error":
      return { tone: "error", text: status.message };
    case "off":
    case "unavailable":
    case "ready":
      return undefined;
    default:
      return status satisfies never;
  }
}

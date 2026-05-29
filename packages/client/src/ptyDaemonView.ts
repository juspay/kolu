/** Pure derivation of the chrome-bar daemon dot's tone + tooltip from the
 *  `localPtyDaemon` status cell. Kept out of `ChromeBar.tsx` so the
 *  "update pending" nudge logic is unit-testable without a component
 *  harness (the client package has no DOM test setup).
 *
 *  `outdated` is orthogonal to `state`: a daemon can be `ready` *and*
 *  running stale code after a deploy it survived (see R-4 plan). We surface
 *  that as its own steady-amber tone — distinct from `starting`'s pulsing
 *  amber — with a tooltip that names both versions and how to fix it. */

import type { LocalPtyDaemonStatus } from "kolu-common/surface";

export type DaemonTone = "starting" | "ready" | "outdated" | "down";

export interface DaemonView {
  tone: DaemonTone;
  label: string;
}

const LABELS: Record<"starting" | "ready" | "down", string> = {
  starting: "Local PTY daemon: starting…",
  ready: "Local PTY daemon: connected",
  down: "Local PTY daemon: disconnected",
};

export function ptyDaemonView(
  status: LocalPtyDaemonStatus | undefined,
): DaemonView {
  const state = status?.state ?? "starting";
  if (state === "ready" && status?.outdated) {
    const running = status.pkgVersion ?? "?";
    const server = status.serverPkgVersion ?? "?";
    return {
      tone: "outdated",
      label: `Local PTY daemon: update pending (running ${running}, server ${server}) — restart to apply`,
    };
  }
  return { tone: state, label: LABELS[state] };
}

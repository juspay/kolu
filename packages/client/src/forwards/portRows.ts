/**
 * The rows of the ONE ports section — scanned ports joined to the forwards kolu
 * holds, plus the forwards that match no scanned port.
 *
 * There used to be two titled groups, and a forwarded port appeared in both:
 * once as a chip with a `⇄ :5173` badge, again as a row reading
 * `naiveintent:5173 → :5173`. Two renderings of one fact invite the reader to
 * hunt for the difference between them, so they are one row now.
 *
 * What the second group was RIGHT about is kept: a forward is a fact about the
 * HOST, not about a terminal. A ⌘K manual forward belongs to no tile, and an
 * `auto` forward outlives both the listener that earned it (by up to a reap
 * interval) and the tile that opened it. Dropping those would leave open doors
 * with nowhere to cancel them from — so they trail the same section as `orphan`
 * rows instead of getting a heading of their own.
 *
 * A pure join, so the ordering and the host scoping are testable without a DOM.
 */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { KoluForward, PortInfo } from "kolu-common/surface";

/** One row of the section.
 *
 *  `port` — something this terminal is serving, with its door if it has one.
 *  `orphan` — a door on this host with no scanned port behind it (yet, or ever).
 *
 *  A discriminated union rather than a `PortInfo` with optional fields, because
 *  the two genuinely differ in what they can show: an orphan has a forward but no
 *  process name and no bind scope, so a shared shape would be half-empty on one
 *  arm and a render site would have to guess which. */
export type PortRow =
  | {
      kind: "port";
      /** The arm-independent KEY the list is rendered and `data-port`-tagged by
       *  — not a second copy of the observation: an orphan arm has no `info` to
       *  project it from, which is why it is carried rather than derived. */
      port: number;
      info: PortInfo;
      forward: KoluForward | undefined;
    }
  | { kind: "orphan"; port: number; forward: KoluForward };

/** Join what the terminal serves to what kolu has opened. */
export function portRows(opts: {
  ports: readonly PortInfo[];
  forwards: readonly KoluForward[];
  /** The host the inspected terminal is on — forwards are host-scoped. */
  host: HostKey;
}): PortRow[] {
  const here = encodeHostKey(opts.host);
  const onThisHost = opts.forwards.filter(
    (f) => encodeHostKey(f.host) === here,
  );
  const byPort = new Map(onThisHost.map((f) => [f.remotePort, f]));

  const rows: PortRow[] = opts.ports.map((info) => ({
    kind: "port",
    port: info.port,
    info,
    forward: byPort.get(info.port),
  }));

  // Every door with no scanned port behind it, AFTER every port. The section's
  // subject is what this terminal is serving; the host's other doors are the
  // footnote, and interleaving by number would bury the first in the second.
  const scanned = new Set(opts.ports.map((p) => p.port));
  const orphans = onThisHost
    .filter((f) => !scanned.has(f.remotePort))
    .sort((a, b) => a.remotePort - b.remotePort)
    .map(
      (forward): PortRow => ({
        kind: "orphan",
        port: forward.remotePort,
        forward,
      }),
    );

  return [...rows, ...orphans];
}

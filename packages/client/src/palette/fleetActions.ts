/** Fleet → palette projection — rows, host groups, and host actions for the
 *  unified switcher. Lives next to the fleet index so `createCommands` only
 *  registers the results (not presentation/keying). */

import {
  encodeHostKey,
  type HostKey,
  hostKeysEqual as sameHost,
} from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import {
  computeTerminalKeys,
  type TerminalKey,
  terminalKey,
} from "@kolu/terminal-vocab/terminalKey";
import type {
  PaletteAction,
  PaletteGroup,
  PaletteItem,
} from "../CommandPalette";
import { workspaceSearchText } from "../canvas/dockModel";
import { hostLabel, hostRowContext } from "../host/hostChipTone";
import { hostRecency, switchedAtOf } from "../host/hostRecency";
import { assignColors } from "../terminal/terminalDisplay";
import { useVisitRecency, visitedAtOf } from "../terminal/visitRecency";
import { padiMap } from "../wire";
import {
  type FleetTerminalRow,
  groupFleetByHost,
  orderHostsActiveFirst,
} from "./fleetTerminals";

/** Switch host when the row is foreign, then activate. Pure sequencing
 *  extracted so unit tests can spy without mounting the palette. */
export function selectFleetTerminal(
  rowHost: HostKey,
  rowId: TerminalId,
  active: HostKey,
  switchHost: (host: HostKey) => void,
  activate: (id: TerminalId) => void,
): void {
  if (!sameHost(rowHost, active)) switchHost(rowHost);
  activate(rowId);
}

/** Project one host's fleet rows with collision keys scoped to that host. */
function terminalSwitchActionsForHost(
  rows: readonly FleetTerminalRow[],
  active: HostKey,
  switchHost: (host: HostKey) => void,
  activate: (id: TerminalId) => void,
  /** Shared fleet-wide hue map so multi-host root lists keep stable colors. */
  colors: Map<string, string>,
): PaletteAction[] {
  const keys: Map<TerminalId, TerminalKey> = computeTerminalKeys(
    rows.map((r) => ({
      id: r.id,
      git: r.meta.git,
      cwd: r.meta.cwd,
    })),
  );
  // Read the visit trail ONCE, not per row — same reason `hostRootActions`
  // hoists its own: Solid does not dedupe repeated reads, so a read inside the
  // map registers one subscription per terminal on a trail that moves on every
  // tile activation.
  const visits = useVisitRecency().visits();
  return rows.map((row): PaletteAction => {
    const k = keys.get(row.id);
    if (k === undefined) {
      throw new Error(
        `computeTerminalKeys missing id ${row.id} — map must cover every input row`,
      );
    }
    const repoName = k.group;
    const branchLabel = k.suffix ? `${k.label} ${k.suffix}` : k.label;
    const repoColor = colors.get(repoName);
    if (repoColor === undefined) {
      throw new Error(
        `assignColors missing repo key "${repoName}" — map must cover every fleet group`,
      );
    }
    // Same socket as dock/title `annotationColor` — hue of the branch label.
    const annotationColor = colors.get(k.label);
    if (annotationColor === undefined) {
      throw new Error(
        `assignColors missing branch key "${k.label}" — map must cover every fleet label`,
      );
    }
    const hostName = hostLabel(row.host);
    const hostKey = encodeHostKey(row.host);
    // TWO grounded clocks, and only grounded ones: the terminal's own activity
    // and your own visit. The palette's two questions — how warm is this row
    // (ORDER) and when were you last here (HIGHLIGHT) — are both DERIVED from
    // this pair at the sites that ask them (`rootIndex.rankOf` /
    // `rootIndex.rowVisitedAt`). Storing the warmth derivation as a third field
    // let a row carry a rank its own inputs contradicted.
    const activityAt = row.recencyAt;
    return {
      kind: "action",
      name: branchLabel,
      description: repoName,
      onSelect: () =>
        selectFleetTerminal(row.host, row.id, active, switchHost, activate),
      row: {
        kind: "terminal",
        terminalId: row.id,
        terminalMeta: row.meta,
        hostKey: row.host,
        repoName,
        repoColor,
        branchLabel,
        annotationColor,
        recencyAt: activityAt,
        visitedAt: visitedAtOf(visits, hostKey, row.id),
        searchText: [
          workspaceSearchText({
            repoName,
            label: branchLabel,
            meta: row.meta,
          }),
          hostName,
        ].join(" "),
      },
    };
  });
}

/** Terminal rows for the unified switcher — fleet-wide. Collision suffixes
 *  are computed **per host** (host chip separates cross-host same-name rows). */
export function terminalSwitchActions(
  fleet: readonly FleetTerminalRow[],
  active: HostKey,
  switchHost: (host: HostKey) => void,
  activate: (id: TerminalId) => void,
): PaletteAction[] {
  // Hue uses bare group/label — collision suffixes do not affect color.
  const colors = assignColors(
    fleet.flatMap((r) => {
      const k = terminalKey(r.meta);
      return [k.group, k.label];
    }),
  );
  return groupFleetByHost(fleet).flatMap((g) =>
    terminalSwitchActionsForHost(g.rows, active, switchHost, activate, colors),
  );
}

/** Terminals tree: one drillable host group per **connected** pool member. */
export function terminalHostGroups(
  fleet: readonly FleetTerminalRow[],
  hosts: readonly HostKey[],
  active: HostKey,
  switchHost: (host: HostKey) => void,
  activate: (id: TerminalId) => void,
): PaletteGroup[] {
  const buckets = new Map(
    groupFleetByHost(fleet).map(
      (g) => [encodeHostKey(g.host), g.rows] as const,
    ),
  );
  const colors = assignColors(
    fleet.flatMap((r) => {
      const k = terminalKey(r.meta);
      return [k.group, k.label];
    }),
  );
  const connected = hosts.filter(
    (h) => padiMap.entry(h).state().kind === "connected",
  );
  return orderHostsActiveFirst(connected, active).map((host) => {
    const rows = buckets.get(encodeHostKey(host)) ?? [];
    const n = rows.length;
    const countLabel = n === 1 ? "1 terminal" : `${n} terminals`;
    const label = hostLabel(host);
    return {
      kind: "group" as const,
      id: encodeHostKey(host),
      name: label,
      description: countLabel,
      row: {
        kind: "host" as const,
        hostKey: host,
        context: countLabel,
        searchText: `${label} ${countLabel}`,
      },
      children: (): PaletteItem[] =>
        terminalSwitchActionsForHost(
          rows,
          active,
          switchHost,
          activate,
          colors,
        ),
    };
  });
}

/** Host rows for root index and the Hosts scoped group — one source of truth.
 *
 *  Order stays membership order (a host list that reshuffles under the cursor
 *  is not a list you can learn); it is `visitedAt` that carries the switch
 *  trail, so ⌘⇧H's default highlight lands on the host you came from — the same
 *  `defaultSelectionIndex` rule the terminal rows above feed with their own
 *  visit trail, through the same field. The stamp itself comes from the trail's
 *  own lookup (`hostRecency.switchedAtOf`), the mirror of `visitedAtOf`.
 *
 *  A host row carries no activity clock to pair the visit stamp with, and that
 *  asymmetry is the design: the Hosts list keeps POOL order, because a machine
 *  list that reshuffles under the cursor is unlearnable — the same reason the
 *  dock stopped sorting on a clock. So a host's warmth (`rootIndex.rankOf`)
 *  degenerates to its visit stamp, which is harmless because no path ever
 *  rank-sorts hosts. */
export function hostRootActions(
  hosts: HostKey[],
  active: HostKey,
  switchHost: (host: HostKey) => void,
): PaletteAction[] {
  // Read the trail ONCE, not per row: Solid does not dedupe repeated reads, so
  // a read inside the map would register one subscription per host on a memo
  // that recomputes on fleet, pool, and posture churn alike.
  const trail = hostRecency();
  return hosts.map((h): PaletteAction => {
    const label = hostLabel(h);
    const state = padiMap.entry(h).state();
    const context = hostRowContext(state, sameHost(h, active));
    return {
      kind: "action",
      name: label,
      description: context || undefined,
      onSelect: () => {
        if (!sameHost(h, active)) switchHost(h);
      },
      row: {
        kind: "host",
        hostKey: h,
        context,
        visitedAt: switchedAtOf(trail, encodeHostKey(h)),
        searchText: `${label} ${context} ${state.kind}`.trim(),
      },
    };
  });
}

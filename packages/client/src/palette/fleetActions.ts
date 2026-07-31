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
} from "kolu-common/terminalKey";
import type {
  PaletteAction,
  PaletteGroup,
  PaletteItem,
} from "../CommandPalette";
import { workspaceSearchText } from "../canvas/dockModel";
import { hostLabel, hostRowContext } from "../host/hostChipTone";
import { assignColors } from "../terminal/terminalDisplay";
import {
  useVisitRecency,
  type VisitEntry,
  visitedAtOf,
} from "../terminal/visitRecency";
import { padiMap } from "../wire";
import {
  type FleetTerminalRow,
  groupFleetByHost,
  orderHostsActiveFirst,
} from "./fleetTerminals";

/** Palette ranking policy: max(client visit, server activity). Lives here
 *  (not in the trail store) so visitRecency stays trail-only. */
export function terminalRankScore(
  visits: readonly VisitEntry[],
  hostKey: string,
  terminalId: TerminalId,
  serverActivityAt: number | null | undefined,
): number {
  return Math.max(
    visitedAtOf(visits, hostKey, terminalId),
    serverActivityAt ?? 0,
  );
}

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
    // activity clock for paint; rankScore for sort — never jam them into one field.
    const activityAt = row.recencyAt;
    const rankAt = terminalRankScore(
      useVisitRecency().visits(),
      hostKey,
      row.id,
      activityAt,
    );
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
        rankAt,
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

/** Host rows for root index and the Hosts scoped group — one source of truth. */
export function hostRootActions(
  hosts: HostKey[],
  active: HostKey,
  switchHost: (host: HostKey) => void,
): PaletteAction[] {
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
        searchText: `${label} ${context} ${state.kind}`.trim(),
      },
    };
  });
}

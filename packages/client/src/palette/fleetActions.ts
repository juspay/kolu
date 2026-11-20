import {
  computeTerminalKeys,
  type TerminalKey,
  terminalKey,
} from "@kolu/terminal-vocab/terminalKey";
import {
  encodeHostKey,
  type HostKey,
  hostKeysEqual as sameHost,
} from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
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

function terminalSwitchActionsForHost(
  rows: readonly FleetTerminalRow[],
  active: HostKey,
  switchHost: (host: HostKey) => void,
  activate: (id: TerminalId) => void,
  colors: Map<string, string>,
): PaletteAction[] {
  const keys: Map<TerminalId, TerminalKey> = computeTerminalKeys(
    rows.map((r) => ({
      id: r.id,
      git: r.meta.git,
      cwd: r.meta.cwd,
    })),
  );
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
    const annotationColor = colors.get(k.label);
    if (annotationColor === undefined) {
      throw new Error(
        `assignColors missing branch key "${k.label}" — map must cover every fleet label`,
      );
    }
    const hostName = hostLabel(row.host);
    const hostKey = encodeHostKey(row.host);
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

export function terminalSwitchActions(
  fleet: readonly FleetTerminalRow[],
  active: HostKey,
  switchHost: (host: HostKey) => void,
  activate: (id: TerminalId) => void,
): PaletteAction[] {
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

export function hostRootActions(
  hosts: HostKey[],
  active: HostKey,
  switchHost: (host: HostKey) => void,
): PaletteAction[] {
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

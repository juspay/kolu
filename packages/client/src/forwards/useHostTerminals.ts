import { activeArm } from "@kolu/padi-client/surface";
import {
  foldPorts,
  knownPorts,
  type PortInfo,
  type TerminalId,
} from "kolu-common/surface";
import { createMemo } from "solid-js";
import { printedPortsOf } from "../terminal/printedPorts";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { servingLink } from "./terminalServingPort";

export const sameSet = (
  a: ReadonlySet<number>,
  b: ReadonlySet<number>,
): boolean => a.size === b.size && [...a].every((p) => b.has(p));

export interface HostTerminals {
  servingFor: (port: number) => { name: string; jump: () => void } | undefined;
  tilePorts: (tileId: TerminalId) => readonly PortInfo[];
  printedBy: (tileId: TerminalId) => ReadonlySet<number>;
  printedOnHost: () => ReadonlySet<number>;
}

export function useHostTerminals(): HostTerminals {
  const store = useTerminalStore();
  const candidates = createMemo(() =>
    store.terminalIds().flatMap((tileId) =>
      store.getTilePaneIds(tileId).flatMap((paneId) => {
        const arm = activeArm(store.getMetadata(paneId));
        return arm === undefined
          ? []
          : [
              {
                id: paneId,
                parentId: paneId === tileId ? null : tileId,
                ports: arm.ports,
              },
            ];
      }),
    ),
  );
  const printedBy = (tileId: TerminalId): ReadonlySet<number> =>
    new Set(store.getTilePaneIds(tileId).flatMap((id) => printedPortsOf(id)));
  const printedOnHost = createMemo(
    () =>
      new Set(store.terminalIds().flatMap((tileId) => [...printedBy(tileId)])),
    undefined,
    { equals: sameSet },
  );
  return {
    servingFor: (port) =>
      servingLink({
        port,
        candidates: candidates(),
        armOf: (id) => activeArm(store.getMetadata(id)),
        activate: (id) => store.activate(id),
      }),
    tilePorts: (tileId) =>
      foldPorts(
        candidates()
          .filter((c) => c.id === tileId || c.parentId === tileId)
          .flatMap((c) => knownPorts(c.ports)),
      ),
    printedBy,
    printedOnHost,
  };
}

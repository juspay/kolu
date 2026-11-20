import {
  isParkedTerminal,
  type TerminalMetadata,
  tileTerminalOf,
} from "@kolu/padi-client/surface";
import { writeWrappedValue } from "@kolu/surface/solid";
import type { TerminalId } from "kolu-common/surface";
import {
  type Accessor,
  createComputed,
  createMemo,
  mapArray,
  onCleanup,
  untrack,
} from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { activeScope } from "../hostScope/hostScopes";
import { activeHost, padiMap } from "../wire";
import { reprojectTerminalClock } from "./reprojectClock";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";
import {
  containingTileOf,
  descendantsByRoot,
  type PaneNode,
  paneTreeOf,
  rootAncestorOf,
} from "./terminalTree";

export function sameTerminalIdOrder(
  a: readonly TerminalId[],
  b: readonly TerminalId[],
): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export { isParkedTerminal as isParked } from "@kolu/padi-client/surface";

const NO_SUB_IDS: TerminalId[] = [];

const NO_PANE_NODES: PaneNode[] = [];

function sameDisplayInfo(
  a: TerminalDisplayInfo | undefined,
  b: TerminalDisplayInfo,
): boolean {
  return (
    !!a &&
    a.repoColor === b.repoColor &&
    a.annotationColor === b.annotationColor &&
    a.subCount === b.subCount &&
    a.key.group === b.key.group &&
    a.key.label === b.key.label &&
    a.key.suffix === b.key.suffix
  );
}

export function useTerminalMetadata(deps: {
  list: Accessor<{ id: TerminalId }[] | undefined>;
}) {
  const keys = createMemo<TerminalId[]>(
    () => deps.list()?.map((t) => t.id) ?? [],
  );
  const terminals = () => activeScope()?.wire.terminals;

  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    return slots[id]?.read();
  }

  const [slots, setSlots] = createStore<
    Record<
      TerminalId,
      {
        read: Accessor<TerminalMetadata | undefined>;
        parent: Accessor<TerminalId | null | undefined>;
      }
    >
  >({});
  const driveProjections = mapArray(keys, (id) => {
    const [store, setStore] = createStore<{ v: TerminalMetadata | undefined }>({
      v: undefined,
    });
    createComputed(() => {
      const record = rawTile(id);
      writeWrappedValue<TerminalMetadata | undefined>(
        setStore,
        record === undefined
          ? undefined
          : reprojectTerminalClock(
              padiMap.entry(activeHost()).clock.toLocal,
              record,
            ),
      );
    });
    const parent = createMemo(() => {
      const tile = rawTile(id);
      return tile === undefined ? undefined : (tile.parentId ?? null);
    });
    setSlots(id, { read: () => store.v, parent });
    onCleanup(() =>
      setSlots(
        produce((s) => {
          delete s[id];
        }),
      ),
    );
  });
  createComputed(driveProjections);

  function rawTile(id: TerminalId): TerminalMetadata | undefined {
    const record = terminals()?.byKey(id)?.();
    return tileTerminalOf(record);
  }

  const recordPhases = createMemo(() => {
    let awaited = 0;
    let parked = 0;
    let live = 0;
    for (const id of keys()) {
      const record = terminals()?.byKey(id)?.();
      if (record === undefined) awaited++;
      else if (isParkedTerminal(record)) parked++;
      else live++;
    }
    return { awaited, parked, live };
  });

  function parentEdge(id: TerminalId): TerminalId | null | undefined {
    return slots[id]?.parent();
  }

  const terminalIds = createMemo<TerminalId[]>(
    () =>
      keys().filter((id) => {
        if (rawTile(id) === undefined) return false;
        const root = rootAncestorOf(id, parentEdge);
        return root === id || root === null;
      }),
    [],
    { equals: sameTerminalIdOrder },
  );

  const splitsByRoot = createMemo<Map<TerminalId, TerminalId[]>>((prev) => {
    const next = descendantsByRoot(keys(), parentEdge);
    for (const [id, ids] of next) {
      const old = prev?.get(id);
      if (old && sameTerminalIdOrder(old, ids)) next.set(id, old);
    }
    return next;
  });

  const paneTreesByRoot = createMemo<Map<TerminalId, PaneNode[]>>(
    () =>
      new Map(
        [...splitsByRoot()].map(([rootId, flat]) => [
          rootId,
          paneTreeOf(rootId, flat, parentEdge),
        ]),
      ),
  );

  function getSplitPaneIds(rootId: TerminalId): TerminalId[] {
    return splitsByRoot().get(rootId) ?? NO_SUB_IDS;
  }

  function getPaneTree(rootId: TerminalId): readonly PaneNode[] {
    return paneTreesByRoot().get(rootId) ?? NO_PANE_NODES;
  }

  function containingTile(id: TerminalId): TerminalId {
    return containingTileOf(id, parentEdge);
  }

  function getTilePaneIds(tileId: TerminalId): TerminalId[] {
    return [tileId, ...getSplitPaneIds(tileId)];
  }

  function isWorktreeShared(
    worktreePath: string,
    excludeId: TerminalId,
  ): boolean {
    const onWorktree = (id: TerminalId) => {
      const git = getMetadata(id)?.git;
      return git?.kind === "repo" && git.info.worktreePath === worktreePath;
    };
    return terminalIds().some((otherId) => {
      if (otherId === excludeId) return false;
      return onWorktree(otherId) || getSplitPaneIds(otherId).some(onWorktree);
    });
  }

  const [displayInfos, setDisplayInfos] = createStore<
    Record<string, TerminalDisplayInfo>
  >({});
  createComputed(() => {
    const next = buildTerminalDisplayInfos(
      terminalIds(),
      getMetadata,
      getSplitPaneIds,
    );
    const previous = untrack(() => unwrap(displayInfos));
    setDisplayInfos(
      produce((table) => {
        for (const id of Object.keys(previous))
          if (!next.has(id)) delete table[id];
        for (const [id, value] of next) {
          if (!sameDisplayInfo(previous[id], value)) table[id] = value;
        }
      }),
    );
  });

  function getDisplayInfo(id: TerminalId): TerminalDisplayInfo | undefined {
    return displayInfos[id];
  }

  function terminalLabel(id: TerminalId): string {
    const pos = terminalIds().indexOf(id) + 1;
    return pos > 0 ? `Terminal ${pos}` : "Terminal";
  }

  return {
    getMetadata,
    recordPhases,
    terminalIds,
    getSplitPaneIds,
    getPaneTree,
    containingTile,
    parentEdge,
    getTilePaneIds,
    isWorktreeShared,
    getDisplayInfo,
    terminalLabel,
  };
}

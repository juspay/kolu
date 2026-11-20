import type { TerminalId } from "kolu-common/surface";
import { createEffect, createSignal } from "solid-js";
import { createSharedRoot } from "../../createSharedRoot";
import { repairTileTabs, useSubPanel } from "../../terminal/useSubPanel";
import { useTerminalCrud } from "../../terminal/useTerminalCrud";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { useDockFocus } from "./useDockFocus";

type ReparentIntent =
  | { readonly kind: "settled" }
  | {
      readonly kind: "awaitingEdge";
      readonly id: TerminalId;
      readonly parentId: TerminalId | null;
      readonly fromTile: TerminalId;
    };

const SETTLED: ReparentIntent = { kind: "settled" };

export const useDockReparent = createSharedRoot(
  (): ((id: TerminalId, parentId: TerminalId | null) => void) => {
    const crud = useTerminalCrud();
    const store = useTerminalStore();
    const subPanel = useSubPanel();
    const focus = useDockFocus();
    const [intent, setIntent] = createSignal<ReparentIntent>(SETTLED);

    createEffect(() => {
      const p = intent();
      if (p.kind === "settled") return;
      const edge = store.parentEdge(p.id);
      if (edge === undefined) {
        setIntent(SETTLED);
        return;
      }
      if (edge !== p.parentId) return;
      setIntent(SETTLED);
      if (p.fromTile === p.id) {
        subPanel.removePanel(p.id);
        store.forgetFromMru(p.id);
      } else {
        repairTileTabs(
          subPanel,
          p.fromTile,
          store.getSplitPaneIds(p.fromTile),
          false,
        );
      }
      focus(p.id);
    });

    return (id, parentId) => {
      const fromTile = store.containingTile(id);
      setIntent({ kind: "awaitingEdge", id, parentId, fromTile });
      const settle = (applied: boolean) => {
        if (applied) return;
        setIntent((cur) =>
          cur.kind === "awaitingEdge" && cur.id === id ? SETTLED : cur,
        );
      };
      if (parentId === null) {
        crud.promoteToTopLevel(id, fromTile, settle);
        return;
      }
      void crud.reparent(id, parentId).then(settle);
    };
  },
);

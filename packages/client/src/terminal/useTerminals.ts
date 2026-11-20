import { encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { activeScope } from "../hostScope/hostScopes";
import { listIsAuthoritative } from "../kaval/useDaemonStatus";
import { isDeclared, TERMINAL_NOT_FOUND } from "../rpc/declaredErrors";
import { useRightPanel } from "../right-panel/useRightPanel";
import { activeHost, padiMap } from "../wire";
import { terminalSubject } from "./terminalSubject";
import { useActiveReconcile } from "./useActiveReconcile";
import { useAdoptNewSplit } from "./useAdoptNewSplit";
import { useSessionRestore } from "./useSessionRestore";
import { useSubPanel } from "./useSubPanel";
import { useTerminalCrud } from "./useTerminalCrud";
import { useTerminalExits } from "./useTerminalExits";
import { useTerminalStore } from "./useTerminalStore";
import { useWorktreeOps } from "./useWorktreeOps";

export function useTerminals() {
  const store = useTerminalStore();

  const getSubject = (id: TerminalId) =>
    terminalSubject(
      store.getDisplayInfo(id),
      store.getMetadata(id),
      store.terminalLabel(id),
    );

  function subscribeExit(id: TerminalId) {
    padiMap.useEntry(activeHost).events.terminalExit.use(
      () => ({ id }),
      (code) => {
        const subject = getSubject(id);
        const headline =
          code === 0
            ? `${subject.title} exited`
            : `${subject.title} exited with code ${code}`;
        const opts = { description: subject.description };
        if (code === 0) toast(headline, opts);
        else toast.warning(headline, opts);
      },
      {
        onError: (err) => {
          if (isDeclared(err, TERMINAL_NOT_FOUND)) return;
          console.error("Exit stream error:", err);
        },
      },
    );
  }

  const crud = useTerminalCrud();

  const allTerminalIds = createMemo(
    () => store.listSub()?.map((t) => t.id) ?? [],
  );
  const parentOf = store.parentEdge;
  const activeHostKey = () => encodeHostKey(activeHost());
  useTerminalExits({ ids: allTerminalIds, subscribe: subscribeExit });

  useActiveReconcile({
    rawList: allTerminalIds,
    parentOf,
    activeHostKey,
    evictDeparted: crud.evictDeparted,
    listIsAuthoritative,
  });

  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();
  useAdoptNewSplit({
    rawList: allTerminalIds,
    parentOf,
    activeHostKey,
    restorePhase: () => activeScope()?.restore.phase ?? "pending",
    ports: {
      expandPanel: subPanel.expandPanel,
      activeSubTab: (parentId) => subPanel.paneChrome(parentId).activeSubTab,
      setActiveSubTab: subPanel.setActiveSubTab,
      seedSplitTab: (subId, parentId) =>
        rightPanel.seedSplitTab(parentId)(subId),
    },
  });

  const session = useSessionRestore({ store });

  const worktree = useWorktreeOps({
    store,
    handleCreate: crud.handleCreate,
    handleKillWithSubs: crud.handleKillWithSubs,
    handleDiscard: crud.handleDiscard,
  });

  return { store, crud, session, worktree, getSubject };
}

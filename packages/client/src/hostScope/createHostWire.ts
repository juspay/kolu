import { encodeHostLocation, LOCAL_LOCATION } from "@kolu/padi-client/surface";
import { unenrolledStreamCall } from "@kolu/surface/client";
import {
  createReactiveSubscription,
  type Subscription,
} from "@kolu/surface/solid";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createMemo } from "solid-js";
import type { LivePlacement } from "../terminal/focusedTerminal";
import { interpretClientError, padiMap } from "../wire";

type PadiEntry = ReturnType<typeof padiMap.entry>;

export interface HostWire {
  terminalKeys: Subscription<TerminalId[]>;
  terminals: ReturnType<PadiEntry["collections"]["terminals"]["use"]>;
  session: ReturnType<PadiEntry["cells"]["session"]["use"]>;
  roster: ReturnType<PadiEntry["cells"]["roster"]["use"]>;
  activityFeed: ReturnType<PadiEntry["cells"]["activityFeed"]["use"]>;
  daemonStatus: ReturnType<PadiEntry["collections"]["daemonStatus"]["use"]>;
  placementOf: (id: TerminalId) => LivePlacement;
}

export function createHostWire(host: HostKey): HostWire {
  const entry = padiMap.entry(host);

  const terminalKeys = createReactiveSubscription<HostKey, TerminalId[]>(
    () => host,
    () =>
      unenrolledStreamCall(
        entry.collections.terminals.unenrolledKeys,
        undefined,
        { label: `terminals.keys[${encodeHostKey(host)}]` },
      ),
    {
      onError: (err) =>
        interpretClientError(
          { kind: "scopedSub", label: "Terminal list error" },
          err,
          { key: host },
        ),
    },
  );

  const keys = createMemo<TerminalId[]>(() => terminalKeys() ?? []);
  const terminals = entry.collections.terminals.use({ keys });
  const placementOf = (id: TerminalId): LivePlacement => {
    const terminal = terminals.byKey(id)?.();
    if (!terminal) return { kind: "missing" };
    return terminal.parentId === undefined || terminal.parentId === null
      ? { kind: "top-level" }
      : { kind: "split", parentId: terminal.parentId };
  };

  const session = entry.cells.session.use();

  const activityFeed = entry.cells.activityFeed.use();

  const roster = entry.cells.roster.use();

  const daemonStatus = entry.collections.daemonStatus.use({
    keys: () => [encodeHostLocation(LOCAL_LOCATION)],
  });

  return {
    terminalKeys,
    terminals,
    session,
    roster,
    activityFeed,
    daemonStatus,
    placementOf,
  };
}

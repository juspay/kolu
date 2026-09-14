// @vitest-environment happy-dom

import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { beforeEach, expect, it, vi } from "vitest";

const HOST: HostKey = { kind: "local" };
const PARENT = "parent-tile" as TerminalId;
const SPLIT = "the-split" as TerminalId;

const bag = vi.hoisted(() => ({
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
}));

vi.mock("../../wire", async () => {
  const { mockPadiMap, mockGroundedActiveHost } = await import(
    "../../hostScope/mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    activeHost: () => bag.activeHost(),
    groundedActiveHost: mockGroundedActiveHost(() => bag.activeHost()),
    padiRpcOf: () => ({ chrome: { setActive: () => Effect.void } }),
    activePadiRpc: {
      chrome: { setSubPanel: () => Effect.void },
    },
  };
});

import { activeScope } from "../../hostScope/hostScopes";
import { addHost, resetHosts } from "../../hostScope/mockHostMap.testlib";
import { useSubPanel } from "../../terminal/useSubPanel";
import { useTileStore } from "../../tile/useTileStore";
import { dockRowAttrs } from "@kolu/solid-dockrow/rowValues";
import { isActiveRow } from "./activeRow";

const [activeHost, setActiveHost] = createSignal<HostKey>(HOST);
bag.activeHost = activeHost;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetHosts();
  setActiveHost(HOST);
  localStorage.clear();
});

it("lands an explicit parent dock row on the main pane", async () => {
  await createRoot(async (dispose) => {
    const host = document.createElement("div");
    document.body.append(host);
    let disposeRows: (() => void) | undefined;
    try {
      addHost(HOST);
      await flush();
      const view = activeScope()?.view;
      if (!view) throw new Error("no active view for local host");

      useSubPanel().focusSubTab(PARENT, SPLIT);
      disposeRows = render(
        () => (
          <>
            <button
              type="button"
              data-role="parent"
              {...dockRowAttrs({
                id: PARENT,
                bucket: "idle",
                agentState: undefined,
                pip: { asking: false, alert: false },
                active: isActiveRow(PARENT),
              })}
              onClick={() => useTileStore().activate(PARENT)}
            />
            <button
              type="button"
              data-role="split"
              {...dockRowAttrs({
                id: SPLIT,
                bucket: "working",
                agentState: "thinking",
                pip: { asking: false, alert: false },
                active: isActiveRow(SPLIT),
              })}
            />
          </>
        ),
        host,
      );
      const parent = host.querySelector<HTMLButtonElement>(
        '[data-role="parent"]',
      );
      const split = host.querySelector('[data-role="split"]');
      if (!parent || !split) throw new Error("dock rows did not render");
      expect(view.focusedTerminalId()).toBe(SPLIT);
      expect(split.hasAttribute("data-active")).toBe(true);

      parent.click();

      expect({
        focused: view.focusedTerminalId(),
        splitActive: split.hasAttribute("data-active"),
      }).toEqual({ focused: PARENT, splitActive: false });
    } finally {
      disposeRows?.();
      host.remove();
      dispose();
    }
  });
});

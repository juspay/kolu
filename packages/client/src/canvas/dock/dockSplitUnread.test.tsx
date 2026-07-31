// @vitest-environment happy-dom

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
    activePadiRpc: {
      chrome: { setSubPanel: async () => {} },
    },
  };
});

import { activeScope } from "../../hostScope/hostScopes";
import { addHost, resetHosts } from "../../hostScope/mockHostMap.testlib";
import { useTileFocus } from "../../terminal/useTileFocus";
import { dockRowAttrs } from "./dockRowAttrs";

const [activeHost, setActiveHost] = createSignal<HostKey>(HOST);
bag.activeHost = activeHost;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetHosts();
  setActiveHost(HOST);
  localStorage.clear();
});

it("clears a split's unread dock dot when its sub-entry lands", async () => {
  await createRoot(async (dispose) => {
    const host = document.createElement("div");
    document.body.append(host);
    let disposeRow: (() => void) | undefined;
    try {
      addHost(HOST);
      await flush();
      const view = activeScope()?.view;
      if (!view) throw new Error("no active view for local host");

      view.markUnread(SPLIT);
      disposeRow = render(
        () => (
          <button
            type="button"
            {...dockRowAttrs({
              id: SPLIT,
              bucket: "working",
              agentState: "thinking",
              asking: false,
              unread: view.isUnread(SPLIT),
            })}
            onClick={() => useTileFocus().focusTerminal(SPLIT)}
          />
        ),
        host,
      );
      const row = host.querySelector("button");
      if (!row) throw new Error("split dock row did not render");
      expect(row.hasAttribute("data-unread")).toBe(true);

      row.click();

      expect(view.focusedTerminalId()).toBe(SPLIT);
      expect(row.hasAttribute("data-unread")).toBe(false);
    } finally {
      disposeRow?.();
      host.remove();
      dispose();
    }
  });
});

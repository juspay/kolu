// @vitest-environment happy-dom

import type { DaemonStatus } from "@kolu/padi/surface";
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import { toKavalPresence } from "./daemonPresentation";
import KavalInfoDialog from "./KavalInfoDialog";
import { kavalAttention } from "./kavalCurrency";

vi.mock("../ui/useMemoryUsage", () => ({
  kavalMemoryDisplay: () => ({ kind: "gate-format-unsupported" }),
}));

const CONNECTED_KAVAL: DaemonStatus = {
  state: "connected",
  contractVersion: "5.2",
  startedAt: 1_700_000_000_000,
  socketPath: "/run/user/1000/kaval/kaval.sock",
  identity: { staleKey: "old-kaval", navigableCommit: "7deb397" },
  lifetime: { kind: "forever" },
};

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

it("names the restart-needed mixed-version gate window", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const presence = toKavalPresence(CONNECTED_KAVAL, true);
  dispose = render(
    () => (
      <KavalInfoDialog
        open={true}
        onOpenChange={() => {}}
        presence={presence}
        attention={kavalAttention(undefined, CONNECTED_KAVAL, true)}
        restartInFlight={false}
        triggerRef={() => undefined}
        hostLabel="naiveintent"
      />
    ),
    container,
  );

  const memory = document.querySelector("[data-testid=kaval-dialog-memory]");
  expect(memory?.textContent).toContain(
    "running kaval predates this build — restart kaval to restore memory readout",
  );
  expect(memory?.textContent).not.toContain("poll failed");
});

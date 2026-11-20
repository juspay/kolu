// @vitest-environment happy-dom
import type { DaemonStatus, PadiIdentity } from "@kolu/padi-client/surface";
import { type ControlPlane, SurfaceAppProvider } from "@kolu/surface-app/solid";
import type { KoluBuildInfo, PadiLink } from "kolu-common/surface";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { toKavalPresence } from "../kaval/daemonPresentation";
import KavalInfoDialog from "../kaval/KavalInfoDialog";
import { kavalAttention } from "../kaval/kavalCurrency";
import PadiInfoDialog from "../padi/PadiInfoDialog";
import { toPadiPresence } from "../padi/padiPresentation";
import KoluInfoDialog from "../ui/KoluInfoDialog";
import RunningDaemonsSection from "../ui/RunningDaemonsSection";
import { HOST_DOWN_COPY } from "./hostDownCopy";

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
});

function mountBodyText(node: () => JSX.Element): string {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(node, container);
  disposers.push(dispose, () => container.remove());
  return document.body.textContent ?? "";
}

const KAVAL_CONTRACT = "5.2";
const KAVAL_SOCKET = "/run/user/1000/kaval/kaval.sock";

const STALE_KAVAL: DaemonStatus = {
  state: "connected",
  contractVersion: KAVAL_CONTRACT,
  startedAt: 1_700_000_000_000,
  socketPath: KAVAL_SOCKET,
  identity: { staleKey: "zest-kaval", navigableCommit: "7deb397" },
  lifetime: { kind: "forever" },
};

const KOLU_VERSION = "9.9.9";
const KOLU_SERVER_COMMIT = "5e2feed";
const KOLU_BROWSER_COMMIT = "c11e17c";

const koluControlPlane: ControlPlane<KoluBuildInfo> = {
  cells: {
    buildInfo: {
      use: () => ({
        value: () => ({ commit: KOLU_SERVER_COMMIT, version: KOLU_VERSION }),
      }),
    },
  },
};

const PADI_CONTRACT = "9.9";
const STALE_PADI_LINK: PadiLink = "connected";
const STALE_PADI_IDENTITY: PadiIdentity = {
  commit: "deadbee",
  surfaceVersion: PADI_CONTRACT,
  startedAt: 1_700_000_000_000,
  lifetime: { kind: "forever" },
};

describe("#1793 dialogs must not leak connected-era facts over a dead channel", () => {
  it("KavalInfoDialog: a stale status folded with live=false leaks NO contract badge or socket", () => {
    const presence = toKavalPresence(STALE_KAVAL, false);
    const attention = kavalAttention(undefined, STALE_KAVAL, false);
    const text = mountBodyText(() => (
      <KavalInfoDialog
        open={true}
        onOpenChange={() => {}}
        presence={presence}
        attention={attention}
        restartInFlight={false}
        triggerRef={() => undefined}
        hostLabel="zest"
      />
    ));

    expect(text).toContain("unknown");
    expect(text).not.toContain(`contract v${KAVAL_CONTRACT}`);
    expect(text).not.toContain(KAVAL_SOCKET);
  });

  it("KavalInfoDialog: offers NO 'Restart kaval' AFFORDANCE (nor its promise copy) over a dead channel", () => {
    const presence = toKavalPresence(STALE_KAVAL, false);
    const attention = kavalAttention(undefined, STALE_KAVAL, false);
    const text = mountBodyText(() => (
      <KavalInfoDialog
        open={true}
        onOpenChange={() => {}}
        presence={presence}
        attention={attention}
        restartInFlight={false}
        triggerRef={() => undefined}
        hostLabel="zest"
      />
    ));

    expect(text).not.toContain("Restart kaval");
    expect(text.toLowerCase()).not.toContain("captures the session");
  });

  it("KoluInfoDialog: server version + commit are gated by `live=false`, so neither leaks", () => {
    const text = mountBodyText(() => (
      <SurfaceAppProvider
        controlPlane={koluControlPlane}
        clientCommit={KOLU_BROWSER_COMMIT}
        fault={() => null}
      >
        <KoluInfoDialog
          open={true}
          onOpenChange={() => {}}
          status="closed"
          live={false}
          dotClass="bg-danger"
          triggerRef={() => undefined}
        />
      </SurfaceAppProvider>
    ));

    expect(text).toContain("disconnected");
    expect(text).toContain(KOLU_BROWSER_COMMIT);
    expect(text).not.toContain(`v${KOLU_VERSION}`);
    expect(text).not.toContain(KOLU_SERVER_COMMIT);
  });

  it("PadiInfoDialog: a stale link+identity folded with live=false leaks NO contract badge", () => {
    const presence = toPadiPresence(
      STALE_PADI_LINK,
      false,
      STALE_PADI_IDENTITY,
    );
    const text = mountBodyText(() => (
      <PadiInfoDialog
        open={true}
        onOpenChange={() => {}}
        presence={presence}
        startedAt={1_700_000_000_000}
        triggerRef={() => undefined}
        hostLabel="zest"
      />
    ));

    expect(text).toContain("unknown");
    expect(text).not.toContain(`contract v${PADI_CONTRACT}`);
  });

  it("RunningDaemonsSection: a FAILED host's copy names the failure, never 'connecting' (the #1793 second defect)", () => {
    const text = mountBodyText(() => (
      <RunningDaemonsSection
        noun="padi"
        testidPrefix="padi"
        boundHost={null}
        scan={{ kind: "failed", cause: "cross-supervisor" }}
        boundHostRows={[]}
        localScanRows={[]}
        localScanLive={true}
        renderRow={() => null}
      />
    ));

    expect(text).toContain(HOST_DOWN_COPY["cross-supervisor"].title);
    expect(text.toLowerCase()).not.toContain("is connecting");
  });

  it("RunningDaemonsSection: a not-live LOCAL scan reads 'unavailable', never its retained rows (codex F3)", () => {
    const STALE_LOCAL_SOCKET = "/run/user/1000/padi-stale/padi.sock";
    const text = mountBodyText(() => (
      <RunningDaemonsSection
        noun="padi"
        testidPrefix="padi"
        boundHost="zest"
        scan={{ kind: "no-frame" }}
        boundHostRows={[]}
        localScanRows={[STALE_LOCAL_SOCKET]}
        localScanLive={false}
        renderRow={(row) => <span>{row}</span>}
      />
    ));

    expect(text.toLowerCase()).toContain("unavailable");
    expect(text).not.toContain(STALE_LOCAL_SOCKET);
  });
});

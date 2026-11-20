import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import { type Component, createSignal, Show } from "solid-js";
import { daemonTransportLive, serverDot } from "../kaval/useDaemonStatus";
import type { WsStatus } from "../rpc/rpc";
import { CHROME_MARK_ROW_CLASS } from "./chromeSpacing";
import { IdentityMark, identityMarkBtnClass, StatusDot } from "./IdentityMark";
import { joinTip } from "./joinTip";
import KoluInfoDialog from "./KoluInfoDialog";
import { mibText } from "./memory";
import { clientStale, liveServerBuild, StaleBadge } from "./StaleBadge";
import Tip from "./Tip";
import { clientHeapUsedBytes, serverRssBytes } from "./useMemoryUsage";

const koluIdentityBtnClass = identityMarkBtnClass;

const IdentityRail: Component<{ status: WsStatus }> = (props) => {
  const pwa = useSurfaceApp<KoluBuildInfo>();
  const daemonLive = daemonTransportLive;
  const [koluDialogOpen, setKoluDialogOpen] = createSignal(false);
  let triggerEl!: HTMLButtonElement;
  const stale = clientStale;

  const liveServer = liveServerBuild;
  const koluTip = (): string =>
    joinTip(
      `kolu ${props.status}${daemonLive() ? "" : " (watchdog reconnecting)"}`,
      liveServer()?.version ? `server v${liveServer()?.version}` : undefined,
      liveServer()?.commit ? `server ${liveServer()?.commit}` : undefined,
      `server RSS ${mibText(serverRssBytes())}`,
      daemonLive()
        ? stale()
          ? "client build differs from server"
          : "client build matches server"
        : undefined,
      pwa.clientCommit ? `client ${pwa.clientCommit}` : undefined,
      `client heap ${mibText(clientHeapUsedBytes())}`,
    );

  return (
    <div class={`${CHROME_MARK_ROW_CLASS} font-mono text-xs`}>
      <Tip label={koluTip()}>
        <button
          type="button"
          ref={triggerEl}
          data-testid="kolu-identity-chip"
          onClick={() => setKoluDialogOpen((v) => !v)}
          class={koluIdentityBtnClass}
          aria-label={koluTip()}
          aria-expanded={koluDialogOpen()}
        >
          <IdentityMark logoSrc="/favicon.svg">
            <StatusDot
              class={serverDot(props.status, daemonLive())}
              data-ws-status={props.status}
            />
          </IdentityMark>
        </button>
      </Tip>
      <Show when={stale()}>
        <StaleBadge />
      </Show>

      <KoluInfoDialog
        open={koluDialogOpen()}
        onOpenChange={setKoluDialogOpen}
        status={props.status}
        live={daemonLive()}
        dotClass={serverDot(props.status, daemonLive())}
        triggerRef={() => triggerEl}
      />
    </div>
  );
};

export default IdentityRail;

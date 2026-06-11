/** IdentityRail — the consolidated "which kolu am I running" chrome readout
 *  (R-4 A2 + B). A `srv · pty · client` rail: `srv` is the server you're
 *  connected to (its commit + the WebSocket liveness dot), `pty` is the
 *  surviving pty-host daemon serving your terminals (its commit + the
 *  closure-hash build, from surface-app's `buildInfo` cell's `ptyHost` axis),
 *  and `client` is the commit this browser's JS was built from.
 *
 *  A2 built the rail in its final two-column shape while the pty-host was
 *  in-process (the columns always coincided — the acceptance signal). Phase B
 *  gives `pty` a separate, surviving process, so the columns can now DIVERGE: a
 *  deploy restarts the server but the old daemon lives on, a build behind, until
 *  it's restarted. The rail makes that honest — `≡ current` when the daemon is
 *  the deployed build, `⬆ update pending` when it's older — with no re-layout,
 *  exactly as A2 designed.
 *
 *  `client` flags a stale browser bundle (old JS from cache against a freshly
 *  deployed server) with `≠ srv` when both refs are clean and disagree. */

import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import type { WsStatus } from "../rpc/rpc";
import Commit from "./Commit";
import { clientStale, StaleBadge } from "./StaleBadge";
import Tip from "./Tip";

/** WebSocket transport status → the `srv` liveness dot. */
const srvDot: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

/** Short-form a build id for display: a nix store hash's leading 7 chars, or
 *  a path basename capped at 12. The full id lives in the tooltip. */
function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  const hash = /^([a-z0-9]{7})/.exec(id);
  if (hash) return hash[1] as string;
  const tail = id.split("/").pop() ?? id;
  return tail.length > 12 ? `${tail.slice(0, 12)}…` : tail;
}

/** The daemon's currency, as a state to render. The verdict itself is decided
 *  server-side (`buildInfoValue` in surface.ts, where both staleKeys are in
 *  hand) and rides the `ptyHostCurrency` field; the rail only overlays the
 *  client-only WS guard: a down link can't claim currency, so `unknown`. */
type PtyState = "current" | "outdated" | "unknown";

const ptyDot: Record<PtyState, string> = {
  current: "bg-ok",
  outdated: "bg-warning",
  unknown: "bg-fg-3/50", // link down → pty state unknown, not dead
};

const IdentityRail: Component<{ status: WsStatus }> = (props) => {
  // The server's build identity (its commit + the daemon's relayed identity)
  // rides surface-app's `buildInfo` cell. `clientCommit` is this bundle's baked
  // commit; `stale` is the shared client-staleness derivation.
  const pwa = useSurfaceApp<KoluBuildInfo>();
  const stale = clientStale;

  const ptyState = (): PtyState => {
    // A down link can't vouch for currency — overlay `unknown` over whatever the
    // last server verdict was (client-only WS state the server can't know).
    if (props.status !== "open") return "unknown";
    return pwa.server()?.ptyHostCurrency ?? "unknown";
  };

  return (
    <div class="inline-flex items-stretch rounded-lg border border-edge bg-surface-2/60 p-0.5 font-mono text-xs">
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5">
        <span class="text-[9px] uppercase tracking-wide text-fg-3">srv</span>
        <Tip label="Server connection">
          <span
            data-ws-status={props.status}
            class={`inline-block h-[7px] w-[7px] rounded-full ${srvDot[props.status]}`}
          />
        </Tip>
        <Show when={pwa.server()?.version}>
          {(v) => (
            <Tip label="kolu version">
              <span class="tabular-nums text-fg-2">v{v()}</span>
            </Tip>
          )}
        </Show>
        <Commit sha={pwa.server()?.commit} />
      </span>
      <span class="mx-0.5 h-4 w-px self-center bg-edge-bright/70" />
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5">
        <span class="text-[9px] uppercase tracking-wide text-fg-3">pty</span>
        <Tip label="Terminal-host daemon (survives a server restart)">
          <span
            data-pty-state={ptyState()}
            class={`inline-block h-[7px] w-[7px] rounded-full ${ptyDot[ptyState()]}`}
          />
        </Tip>
        <Commit sha={pwa.server()?.ptyHost?.navigableCommit} />
        <Show when={pwa.server()?.ptyHost?.staleKey}>
          {(key) => (
            <Tip
              label={`build ${key()} — @kolu/pty-host closure hash (staleness key)`}
            >
              <span class="cursor-help border-b border-dotted border-fg-3/50 text-[10px] text-fg-3">
                {shortId(key())}
              </span>
            </Tip>
          )}
        </Show>
      </span>
      <Show when={ptyState() === "current"}>
        <Tip label="The daemon is running the deployed build.">
          <span class="ml-1 self-center rounded-full border border-accent/40 px-1.5 text-[9px] leading-4 text-accent">
            ≡ current
          </span>
        </Tip>
      </Show>
      <Show when={ptyState() === "outdated"}>
        <Tip label="A surviving daemon is a build behind — restart it to pick up the deployed pty-host.">
          <span class="ml-1 self-center rounded-full border border-warning/50 px-1.5 text-[9px] leading-4 text-warning">
            ⬆ update pending
          </span>
        </Tip>
      </Show>
      <span class="mx-0.5 h-4 w-px self-center bg-edge-bright/70" />
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5">
        <span class="text-[9px] uppercase tracking-wide text-fg-3">client</span>
        <Tip label="This browser's JS build (baked in at build time)">
          <Commit sha={pwa.clientCommit} />
        </Tip>
        <Show when={stale()}>
          <Tip label="This client build doesn't match the server — reload to pick up the server's version.">
            <StaleBadge />
          </Tip>
        </Show>
      </span>
    </div>
  );
};

export default IdentityRail;

import type { DaemonStatus } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import type { UiAction } from "../runAction";
import { activePadiRpc, client } from "../wire";
import { daemonChannelLive, liveWarming } from "./useDaemonStatus";

const [restarting, setRestarting] = createSignal(false);

export function restartInFlight(status: DaemonStatus | undefined): boolean {
  return restarting() || liveWarming(status?.state, daemonChannelLive());
}

export function restartDaemon(): UiAction {
  return Effect.suspend(() => {
    if (restarting()) return Effect.void;
    setRestarting(true);
    const id = toast.loading("Restarting kaval…");
    return activePadiRpc.lifecycle.recycleKaval().pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          toast.success(
            "kaval restarted — your session is offered for restore",
            {
              id,
            },
          );
        }),
      ),
      Effect.catchTag("KavalContractSkew", (skew) =>
        Effect.sync(() => {
          toast.error(
            `Couldn’t restart kaval: ${skew.message} — restarting can’t fix that. Use “Update & restart kaval”.`,
            { id },
          );
        }),
      ),
      Effect.catch((err) =>
        Effect.sync(() => {
          toast.error(`Couldn’t restart kaval: ${toError(err).message}`, {
            id,
          });
        }),
      ),
      Effect.ensuring(Effect.sync(() => setRestarting(false))),
    );
  });
}

const [renewingHosts, setRenewingHosts] = createSignal<ReadonlySet<string>>(
  new Set(),
);

export function renewInFlight(host: HostKey): boolean {
  return renewingHosts().has(encodeHostKey(host));
}

export function renewDaemon(host: HostKey): UiAction {
  return Effect.suspend(() => {
    const key = encodeHostKey(host);
    if (renewingHosts().has(key)) return Effect.void;
    setRenewingHosts((s) => new Set(s).add(key));
    const id = toast.loading("Updating & restarting kaval…");
    return client.hosts.renewDaemon({ host }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          toast.success(
            "Host daemon drained — re-provisioning the current build; kaval reconnects shortly",
            { id },
          );
        }),
      ),
      Effect.catch((err) =>
        Effect.sync(() => {
          toast.error(`Couldn’t update kaval: ${toError(err).message}`, { id });
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          setRenewingHosts((s) => {
            const next = new Set(s);
            next.delete(key);
            return next;
          });
        }),
      ),
    );
  });
}

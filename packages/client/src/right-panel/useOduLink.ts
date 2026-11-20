import { hostKeysEqual as sameHost } from "kolu-common/hostKey";
import { serviceBind } from "@odu/service-client/endpoint";
import { createKeyedRoot } from "@kolu/surface/solid";
import { Effect } from "effect";
import { createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { isActiveHostLocal } from "../kaval/useDaemonStatus";
import { forwardsForHost, viewerHost } from "../forwards/useForwards";
import { portAction } from "../forwards/portAction";
import {
  claimBlankTab,
  openThroughDoor,
  type UrlRemainder,
  urlForPort,
} from "../forwards/openPort";
import { runAction } from "../runAction";
import { activeHost, padiMap } from "../wire";
import { useShown } from "../ui/shown";
import { portReach } from "kolu-common/surface";

const rootRemainder = (hash: string): UrlRemainder => ({
  pathname: "/",
  search: "",
  hash,
});

export type OduLinkAct = { kind: "address"; href: string } | { kind: "door" };

export function oduLinkAct(opts: {
  hash: string;
  port: number;
  onKoluHost: boolean;
  viewerOnHost: boolean;
  doorPort: number | undefined;
  pageHost: string;
}): OduLinkAct | undefined {
  const action = portAction({
    reach: portReach({ scope: "loopback", onKoluHost: opts.onKoluHost }),
    viewerOnHost: opts.viewerOnHost,
  });
  const decided = urlForPort({
    action,
    remotePort: opts.port,
    doorPort: opts.doorPort,
    pageHost: opts.pageHost,
    remainder: rootRemainder(opts.hash),
  });
  if (decided.kind === "ready") return { kind: "address", href: decided.url };
  if (decided.kind === "needs-door") return { kind: "door" };
  return undefined;
}

export interface OduLinkOutlet {
  act: (hash: string) => OduLinkAct | undefined;
  open: (hash: string) => void;
}

export function useOduLink(): OduLinkOutlet {
  const host = () => activeHost();
  const shown = useShown();

  const service = createKeyedRoot(
    () => (shown() ? host() : null),
    (key) => (key === null ? null : padiMap.entry(key).odu.cells.service.use()),
  );

  const port = (): number | undefined => {
    const origin = service()?.value()?.identity.origin ?? "";
    return origin === "" ? undefined : serviceBind(origin).port;
  };

  const viewerOnHost = createMemo(() => {
    const v = viewerHost();
    return v !== null && sameHost(v, host());
  });

  const doorPort = (port: number): number | undefined =>
    forwardsForHost(host()).find((f) => f.remotePort === port)?.localPort;

  const opening = new Set<string>();

  return {
    act: (hash) => {
      const p = port();
      if (p === undefined) return undefined;
      return oduLinkAct({
        hash,
        port: p,
        onKoluHost: isActiveHostLocal(),
        viewerOnHost: viewerOnHost(),
        doorPort: doorPort(p),
        pageHost: window.location.hostname,
      });
    },
    open: (hash) => {
      const p = port();
      if (p === undefined) {
        toast.error("odu is no longer listening on this host");
        return;
      }
      if (opening.has(hash)) return;
      opening.add(hash);
      // Claimed on the CALLING stack, before anything suspends: a popup blocker
      // judges `window.open` by descent from the user gesture.
      const tab = claimBlankTab();
      runAction(
        "open odu web",
        openThroughDoor({
          host: host(),
          port: p,
          tab,
          remainder: rootRemainder(hash),
        }).pipe(Effect.ensuring(Effect.sync(() => opening.delete(hash)))),
      );
    },
  };
}

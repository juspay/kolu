import type { Logger } from "@kolu/log";
import { ODU_FORWARDING_POLICY, oduSibling } from "@kolu/padi-client/surface";
import {
  type Connector,
  makeSession,
  reServeSurface,
  unixSocketConnector,
} from "@kolu/surface-remote";
import type { SurfaceClientLike } from "@kolu/surface/project";
import type { SurfaceHandlers } from "@kolu/surface/server";
import { readServiceCell } from "@odu/service-client/dial";
import { serviceSocketPath } from "@odu/service-client/socket";
import {
  admitService,
  CHECKOUT_NONE,
  CI_NEEDS,
  oduServiceClientOver,
  oduServiceSurface,
} from "@odu/service-client/surface";
import { Effect } from "effect";

export interface OduSibling {
  handlers: SurfaceHandlers;
  close: () => Promise<void>;
}

export function serveOduSibling(deps: { log: Logger }): OduSibling {
  const log = deps.log;
  const connectOnce: Connector<SurfaceClientLike, never> = unixSocketConnector({
    socketPath: () => serviceSocketPath(),
    group: oduServiceSurface.group,
    client: (dispatch) =>
      oduServiceClientOver(dispatch) as unknown as SurfaceClientLike,
    describe: "the odu service",
  });
  const session = makeSession<SurfaceClientLike, never>({
    connectOnce,
    initialConnection: "connecting",
    admit: async (client) => {
      const cell = await Effect.runPromise(readServiceCell(client as never));
      const verdict = admitService(cell, serviceSocketPath(), CI_NEEDS);
      if (verdict.kind === "adopt") return { kind: "adopt" };
      const { kind: _refuse, message, ...refusal } = verdict;
      log.error(refusal, `padi: ${message}`);
      return {
        kind: "refuse",
        state: { error: message, cause: "remote" },
      };
    },
    log,
    label: "odu",
  });
  const served = reServeSurface({
    source: oduSibling,
    policy: ODU_FORWARDING_POLICY,
    session,
    absent: { checkout: CHECKOUT_NONE },
    log: (line) => log.debug({ line }, "padi: odu sibling"),
    onFault: (fault) =>
      log.error(
        { err: fault.err, member: fault.label, scope: fault.scope },
        "padi: the odu sibling's mirror died",
      ),
  });
  return {
    handlers: served.handlers,
    close: async () => {
      await served.close();
      session.destroy();
    },
  };
}

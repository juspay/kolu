/**
 * padi's odu SIBLING — odu's own surface, re-served off its own socket.
 *
 * odu is a per-user singleton that outlives its callers, speaks its own
 * contract, and is absent on most machines. It is a NEIGHBOUR, not a part of
 * padi — so what padi owes it is a link, and nothing else: no fold of its data,
 * no copy of its schemas, no opinion about which of its runs matter. A reader
 * subscribes to odu's `checkout` stream through padi exactly as odu's own board
 * page subscribes to it.
 *
 * Everything that USED to live here — a dial ladder, a ref-counted session, a
 * retire grace, a board fold, a nodes follow reopened on every latest-run swap —
 * is the framework's now:
 *
 *   - `unixSocketConnector` owns the dial, and is the one thing that can tell
 *     "nothing is serving" (ENOENT/ECONNREFUSED on a unix path) from "it broke";
 *   - `makeSession` owns the reconnect loop, the give-up budget, and the
 *     `absent` steady state — probed at the ceiling, logged at debug, never
 *     aging into a terminal failure;
 *   - `reServeSurface` owns the demand gate (nothing dials while nobody is
 *     looking; the link is let go a grace after the last subscriber leaves) and
 *     the hold-open relays, including the absent frame that CLEARS a reader when
 *     the daemon is stopped.
 *
 * What is left is the three facts only this file knows: where odu's socket is,
 * what its face is built from, and what "nothing to say about this checkout"
 * looks like — and all three are odu's own values, imported rather than stated.
 */

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

/** The odu sibling, served — the handlers padi merges into its own, and the
 *  teardown the daemon's lifetime owns. */
export interface OduSibling {
  /** Bound at `surface/odu/*`, ready to merge into padi's handler record. */
  handlers: SurfaceHandlers;
  /** Let the session and its re-serve go (a daemon stop, a test's rebuild). */
  close: () => Promise<void>;
}

export function serveOduSibling(deps: { log: Logger }): OduSibling {
  const log = deps.log;
  const connectOnce: Connector<SurfaceClientLike, never> = unixSocketConnector({
    // A THUNK: odu's socket path is derived from its origin
    // (`ODU_WEB_ORIGIN`), which a redial must re-read rather than remember.
    socketPath: () => serviceSocketPath(),
    group: oduServiceSurface.group,
    client: (dispatch) =>
      oduServiceClientOver(dispatch) as unknown as SurfaceClientLike,
    describe: "the odu service",
  });
  const session = makeSession<SurfaceClientLike, never>({
    connectOnce,
    initialConnection: "connecting",
    // ADOPT OR REFUSE, on odu's own verdict. The comparison is `admitService` —
    // odu's, beside the version it is about — so this file never compares
    // contract versions and cannot get the direction of that comparison
    // backwards. padi DECLARES the rows it reads — the runs, `CI_NEEDS`, and
    // nothing else — so a daemon whose cache, door or tunnel moved a major is
    // still adopted; only the host or the runs row can refuse it. A refusal is LOUD and does NOT retry at the floor: the session
    // publishes it as a down arm, which is a different thing from the quiet
    // `absent` a machine without odu sits in, and the difference is exactly what
    // a reader needs (a blank for "no odu here", a stated problem for "an odu
    // this build cannot read").
    admit: async (client) => {
      const cell = await Effect.runPromise(readServiceCell(client as never));
      const verdict = admitService(cell, serviceSocketPath(), CI_NEEDS);
      if (verdict.kind === "adopt") return { kind: "adopt" };
      // The refusal's OWN facts — `on`, and per arm `row` / `speaks` /
      // `expected` — logged as odu states them, never as a shape guessed here.
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
    // The SIBLING surface, so the handlers below are bound at `surface/odu/*`
    // and merge into padi's own record with nothing to re-prefix.
    source: oduSibling,
    policy: ODU_FORWARDING_POLICY,
    session,
    // What a subscriber is told when odu is not there. A hold-open relay saying
    // nothing is right for a link that is coming back and wrong for a daemon
    // that was stopped — the reader would paint the last board forever. The
    // value is odu's own "nothing to say about this checkout".
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

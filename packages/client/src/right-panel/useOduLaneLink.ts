/**
 * The Inspector's way OUT to odu web — a lane, and the log page that lane is.
 *
 * odu's own page is where an attempt's output is read (searchable, coloured,
 * followed live), so kolu links to it rather than drawing a second log pane. The
 * link has to work from a browser that is usually NOT on the daemon's machine —
 * odu binds loopback — which is the problem kolu's port forwarding already
 * solves, so every piece of this is REUSED rather than re-derived:
 *
 *   - the address is odu's own (`@odu/service-client/routes`), minted from the
 *     lane's wire fields;
 *   - `portReach` · `portAction` decide, exactly as the Ports section asks it,
 *     whether the browser reaches `127.0.0.1:<odu's port>` on that host itself;
 *   - `urlForPort` · `openThroughDoor` build the URL and open a door when there
 *     is none, so the href a row offers and the tab a click opens are one URL.
 *
 * `openPort.ts`'s three layers stay where they are: this module decides WHICH
 * lane address to point at and hands the row an act, it does not open anything
 * itself.
 */

import { logHash, runHash } from "@odu/service-client/routes";
import {
  DEFAULT_SERVICE_ORIGIN,
  serviceBind,
} from "@odu/service-client/endpoint";
import { hostKeysEqual as sameHost } from "kolu-common/hostKey";
import type { RunNode, RunRow } from "@odu/service-client/surface";
import { Effect } from "effect";
import { createMemo } from "solid-js";
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
import { activeHost } from "../wire";
import { portReach } from "kolu-common/surface";

/** odu's service port, read off odu's own default origin: the address is the
 *  daemon's contract (`./endpoint` owns it), and a literal 18440 here would be a
 *  second answer to "where is odu". */
const ODU_PORT = serviceBind(DEFAULT_SERVICE_ORIGIN).port;

/** odu web's own page is the door's whole path — the fragment carries the run. */
const rootRemainder = (hash: string): UrlRemainder => ({
  pathname: "/",
  search: "",
  hash,
});

/** The fragment a lane's row points at: its own log page, or — for a lane that
 *  never started — the run page.
 *
 *  odu names "no attempt yet" as an EMPTY log key (`RunNode.logKey`: a node on
 *  the roster with no attempt carries `""` rather than a fabricated attempt 1,
 *  "which would name evidence that does not exist"), so that is the fact read
 *  here. A lane with no log has no log page to open; the run page is where it is
 *  read, which is also what odu's own router does with an address naming no
 *  attempt. */
export function laneHash(
  run: Pick<RunRow, "runId">,
  lane: Pick<RunNode, "logKey">,
): string {
  return lane.logKey === "" ? runHash(run.runId) : logHash(lane.logKey);
}

/** What a lane row does: an address the browser can open, or the need for a door
 *  first. The difference is real and a row shows it — a link can be copied,
 *  ⌘-clicked and opened in a new tab, and there is nothing to copy until a relay
 *  is listening. */
export type OduLaneAct = { kind: "address"; href: string } | { kind: "door" };

/** The lane-link decision, pure and total over its inputs so it is testable
 *  without a socket or a render. */
export function oduLaneAct(opts: {
  /** odu web's fragment for this lane ({@link laneHash}). */
  hash: string;
  /** Is the daemon's host the kolu server's own? — `portReach`'s half of the
   *  judgement, asked exactly as the Ports section asks it. */
  onKoluHost: boolean;
  /** Is the browser sitting at the daemon's host? */
  viewerOnHost: boolean;
  /** The local port of the door already open to odu on this host, if one is. */
  doorPort: number | undefined;
  /** `window.location.hostname` — the host this page was served from. */
  pageHost: string;
}): OduLaneAct {
  // A LOOPBACK scope, because that is what odu binds — the same judgement the
  // Ports section makes about a loopback listener: a door is the ordinary case
  // rather than an exotic one, because `http://<host>:18440` reaches nothing on
  // a machine the browser is not sitting at.
  const action = portAction({
    reach: portReach({ scope: "loopback", onKoluHost: opts.onKoluHost }),
    viewerOnHost: opts.viewerOnHost,
  });
  const decided = urlForPort({
    action,
    remotePort: ODU_PORT,
    doorPort: opts.doorPort,
    pageHost: opts.pageHost,
    remainder: rootRemainder(opts.hash),
  });
  if (decided.kind === "ready") return { kind: "address", href: decided.url };
  if (decided.kind === "needs-door") return { kind: "door" };
  // Unreachable: a loopback scope is `needs-forward` on both halves of
  // `onKoluHost`, and both of those actions have a URL of their own (`viewer`) or
  // a door (`forward`). A `none` here would mean that fold changed shape, and
  // quietly offering a door instead would promise a relay that cannot answer.
  throw new Error(
    "odu lane link: a loopback port was judged unreachable — the reach fold changed shape",
  );
}

/** What the Work section is handed: how to read a lane's address, and how to
 *  open one that needs a door.
 *
 *  It takes the ROW AND THE LANE rather than an address, so which page a lane
 *  points at ({@link laneHash}) has one spelling — and because the section is
 *  deliberately wire-free, the facts behind the answer (which host, whether a
 *  door exists) arrive as this function rather than as an import. */
export interface OduLaneOutlet {
  act: (
    run: Pick<RunRow, "runId">,
    lane: Pick<RunNode, "logKey">,
  ) => OduLaneAct;
  open: (run: Pick<RunRow, "runId">, lane: Pick<RunNode, "logKey">) => void;
}

/** The Inspector's outlet — opened once, beside the CI readout it belongs to. */
export function useOduLaneLink(): OduLaneOutlet {
  const host = () => activeHost();

  /** Is the browser sitting at the daemon's host? One fact about the PAGE,
   *  derived once per host change rather than inside every row. A `null` viewer
   *  host is "kolu cannot tell", which must read as NOT a match — that keeps the
   *  door, which works. */
  const viewerOnHost = createMemo(() => {
    const v = viewerHost();
    return v !== null && sameHost(v, host());
  });

  /** The door already open to odu on this host, when one is: its port goes
   *  through the same `urlForPort` the click does, so the address a row offers
   *  and the address a click opens cannot disagree. */
  const doorPort = createMemo(
    () =>
      forwardsForHost(host()).find((f) => f.remotePort === ODU_PORT)?.localPort,
  );

  /** The lanes whose door is being opened right now. A row is a button only
   *  while no door is listening, so a second click in that window is a second
   *  tab pointed at the same address — the door itself is idempotent, the tab is
   *  not. Cleared by the effect's own finalizer, so a failed or interrupted open
   *  leaves the row clickable. */
  const opening = new Set<string>();

  return {
    act: (run, lane) =>
      oduLaneAct({
        hash: laneHash(run, lane),
        onKoluHost: isActiveHostLocal(),
        viewerOnHost: viewerOnHost(),
        doorPort: doorPort(),
        pageHost: window.location.hostname,
      }),
    open: (run, lane) => {
      const hash = laneHash(run, lane);
      if (opening.has(hash)) return;
      opening.add(hash);
      // Claimed on the CALLING stack, before anything suspends: a popup blocker
      // judges `window.open` by descent from the user gesture.
      const tab = claimBlankTab();
      runAction(
        "open odu web",
        openThroughDoor({
          host: host(),
          port: ODU_PORT,
          tab,
          remainder: rootRemainder(hash),
        }).pipe(Effect.ensuring(Effect.sync(() => opening.delete(hash)))),
      );
    },
  };
}

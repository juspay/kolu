/**
 * The Inspector's way OUT to odu web — a lane's log page, or a run's page.
 *
 * ONE hook for every odu link the Inspector paints (a lane row, a recent-runs
 * row, the chip itself): the caller mints the FRAGMENT (`#/run/<runId>`, or
 * odu's `logHash` for one attempt) and this decides whether an address exists
 * yet and dials the daemon through the same door mechanism for all of them.
 * Two URL builders or two reach decisions for the same daemon is how one of
 * them comes to point at a port nothing serves.
 *
 * odu's own page is where an attempt's output is read (searchable, coloured,
 * followed live), so kolu links to it rather than drawing a second log pane. The
 * link has to work from a browser that is usually NOT on the daemon's machine —
 * odu binds loopback — which is the problem kolu's port forwarding already
 * solves, so every piece of this is REUSED rather than re-derived:
 *
 *   - the address is odu's own (`@odu/service-client/routes`), minted from the
 *     lane's wire fields, and the PORT is odu's own too — its `service` cell's
 *     `identity.origin` read through padi's odu sibling, via `serviceBind`;
 *   - `portReach` · `portAction` decide, exactly as the Ports section asks it,
 *     whether the browser reaches `127.0.0.1:<odu's port>` on that host itself;
 *   - `urlForPort` · `openThroughDoor` build the URL and open a door when there
 *     is none, so the href a row offers and the tab a click opens are one URL.
 *
 * `openPort.ts`'s three layers stay where they are: this module decides WHICH
 * lane address to point at and hands the row an act, it does not open anything
 * itself.
 */

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
import { usePanelShown } from "./panelShown";
import { portReach } from "kolu-common/surface";

/** odu web's own page is the door's whole path — the fragment carries the run. */
const rootRemainder = (hash: string): UrlRemainder => ({
  pathname: "/",
  search: "",
  hash,
});

/** What an odu link does: an address the browser can open, or the need for a
 *  door first. The difference is real and a row shows it — a link can be copied,
 *  ⌘-clicked and opened in a new tab, and there is nothing to copy until a relay
 *  is listening. */
export type OduLinkAct = { kind: "address"; href: string } | { kind: "door" };

/** The link decision, pure and total over its inputs so it is testable without
 *  a socket or a render. */
export function oduLinkAct(opts: {
  /** odu web's fragment for this link's subject. */
  hash: string;
  /** The port the daemon ANSWERED ON — read off odu's own `service` cell
   *  (`identity.origin`, the OS's answer to its bind) rather than defaulted in a
   *  browser, where the daemon's address is not knowable: a developer running a
   *  second odu on another port is the ordinary case, not an exotic one. */
  port: number;
  /** Is the daemon's host the kolu server's own? — `portReach`'s half of the
   *  judgement, asked exactly as the Ports section asks it. */
  onKoluHost: boolean;
  /** Is the browser sitting at the daemon's host? */
  viewerOnHost: boolean;
  /** The local port of the door already open to odu on this host, if one is. */
  doorPort: number | undefined;
  /** `window.location.hostname` — the host this page was served from. */
  pageHost: string;
}): OduLinkAct {
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
    remotePort: opts.port,
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
    "odu link: a loopback port was judged unreachable — the reach fold changed shape",
  );
}

/** What the Work section is handed: how to read a lane's address, and how to
 *  open one that needs a door.
 *
 *  It takes the FRAGMENT rather than an address, so which page a lane points at
 *  is the CALLER's spelling of odu's own `runHash`/`logHash` — and the facts
 *  behind the answer (which host, where odu is listening, whether a door exists)
 *  arrive as this function rather than as imports, so a test can assert what a
 *  row offers without a wire. */
export interface OduLinkOutlet {
  /** Where this fragment lives, or `undefined` while odu has not said where it
   *  is listening — a row with no way out yet, which is inert rather than a
   *  guess at a port. */
  act: (hash: string) => OduLinkAct | undefined;
  open: (hash: string) => void;
}

/** The Inspector's outlet — opened once, beside the CI readout it belongs to. */
export function useOduLink(): OduLinkOutlet {
  const host = () => activeHost();
  const shown = usePanelShown();

  /** WHERE odu is listening on the active host — odu's OWN greeting, carried
   *  through padi's odu sibling (`entry(h).odu.cells.service`). The daemon's
   *  origin is a fact of its own lifecycle (its environment, its flags), so it
   *  is read from the daemon rather than re-derived from a default here.
   *
   *  SHOWN-GATED like the readout it serves, and gated by DISPOSAL rather than
   *  by a null input because a cell takes none: `createKeyedRoot` tears the
   *  subscription down when the panel is hidden (or the host changes), and
   *  padi's re-serve lets the odu link go a grace after its last subscriber —
   *  so a closed panel dials nothing. */
  const service = createKeyedRoot(
    () => (shown() ? host() : null),
    (key) => (key === null ? null : padiMap.entry(key).odu.cells.service.use()),
  );

  /** odu's port, or `undefined` while nothing has answered. `UNKNOWN_SERVICE`'s
   *  empty origin is the pre-frame default — a service that has said nothing
   *  about itself — and parsing it would be inventing an address. `serviceBind`
   *  is odu's own reading of its origin; a second parse here is how the href a
   *  row offers comes to disagree with the daemon. */
  const port = (): number | undefined => {
    const origin = service()?.value()?.identity.origin ?? "";
    return origin === "" ? undefined : serviceBind(origin).port;
  };

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
  const doorPort = (port: number): number | undefined =>
    forwardsForHost(host()).find((f) => f.remotePort === port)?.localPort;

  /** The lanes whose door is being opened right now. A row is a button only
   *  while no door is listening, so a second click in that window is a second
   *  tab pointed at the same address — the door itself is idempotent, the tab is
   *  not. Cleared by the effect's own finalizer, so a failed or interrupted open
   *  leaves the row clickable. */
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
      // The row was a door-opener because a port existed; odu stopping between
      // the paint and the click is ordinary, so say what happened rather than
      // opening a tab at a port nothing serves.
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

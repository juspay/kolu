/**
 * Join a printed URL to what the scanner observed — the PRT4 decision, widened
 * to the whole host.
 *
 * A printed URL is an ENTRY POINT, never a fact. This function only looks up
 * what observation already established (the tile's ports, the host's listeners,
 * live forwards). It never creates a door from text — that is the VS Code trap
 * this feature exists to invert.
 *
 * It used to consult only the tile, so a server that detached from the terminal
 * that printed its URL (an `odu web-daemon`, anything under `setsid`) read
 * "nothing is listening yet" — a claim about the machine made from a look at one
 * subtree. "Nothing is listening" is now said only when the HOST reading
 * positively holds no such port.
 *
 * `portReach` stays the single reachability judge; a listening result carries
 * the scanned bind so a caller can ask `portReach` / `portAction` rather than
 * re-deriving scope.
 */

import {
  type HostListeners,
  type KoluForward,
  listenerAt,
  type PortInfo,
  type PortBind,
} from "kolu-common/surface";
import { parseLoopbackUrl } from "@kolu/url-shape";

/** What the join finds for a printed URL.
 *
 *  - `external`  — not a loopback URL; leave the default open alone
 *  - `joined`    — this tile's own subtree serves the port
 *  - `elsewhere` — a readable program elsewhere on the host serves it
 *  - `unclaimed` — something on the host serves it; its owner is not visible
 *  - `unbacked`  — the host was read, and nothing is listening on that port
 *  - `blind`     — could not tell: the host is not read, or the port is not
 *                  claimed and the unclaimed half is blind (`unknown` is never "no")
 */
export type PrintedUrlJoin =
  | { kind: "external" }
  | { kind: "blind"; port: number }
  | { kind: "unbacked"; port: number }
  | {
      kind: "joined" | "elsewhere";
      port: number;
      info: PortInfo;
      forward: KoluForward | undefined;
    }
  | {
      kind: "unclaimed";
      port: number;
      bind: PortBind;
      forward: KoluForward | undefined;
    };

/** Join a printed URL string against the tile, the host, and the host's doors. */
export function joinPrintedUrl(opts: {
  uri: string;
  /** The tile's ports, folded across its panes — the same list the Ports
   *  section joins (`HostTerminals.tilePorts`). A pane never scanned adds
   *  nothing, which costs nothing here: a tile that does not hold the port
   *  falls through to the host reading either way. */
  tilePorts: readonly PortInfo[];
  host: HostListeners;
  /** Host-scoped forwards already filtered by the caller. */
  forwards: readonly KoluForward[];
}): PrintedUrlJoin {
  const loopback = parseLoopbackUrl(opts.uri);
  if (loopback === null) return { kind: "external" };
  return joinPrintedPort({ ...opts, port: loopback.port });
}

/** The join over a known port number — what the decision table pins.
 *
 *  The TILE is asked first, because "this terminal serves it" is the most
 *  specific true answer and the card's copy differs for it. Only when the tile
 *  does not hold the port does the HOST decide between elsewhere, unclaimed,
 *  unbacked and blind — so a tile that has never been scanned costs nothing: the
 *  host reading answers the same question from the same pass. */
export function joinPrintedPort(opts: {
  port: number;
  tilePorts: readonly PortInfo[];
  host: HostListeners;
  forwards: readonly KoluForward[];
}): PrintedUrlJoin {
  const forward = opts.forwards.find((f) => f.remotePort === opts.port);
  const info = opts.tilePorts.find((p) => p.port === opts.port);
  if (info !== undefined) {
    return { kind: "joined", port: opts.port, info, forward };
  }
  const at = listenerAt(opts.host, opts.port);
  switch (at.kind) {
    case "claimed":
      return { kind: "elsewhere", port: opts.port, info: at.info, forward };
    case "unclaimed":
      return { kind: "unclaimed", port: opts.port, bind: at.bind, forward };
    case "absent":
      return { kind: "unbacked", port: opts.port };
    case "unknown":
      return { kind: "blind", port: opts.port };
  }
}

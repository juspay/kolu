/**
 * How a port becomes an open tab — three layers, never braided.
 *
 *   - {@link urlForPort}  — decision: what URL, once the door port is known
 *   - {@link ensureDoor}  — act: open the door (idempotent) and return its port
 *   - `window.open`       — effect: only at the component edge
 *
 * The chip, the printed-URL card, and "copy door URL" all compose these. Copy
 * is the first two without the third. Braiding decide/act/effect into one
 * `openPort` was rejected in design review: the copy action would have
 * re-implemented half of it.
 */

import type { HostKey } from "kolu-common/hostKey";
import type { ForwardOrigin } from "kolu-common/surface";
import type { PortAction } from "./portAction";
import { portUrl } from "./portUrl";
import { createForward } from "./useForwards";

/** Path / query / hash carried from a printed URL onto the door URL. */
export type UrlRemainder = {
  pathname: string;
  search: string;
  hash: string;
};

/** Append a printed URL's path+query+hash onto a door base URL.
 *
 *  A bare `/` pathname is treated as no remainder so a printout of
 *  `http://localhost:5173/` does not force a trailing slash the door would not
 *  otherwise have — but a real path always rides through. */
export function withRemainder(base: string, remainder?: UrlRemainder): string {
  if (remainder === undefined) return base;
  const path =
    remainder.pathname === "" || remainder.pathname === "/"
      ? ""
      : remainder.pathname;
  return `${base}${path}${remainder.search}${remainder.hash}`;
}

/** What to open for this port — pure, total over {@link PortAction}.
 *
 *  - `ready`      — the URL is known (direct, viewer loopback, or existing door)
 *  - `needs-door` — a forward is required and no door port was supplied yet
 *  - `none`       — nothing reaches it; say so, do not open */
export type UrlForPort =
  | { kind: "ready"; url: string }
  | { kind: "needs-door" }
  | { kind: "none" };

export function urlForPort(opts: {
  action: PortAction;
  remotePort: number;
  /** The door's local port, when known (existing forward or just-created). */
  doorPort?: number;
  /** `window.location.hostname` — the kolu server host the page was served from. */
  pageHost: string;
  remainder?: UrlRemainder;
}): UrlForPort {
  if (opts.action.kind === "none") return { kind: "none" };
  if (opts.action.kind === "here") {
    return {
      kind: "ready",
      url: withRemainder(
        portUrl(opts.pageHost, opts.remotePort),
        opts.remainder,
      ),
    };
  }
  if (opts.action.kind === "viewer") {
    return {
      kind: "ready",
      url: withRemainder(portUrl("localhost", opts.remotePort), opts.remainder),
    };
  }
  // forward
  if (opts.doorPort === undefined) return { kind: "needs-door" };
  return {
    kind: "ready",
    url: withRemainder(portUrl(opts.pageHost, opts.doorPort), opts.remainder),
  };
}

/** Open (or reuse) the door for this port. Returns the local port it answers on.
 *
 *  Idempotent by target on the server — a double-clicked chip opens exactly one
 *  door. Origin is the CALLER's to declare: chip/card use `auto` (reaped when the
 *  listener dies); ⌘K uses `manual` (pinned until cancel). */
export async function ensureDoor(input: {
  host: HostKey;
  port: number;
  origin: ForwardOrigin;
}): Promise<number> {
  const forward = await createForward(input);
  return forward.localPort;
}

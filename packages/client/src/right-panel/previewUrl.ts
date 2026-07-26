/**
 * How a Preview location becomes an iframe `src` — pure join of the server
 * location (`port` + `path`) with the client's reach facts (door, direct, viewer).
 *
 * One leaf so the tab is a reader of the URL rather than a second author of
 * host/port spelling (IPv6 brackets, `http` fixed, path rooted).
 */

import type { PreviewLocation } from "@kolu/padi/surface";
import type { PortAction } from "../forwards/portAction";
import { portUrl } from "../forwards/portUrl";

/** Where the frame loads, or why it cannot. */
export type PreviewFrameTarget =
  | { kind: "url"; href: string }
  /** Needs a door and none is live — the auto-cancel / never-opened case. */
  | { kind: "door-closed" }
  /** Port is not reachable by any mechanism this viewer has. */
  | { kind: "unreachable" };

/** Join the server location with how this viewer reaches that port.
 *
 *  `localPort` is the door's answer port when a forward exists for the
 *  location's remote port; `undefined` when no door is open. */
export function previewFrameTarget(opts: {
  location: PreviewLocation;
  action: PortAction;
  /** Door's local port, when a live forward exists for `location.port`. */
  localPort: number | undefined;
  /** The hostname that served this page (`location.hostname`). */
  pageHostname: string;
}): PreviewFrameTarget {
  const path = opts.location.path.startsWith("/")
    ? opts.location.path
    : `/${opts.location.path}`;
  switch (opts.action.kind) {
    case "here":
      return {
        kind: "url",
        href: `${portUrl(opts.pageHostname, opts.location.port)}${path === "/" ? "" : path}`,
      };
    case "viewer":
      return {
        kind: "url",
        href: `${portUrl("localhost", opts.location.port)}${path === "/" ? "" : path}`,
      };
    case "forward": {
      if (opts.localPort === undefined) return { kind: "door-closed" };
      return {
        kind: "url",
        href: `${portUrl(opts.pageHostname, opts.localPort)}${path === "/" ? "" : path}`,
      };
    }
    case "none":
      return { kind: "unreachable" };
  }
}

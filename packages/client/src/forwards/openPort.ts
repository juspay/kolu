import { toError } from "@kolu/surface/run-stream";
import type { SurfaceCallFailure } from "@kolu/surface/client";
import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import type { ForwardOrigin } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import type { PortAction } from "./portAction";
import { portUrl } from "./portUrl";
import { createForward } from "./useForwards";

/** Path / query / hash / scheme carried from a printed URL onto the door URL. */
export type UrlRemainder = {
  pathname: string;
  search: string;
  hash: string;
  /** Scheme the printout used; default `http:` when absent (chip path). */
  protocol?: "http:" | "https:";
};

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
  const protocol = opts.remainder?.protocol ?? "http:";
  return match(opts.action)
    .with({ kind: "none" }, () => ({ kind: "none" }) as const)
    .with({ kind: "here" }, () => ({
      kind: "ready" as const,
      url: withRemainder(
        portUrl(opts.pageHost, opts.remotePort, protocol),
        opts.remainder,
      ),
    }))
    .with({ kind: "viewer" }, () => ({
      kind: "ready" as const,
      url: withRemainder(
        portUrl("localhost", opts.remotePort, protocol),
        opts.remainder,
      ),
    }))
    .with({ kind: "forward" }, () => {
      if (opts.doorPort === undefined) return { kind: "needs-door" } as const;
      return {
        kind: "ready" as const,
        url: withRemainder(
          portUrl(opts.pageHost, opts.doorPort, protocol),
          opts.remainder,
        ),
      };
    })
    .exhaustive();
}

/** Open (or reuse) the door for this port. Returns the local port it answers on.
 *
 *  Idempotent by target on the server — a double-clicked chip opens exactly one
 *  door. Origin is the CALLER's to declare: chip/card use `auto` (reaped when the
 *  listener dies); ⌘K uses `manual` (pinned until cancel). */
export function ensureDoor(input: {
  host: HostKey;
  port: number;
  origin: ForwardOrigin;
}): Effect.Effect<number, SurfaceCallFailure> {
  return createForward(input).pipe(Effect.map((forward) => forward.localPort));
}

export function openThroughDoor(opts: {
  host: HostKey;
  port: number;
  tab: Window | null;
  remainder?: UrlRemainder;
}): Effect.Effect<void> {
  return ensureDoor({
    host: opts.host,
    port: opts.port,
    origin: "auto",
  }).pipe(
    Effect.tap((localPort) =>
      Effect.sync(() => {
        const decided = urlForPort({
          action: { kind: "forward" },
          remotePort: opts.port,
          doorPort: localPort,
          pageHost: window.location.hostname,
          remainder: opts.remainder,
        });
        if (decided.kind !== "ready") {
          opts.tab?.close();
          return;
        }
        if (opts.tab === null) {
          toast.info(`Forward open on port ${localPort}`, {
            description: "Your browser blocked the new tab.",
          });
          return;
        }
        opts.tab.location.replace(decided.url);
      }),
    ),
    Effect.catch((err) =>
      Effect.sync(() => {
        opts.tab?.close();
        toast.error(
          `Could not forward port ${opts.port}: ${toError(err).message}`,
        );
      }),
    ),
  );
}

/** Claim a blank tab on the CALLING stack, before any `await` — a popup
 *  blocker judges `window.open` by descent from a user gesture, and one
 *  issued after an await does not. Severing `opener` while the tab is still
 *  same-origin `about:blank` (the one moment this is possible) reaches the
 *  same posture the anchor path gets from `rel="noopener"` — deliberately NOT
 *  `"noopener"` in the feature string, since that makes `window.open` return
 *  `null` by spec, leaving no handle to navigate once the door is up. */
export function claimBlankTab(): Window | null {
  const tab = window.open("", "_blank");
  if (tab !== null) tab.opener = null;
  return tab;
}

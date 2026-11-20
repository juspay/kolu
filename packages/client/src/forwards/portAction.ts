import { type PortReach, portReach } from "kolu-common/surface";
import { match } from "ts-pattern";
import { bindOf, type PortRow } from "./portRows";

export const FORWARD_REASON: Record<
  Extract<PortReach, { kind: "needs-forward" }>["via"],
  string
> = {
  "remote-host": "on a remote host — opens through a forward",
  loopback: "bound to loopback — opens through a forward",
};

export const NO_MECHANISM_REASON: Record<
  Extract<PortReach, { kind: "no-mechanism" }>["via"],
  string
> = {
  "interface-bind": "bound to one interface — no forward can reach it",
};

export function reachReason(reach: PortReach): string | undefined {
  return match(reach)
    .with({ kind: "direct" }, () => undefined)
    .with({ kind: "needs-forward" }, ({ via }) => FORWARD_REASON[via])
    .with({ kind: "no-mechanism" }, ({ via }) => NO_MECHANISM_REASON[via])
    .exhaustive();
}

export type PortAction =
  | { kind: "here" }
  | { kind: "viewer" }
  | { kind: "forward" }
  | { kind: "none" };

export function portAction(opts: {
  reach: PortReach;
  /** Is the port's host the machine this browser is running on? */
  viewerOnHost: boolean;
}): PortAction {
  return match<PortReach, PortAction>(opts.reach)
    .with({ kind: "direct" }, () => ({ kind: "here" }))
    .with({ kind: "needs-forward" }, () =>
      opts.viewerOnHost ? { kind: "viewer" } : { kind: "forward" },
    )
    .with({ kind: "no-mechanism" }, () => ({ kind: "none" }))
    .exhaustive();
}

export function rowAction(opts: {
  row: PortRow;
  onKoluHost: boolean;
  viewerOnHost: boolean;
}): { action: PortAction; reason: string | undefined } {
  if (opts.row.kind === "orphan") {
    return { action: { kind: "forward" }, reason: undefined };
  }
  const reach = portReach({
    scope: bindOf(opts.row).scope,
    onKoluHost: opts.onKoluHost,
  });
  return {
    action: portAction({ reach, viewerOnHost: opts.viewerOnHost }),
    reason: reachReason(reach),
  };
}

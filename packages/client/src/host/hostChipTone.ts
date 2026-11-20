import type { EntryState } from "@kolu/surface-map";
import { hostHueFor } from "kolu-common/hostHue";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import {
  DAEMON_STATE_PRESENTATION,
  type KavalPresence,
} from "../kaval/daemonPresentation";

export function hostHue(host: HostKey): string {
  return hostHueFor(encodeHostKey(host));
}

export function hostLabel(h: HostKey): string {
  return h.kind === "local" ? "local" : h.target;
}

export function hostDisplayName(
  h: HostKey,
  serverHostname: string | undefined,
): string {
  if (h.kind === "local") return serverHostname ?? hostLabel(h);
  return hostLabel(h);
}

export type HostGlance = {
  stripDot: string | null;
  detailDot: string;
  down: boolean;
  short: string;
  title: string;
  labelDecoration: string;
};

const STRIKE = " line-through decoration-red-400/80 decoration-1";

const PULSE = " animate-pulse motion-reduce:animate-none";
const PIP_SERVING = "bg-emerald-400";
const PIP_ATTENTION = "bg-amber-400";
const PIP_FAILED = "bg-red-400";
const PIP_NO_CLAIM = "bg-fg-3/40";

const GLANCE: Record<
  EntryState["kind"],
  Omit<HostGlance, "title"> & {
    title: string | ((s: EntryState<{ reason: string }>) => string);
  }
> = {
  connected: {
    stripDot: null,
    detailDot: PIP_SERVING,
    down: false,
    short: "connected",
    title: "connected",
    labelDecoration: "",
  },
  warming: {
    stripDot: `${PIP_ATTENTION}${PULSE}`,
    detailDot: PIP_ATTENTION,
    down: false,
    short: "connecting",
    title: "connecting…",
    labelDecoration: "",
  },
  failed: {
    stripDot: PIP_FAILED,
    detailDot: PIP_FAILED,
    down: true,
    short: "failed",
    title: (s) =>
      s.kind === "failed" ? `failed: ${s.failure.reason}` : "failed",
    labelDecoration: STRIKE,
  },
  unobservable: {
    stripDot: `${PIP_NO_CLAIM}${PULSE}`,
    detailDot: PIP_NO_CLAIM,
    down: false,
    short: "unknown",
    title: (s) =>
      s.kind === "unobservable"
        ? `status unknown — kolu is unreachable from this tab (last seen: ${s.published})`
        : "status unknown",
    labelDecoration: "",
  },
  "not-a-member": {
    stripDot: PIP_NO_CLAIM,
    detailDot: PIP_NO_CLAIM,
    down: false,
    short: "removed",
    title: "not a member",
    labelDecoration: "",
  },
};

export type KavalChain =
  | { readonly kind: "serving" }
  | { readonly kind: "starting"; readonly verdict: string }
  | { readonly kind: "down"; readonly verdict: string }
  | { readonly kind: "unknown" };

export const KAVAL_CHAIN_UNKNOWN: KavalChain = { kind: "unknown" };

export function kavalChainOf(presence: KavalPresence): KavalChain {
  switch (presence.kind) {
    case "connected":
      return { kind: "serving" };
    case "warming":
      return {
        kind: "starting",
        verdict: DAEMON_STATE_PRESENTATION[presence.state].label,
      };
    case "down":
      return {
        kind: "down",
        verdict: DAEMON_STATE_PRESENTATION[presence.state].label,
      };
    case "incompatible":
      return {
        kind: "down",
        verdict: DAEMON_STATE_PRESENTATION.incompatible.label,
      };
    case "unknown":
      return KAVAL_CHAIN_UNKNOWN;
  }
}

type KavalVerdict = Extract<KavalChain, { kind: "starting" | "down" }>;

function composeKaval(base: HostGlance, kaval: KavalVerdict): HostGlance {
  const pulse = kaval.kind === "starting" ? PULSE : "";
  return {
    ...base,
    stripDot: `${PIP_ATTENTION}${pulse}`,
    detailDot: `${PIP_ATTENTION}${pulse}`,
    down: false,
    short: kaval.kind === "down" ? "kaval down" : "kaval starting",
    title: `connected — kaval ${kaval.verdict}`,
    labelDecoration: "",
  };
}

export function hostGlance(
  status: EntryState<{ reason: string }> | EntryState,
  kaval: KavalChain,
): HostGlance {
  const row = GLANCE[status.kind];
  const title =
    typeof row.title === "function"
      ? row.title(status as EntryState<{ reason: string }>)
      : row.title;
  const base: HostGlance = {
    stripDot: row.stripDot,
    detailDot: row.detailDot,
    down: row.down,
    short: row.short,
    title,
    labelDecoration: row.labelDecoration,
  };
  if (status.kind !== "connected") return base;
  if (kaval.kind === "serving" || kaval.kind === "unknown") return base;
  return composeKaval(base, kaval);
}

export function chipStatusDot(
  _host: HostKey,
  status: EntryState<{ reason: string }> | EntryState,
  kaval: KavalChain,
): string {
  const g = hostGlance(status, kaval);
  return g.stripDot ?? g.detailDot;
}

export function dotClass(status: EntryState, kaval: KavalChain): string {
  return chipStatusDot({ kind: "local" }, status, kaval);
}

export function statusTitle(
  status: EntryState<{ reason: string }> | EntryState,
  kaval: KavalChain,
): string {
  return hostGlance(status, kaval).title;
}

export function statusLabelShort(
  status: EntryState,
  kaval: KavalChain,
): string {
  return hostGlance(status, kaval).short;
}

export function hostRowContext(
  status: EntryState,
  isCanvasActive: boolean,
  kaval: KavalChain = KAVAL_CHAIN_UNKNOWN,
): string {
  if (isCanvasActive) return "active";
  const glance = hostGlance(status, kaval);
  if (status.kind === "connected" && kaval.kind !== "down") return "";
  return glance.short;
}

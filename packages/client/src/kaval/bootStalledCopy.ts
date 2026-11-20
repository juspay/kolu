import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import { match } from "ts-pattern";
import type { ClientStalledLeg } from "./canvasModeResolver";
import type { ConnectQuiet } from "./connectTailClock";

export interface BootStalledCopy {
  readonly title: string;
  readonly body: string;
}

export const CONNECTOR_STALLED_COPY: BootStalledCopy = {
  title: "kolu is still setting up this host",
  body:
    "Setting up this host's agent over ssh is taking longer than usual, but kolu hasn't given " +
    "up — it is still working on it. You can keep waiting, retry the connection now, or switch back " +
    "to your local host.",
};

export const BOOT_STALLED_COPY = {
  membership: {
    title: "kolu can't see this host yet",
    body:
      "kolu connected, but the list of hosts hasn't arrived, so it can't open this host's " +
      "workspace. This usually clears on its own — reload to try again.",
  },
  session: {
    title: "Your workspace didn't finish loading",
    body:
      "kolu connected to this host, but its saved session and terminal list haven't arrived, " +
      "so the workspace can't open. Reload to try again.",
  },
  daemon: {
    title: "This host's agent isn't responding",
    body:
      "kolu reached this host, but its agent (kaval) hasn't reported its status, so the " +
      "workspace can't be trusted yet. Reload to try again, or switch back to your local host.",
  },
} satisfies Record<ClientStalledLeg, BootStalledCopy>;

export function bootStalledCopy(leg: ClientStalledLeg): BootStalledCopy {
  return BOOT_STALLED_COPY[leg];
}

export function bootStalledPhaseDetail(
  phase: ConnectPhase | undefined,
  quiet?: ConnectQuiet,
): string | undefined {
  const still = match(phase)
    .with(
      "probing",
      () => "Still checking whether this host already has the agent…",
    )
    .with("provisioning", () => "Still provisioning the agent on the host…")
    .with("connecting", () => "Still connecting to the host's agent…")
    .with(undefined, () => undefined)
    .exhaustive();
  if (still === undefined || quiet === undefined) return still;
  const minutes = Math.floor(quiet.silentMs / 60_000);
  const silence =
    minutes < 1 ? "" : ` No new output in the last ${durationOf(minutes)}.`;
  return `${still}${silence} Last line: ${quiet.lastLine}`;
}

function durationOf(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

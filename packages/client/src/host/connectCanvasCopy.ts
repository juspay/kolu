import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import { match, P } from "ts-pattern";

export interface ConnectCopy {
  title: string;
  showsElapsed: boolean;
}

export interface Episode {
  host: string;
  epoch: number;
  ms: number;
}

export interface ElapsedAnchor extends Episode {
  at: number;
}

export function episodeElapsedAnchor(
  prev: ElapsedAnchor | null,
  episode: Episode | null,
  now: () => number,
): ElapsedAnchor | null {
  if (episode === null) return null;
  if (
    prev !== null &&
    prev.host === episode.host &&
    prev.epoch === episode.epoch &&
    prev.ms === episode.ms
  ) {
    return prev;
  }
  return { ...episode, at: now() };
}

export function episodeElapsedMs(
  anchor: ElapsedAnchor | null,
  now: number,
): number | null {
  return anchor === null ? null : anchor.ms + (now - anchor.at);
}

export function connectCanvasCopy(
  phase: NarratedPhase | undefined,
  host: string,
): ConnectCopy {
  return match(phase)
    .with(undefined, () => ({
      title: `Connecting to ${host}…`,
      showsElapsed: false,
    }))
    .with(P.union("probing", "connecting"), () => ({
      title: `Connecting to ${host}…`,
      showsElapsed: true,
    }))
    .with("provisioning", () => ({
      title: `Provisioning kolu on ${host}… this can take a few minutes`,
      showsElapsed: true,
    }))
    .with("disconnected", () => ({
      title: `Reconnecting to ${host}…`,
      showsElapsed: false,
    }))
    .exhaustive();
}

export type NarratedPhase = ConnectPhase | "disconnected";

export function isNarratedPhase(phase: string): phase is NarratedPhase {
  return isConnectPhase(phase) || phase === "disconnected";
}

export function isConnectPhase(phase: string): phase is ConnectPhase {
  return (
    phase === "probing" || phase === "provisioning" || phase === "connecting"
  );
}

export function isProvisioningPhase(phase: ConnectPhase | undefined): boolean {
  return phase === "provisioning";
}

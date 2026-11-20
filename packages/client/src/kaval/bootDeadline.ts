import { match } from "ts-pattern";
import type { BootIdentity, BootTag, CeilingClass } from "./canvasModeResolver";

export const LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS = 30_000;

export const CEILING_MS: Record<CeilingClass, number> = {
  local: LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS,
  "remote-provisioning": 600_000,
  "remote-handshake": 120_000,
};

export const CAMPAIGN_CEILING_MS = 1_800_000;

interface Anchor {
  anchorMs: number;
  ceiling: CeilingClass;
}

const anchors = new Map<string, Anchor>();

const campaignAnchors = new Map<string, number>();

const watchedVerdict = new Map<string, boolean>();

const watchedBoot = new Map<string, BootIdentity>();

const EPISODE_CELLS = [
  anchors,
  campaignAnchors,
  watchedVerdict,
  watchedBoot,
] as const;

export function watchedBootIdentity(hostEnc: string): BootIdentity | undefined {
  return watchedBoot.get(hostEnc);
}

function releaseEpisode(hostEnc: string): void {
  for (const cell of EPISODE_CELLS) cell.delete(hostEnc);
}

export function bootDeadlineExceeded(
  hostEnc: string,
  nowMs: number,
  transportLive: boolean,
): boolean {
  if (!transportLive) return watchedVerdict.get(hostEnc) ?? false;
  const a = anchors.get(hostEnc);
  const classExceeded =
    a !== undefined && nowMs - a.anchorMs > CEILING_MS[a.ceiling];
  const campaignStart = campaignAnchors.get(hostEnc);
  const campaignExceeded =
    campaignStart !== undefined && nowMs - campaignStart > CAMPAIGN_CEILING_MS;
  const exceeded = classExceeded || campaignExceeded;
  watchedVerdict.set(hostEnc, exceeded);
  return exceeded;
}

export function recordBootFrame(
  hostEnc: string,
  tag: BootTag,
  nowMs: number,
): void {
  match(tag)
    .with({ accrual: "accrue" }, ({ boot }) => {
      watchedBoot.set(hostEnc, { leg: boot.leg, ceiling: boot.ceiling });
      const a = anchors.get(hostEnc);
      if (a === undefined || a.ceiling !== boot.ceiling) {
        anchors.set(hostEnc, { anchorMs: nowMs, ceiling: boot.ceiling });
      }
      if (boot.leg === "provisioning") {
        if (!campaignAnchors.has(hostEnc)) campaignAnchors.set(hostEnc, nowMs);
      } else {
        campaignAnchors.delete(hostEnc);
      }
    })
    .with({ accrual: "clear" }, () => releaseEpisode(hostEnc))
    .with({ accrual: "retain" }, () => campaignAnchors.delete(hostEnc))
    .exhaustive();
}

export function resetBootDeadline(hostEnc: string): void {
  releaseEpisode(hostEnc);
}

export function pruneBootAnchors(memberEncs: readonly string[]): void {
  const keep = new Set(memberEncs);
  for (const cell of EPISODE_CELLS) {
    for (const k of cell.keys()) {
      if (!keep.has(k)) cell.delete(k);
    }
  }
}

export function resetBootAnchors(): void {
  for (const cell of EPISODE_CELLS) cell.clear();
}

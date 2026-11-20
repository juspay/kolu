import type { ConnectionInfo } from "@kolu/surface-remote/connection";
import type { PadiLink } from "kolu-common/surface";
import { match } from "ts-pattern";

type SessionPhase = ConnectionInfo["phase"];

export function mapConnectionToPadiLink(phase: SessionPhase): PadiLink {
  return match(phase)
    .with("connected", () => "connected" as const)
    .with("connecting", "probing", "provisioning", () => "connecting" as const)
    .with("disconnected", "failed", () => "degraded" as const)
    .exhaustive();
}

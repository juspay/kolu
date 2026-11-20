import type { HostKey } from "kolu-common/hostKey";

export function hostTitle(active: HostKey): string {
  return active.kind === "local" ? "Kolu" : `Kolu [${active.target}]`;
}

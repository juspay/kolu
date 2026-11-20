import { type HostKey, hostKeysInclude } from "kolu-common/hostKey";

export function groundActiveHost(
  active: HostKey,
  members: readonly HostKey[],
): HostKey | null {
  return hostKeysInclude(members, active) ? active : null;
}

import type { PwaIdentity } from "kolu-common/contract";
import { hostHueFor } from "kolu-common/hostHue";

export function appName(hostname: string): string {
  return `Kolu [${hostname}]`;
}

export function pwaIdentityForHostname(hostname: string): PwaIdentity {
  return {
    hostname,
    name: appName(hostname),
    themeColor: hostHueFor(hostname),
  };
}

import { bakedOsFactsBin, processIdentity } from "osfacts-client";

export function readProcessIdentity(pid: number) {
  return processIdentity(bakedOsFactsBin("KOLU_OSFACTS_BIN"), pid);
}

export function selfProcessIdentity() {
  const identity = readProcessIdentity(process.pid);
  if (identity === undefined) {
    throw new Error(`osfacts could not resolve fleet-top pid ${process.pid}`);
  }
  return identity;
}

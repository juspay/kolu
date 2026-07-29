import { processIdentity } from "osfacts-client";

function osfactsBin(): string {
  const bin = process.env.KOLU_OSFACTS_BIN;
  if (!bin) {
    throw new Error("KOLU_OSFACTS_BIN is required for daemon ownership");
  }
  return bin;
}

export function readProcessIdentity(pid: number) {
  return processIdentity(osfactsBin(), pid);
}

export function selfProcessIdentity() {
  const identity = readProcessIdentity(process.pid);
  if (identity === undefined) {
    throw new Error(`osfacts could not resolve fleet-top pid ${process.pid}`);
  }
  return identity;
}

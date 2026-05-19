import type { HostSummary } from "kolu-common/contract";
import { localHost } from "./local.ts";
import { createRemoteHost } from "./remote.ts";
import { readSshHosts, type SshHostEntry } from "./ssh-config.ts";
import type { Host } from "./types.ts";

const remoteHosts = new Map<string, Host>();

function toSummary(entry: SshHostEntry): HostSummary {
  return {
    id: entry.alias,
    label: entry.alias,
    hostname: entry.hostname,
    user: entry.user,
    port: entry.port,
  };
}

export function listHosts(): HostSummary[] {
  return readSshHosts().map(toSummary);
}

export function getHost(hostId?: string): Host {
  if (!hostId) return localHost;
  const entry = readSshHosts().find((h) => h.alias === hostId);
  if (!entry) {
    throw new Error(`SSH host '${hostId}' was not found in ~/.ssh/config`);
  }
  let host = remoteHosts.get(hostId);
  if (!host) {
    host = createRemoteHost({
      summary: toSummary(entry),
      helperRemoteCmd: process.env.KOLU_HELPER_REMOTE_CMD,
    });
    remoteHosts.set(hostId, host);
  }
  return host;
}

export function shutdownHosts(): void {
  for (const host of remoteHosts.values()) host.shutdown();
  remoteHosts.clear();
}

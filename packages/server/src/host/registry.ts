/**
 * Host registry — single source of truth for which `Host`s exist in this
 * kolu process. Initialized once at startup; consumers (terminal create,
 * session restore, the `host.list` RPC) look up by id.
 *
 * The local host is always present (id = "local"). Remote hosts are
 * populated from `~/.ssh/config` at startup; users who add a Host entry
 * after kolu started need to restart for it to show up. Reloading on
 * SIGHUP is a v1 nicety.
 */

import type { HostSummary } from "kolu-common/contract";
import { log } from "../log.ts";
import { createLocalHost, LOCAL_HOST_ID } from "./local.ts";
import { createRemoteHost } from "./remote.ts";
import { readSshHosts } from "./ssh-config.ts";
import type { Host } from "./types.ts";

const hosts = new Map<string, Host>();

export type { HostSummary };

/** Initialize the host registry. Idempotent — repeated calls reinitialize
 *  from the current SSH config. Returns the discovered host summaries. */
export function initHosts(): HostSummary[] {
  // Tear down any remote hosts we already have so their child SSH
  // processes don't leak across re-init (tests).
  for (const h of hosts.values()) {
    if (h.kind === "remote-ssh") void h.shutdown();
  }
  hosts.clear();

  hosts.set(LOCAL_HOST_ID, createLocalHost());

  const helperRemoteCmd = process.env.KOLU_HELPER_REMOTE_CMD;

  const sshEntries = readSshHosts();
  for (const entry of sshEntries) {
    if (hosts.has(entry.alias)) continue; // "local" collision — skip.
    hosts.set(
      entry.alias,
      createRemoteHost({ alias: entry.alias, helperRemoteCmd }),
    );
  }

  log.info(
    {
      local: 1,
      remote: sshEntries.length,
      helperRemoteCmd: helperRemoteCmd ?? null,
    },
    "host registry initialized",
  );

  return [...hosts.values()].map((h) => ({
    id: h.id,
    label: h.label,
    kind: h.kind,
  }));
}

/** Look up a host by id. `"local"` returns the local host; any other
 *  string is an SSH alias. `undefined` is accepted as a back-compat
 *  shorthand for `"local"` (the old wire shape used `undefined` to mean
 *  local) but new code should pass an explicit hostId — terminal
 *  metadata always carries `"local"` since the `.default("local")` on
 *  the schema fills it in. */
export function getHost(id: string | undefined): Host | undefined {
  if (id === undefined || id === LOCAL_HOST_ID) return hosts.get(LOCAL_HOST_ID);
  return hosts.get(id);
}

/** True when this id is the local-host sentinel. Centralized so the
 *  rest of the code doesn't have to know what string `"local"` is. */
export function isLocalHostId(id: string): boolean {
  return id === LOCAL_HOST_ID;
}

export { LOCAL_HOST_ID };

/** All registered hosts, local first. */
export function listHosts(): HostSummary[] {
  return [...hosts.values()].map((h) => ({
    id: h.id,
    label: h.label,
    kind: h.kind,
  }));
}

/** Drain — best-effort cleanup of every host's underlying connection.
 *  Called on server shutdown. */
export async function shutdownHosts(): Promise<void> {
  await Promise.all([...hosts.values()].map((h) => h.shutdown()));
  hosts.clear();
}

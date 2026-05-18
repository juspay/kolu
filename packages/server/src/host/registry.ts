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

import { log } from "../log.ts";
import { createLocalHost, LOCAL_HOST_ID } from "./local.ts";
import { createRemoteHost } from "./remote.ts";
import { readSshHosts, type SshHostEntry } from "./ssh-config.ts";
import type { Host } from "./types.ts";

const hosts = new Map<string, Host>();

export interface HostSummary {
  id: string;
  label: string;
  kind: "local" | "remote-ssh";
}

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

/** Look up a host by id. Returns `undefined` if not found — the caller
 *  should fall back to the local host or surface an error. */
export function getHost(id: string | undefined): Host | undefined {
  if (id === undefined) return hosts.get(LOCAL_HOST_ID);
  return hosts.get(id);
}

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

/** Surface the parsed SSH entries (for diagnostics + the host.list RPC,
 *  which wants alias + hostname so the picker can show `srid-build →
 *  build.example.com` instead of just the alias).
 *
 *  Lazy-cached, but re-evaluated on every `initHosts` call. */
export function getSshEntries(): SshHostEntry[] {
  return readSshHosts();
}

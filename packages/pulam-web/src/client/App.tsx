/**
 * The pulam-web app shell — a dark monospace fleet list.
 *
 * Fetches the static host set from `/api/hosts` (the parent's
 * `registry.hosts()`), then renders one `<HostGroup>` per host, each opening its
 * own ws to `/rpc/ws?host=<host>` and subscribing that host's awareness surface.
 * Minimal but clean; the polished mockup is R4.8b.
 */

import { createResource, For, type JSX, Show } from "solid-js";
import { HostGroup } from "./HostGroup.tsx";
import { rememberServerProcessId } from "./wire.ts";

/** Fetch the parent's static host set + this server's `processId`, and remember
 *  the `processId` for the stale-tab `?pid=` echo BEFORE returning (so it's set
 *  before any `<HostGroup>` opens a socket — see `wire.ts`). Fails LOUD on a
 *  non-2xx or a malformed body (no fallback to an empty list — a broken host API
 *  is a real error the user must see, not a silently-empty fleet). */
async function fetchHosts(): Promise<string[]> {
  const res = await fetch("/api/hosts");
  if (!res.ok) {
    throw new Error(`GET /api/hosts failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { hosts?: unknown; processId?: unknown };
  if (
    !Array.isArray(body.hosts) ||
    body.hosts.some((h) => typeof h !== "string")
  ) {
    throw new Error(
      "GET /api/hosts: malformed body (expected { hosts: string[] })",
    );
  }
  if (typeof body.processId !== "string" || body.processId.length === 0) {
    throw new Error(
      "GET /api/hosts: malformed body (expected a non-empty processId)",
    );
  }
  // Seed the stale-tab echo before any host socket opens. The render order
  // (this resource resolves → `<HostGroup>` renders → `surfaceForHost`) makes
  // this strictly-before-first-connect.
  rememberServerProcessId(body.processId);
  return body.hosts as string[];
}

export function App(): JSX.Element {
  const [hosts] = createResource(fetchHosts);

  return (
    <main class="mx-auto max-w-[720px] p-4">
      <h1 class="mx-0 mt-1 mb-3 text-[15px] font-semibold text-[#d7dbe0]">
        pulam-web · fleet terminals
      </h1>
      <Show
        when={!hosts.error}
        fallback={
          <div class="text-[#ff8d8d]">
            {(hosts.error as Error)?.message ?? "failed to load hosts"}
          </div>
        }
      >
        <Show
          when={hosts() !== undefined}
          fallback={<div class="text-[#6b7480]">loading hosts…</div>}
        >
          <Show
            when={(hosts() ?? []).length > 0}
            fallback={<div class="text-[#6b7480]">no hosts configured</div>}
          >
            <For each={hosts()}>{(host) => <HostGroup host={host} />}</For>
          </Show>
        </Show>
      </Show>
    </main>
  );
}

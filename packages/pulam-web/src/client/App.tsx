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

/** Fetch the parent's static host set. Fails LOUD on a non-2xx or a malformed
 *  body (no fallback to an empty list — a broken host API is a real error the
 *  user must see, not a silently-empty fleet). */
async function fetchHosts(): Promise<string[]> {
  const res = await fetch("/api/hosts");
  if (!res.ok) {
    throw new Error(`GET /api/hosts failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { hosts?: unknown };
  if (
    !Array.isArray(body.hosts) ||
    body.hosts.some((h) => typeof h !== "string")
  ) {
    throw new Error(
      "GET /api/hosts: malformed body (expected { hosts: string[] })",
    );
  }
  return body.hosts as string[];
}

export function App(): JSX.Element {
  const [hosts] = createResource(fetchHosts);

  return (
    <main style={{ "max-width": "720px", margin: "0 auto", padding: "16px" }}>
      <h1
        style={{
          "font-size": "15px",
          "font-weight": "600",
          color: "#d7dbe0",
          margin: "4px 0 12px",
        }}
      >
        pulam-web · fleet terminals
      </h1>
      <Show
        when={!hosts.error}
        fallback={
          <div style={{ color: "#ff8d8d" }}>
            {(hosts.error as Error)?.message ?? "failed to load hosts"}
          </div>
        }
      >
        <Show
          when={hosts() !== undefined}
          fallback={<div style={{ color: "#6b7480" }}>loading hosts…</div>}
        >
          <Show
            when={(hosts() ?? []).length > 0}
            fallback={
              <div style={{ color: "#6b7480" }}>no hosts configured</div>
            }
          >
            <For each={hosts()}>{(host) => <HostGroup host={host} />}</For>
          </Show>
        </Show>
      </Show>
    </main>
  );
}
